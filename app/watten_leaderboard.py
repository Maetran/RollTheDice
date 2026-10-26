"""Authenticated DRAFT standings: stored endurance XP or validated outcomes."""

from __future__ import annotations

from collections import defaultdict
from fractions import Fraction

from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import selectinload

from .database import database_schema_ready, session_scope
from .models import (
    CompletedGame,
    GameParticipant,
    User,
    WattenAchievementGrant,
    WattenMatchCredit,
    WattenMatchEvidence,
    WattenProgressState,
)
from .security import as_utc
from .watten_account import SOURCE_PAGE_SIZE, _validated_match, build_watten_account
from .watten_evidence import validate_membership

MIN_RATE_MATCHES = 10


class WattenLeaderboardError(ValueError):
    pass


def _require(condition, code="watten_leaderboard_invalid_input"):
    if not condition:
        raise WattenLeaderboardError(code)


def _stored_xp(db):
    """Validate every ranked journal using relational metadata, never foreign JSON."""
    code = "watten_leaderboard_invalid_journal"
    # A damaged missing state must not hide an otherwise active journal owner
    # from the inner joins below. Inspect only relational identity metadata.
    orphan = select(User.id).where(User.is_active.is_(True),
        ~exists(select(WattenProgressState.user_id).where(WattenProgressState.user_id == User.id)),
        or_(exists(select(WattenMatchCredit.user_id).where(WattenMatchCredit.user_id == User.id)),
            exists(select(WattenAchievementGrant.user_id).where(WattenAchievementGrant.user_id == User.id)))).limit(1)
    _require(db.scalar(orphan) is None, code)
    states = {}
    query = select(WattenProgressState).join(User, User.id == WattenProgressState.user_id).where(User.is_active.is_(True))
    for state in db.scalars(query.execution_options(yield_per=SOURCE_PAGE_SIZE)):
        _require(type(state.generation) is int and state.generation >= 1 and type(state.grant_sequence) is int
                 and type(state.acknowledged_sequence) is int and 0 <= state.acknowledged_sequence <= state.grant_sequence, code)
        states[state.user_id] = state
    totals = {identifier: {"xp": 0, "matches": 0, "wins": 0} for identifier in states}
    seen, sources = defaultdict(set), defaultdict(set)

    def record(user_id, xp, policy, catalog, sequence):
        _require(type(xp) is int and xp >= 0 and type(policy) is int and policy >= 1
                 and type(catalog) is int and catalog >= 1 and type(sequence) is int
                 and 1 <= sequence <= states[user_id].grant_sequence and sequence not in seen[user_id], code)
        seen[user_id].add(sequence)
        totals[user_id]["xp"] += xp

    credit = WattenMatchCredit
    own_count = select(func.count(GameParticipant.id)).where(
        GameParticipant.game_id == CompletedGame.id, GameParticipant.user_id == credit.user_id).correlate(CompletedGame, credit).scalar_subquery()
    bound = exists(select(GameParticipant.id).where(GameParticipant.game_id == CompletedGame.id,
                   GameParticipant.user_id == credit.user_id, GameParticipant.player_key == credit.player_id)).correlate(CompletedGame, credit)
    query = select(credit.user_id, credit.game_id, credit.finished_at, credit.won, credit.xp,
                   credit.policy_version, credit.catalog_version, credit.grant_sequence,
                   CompletedGame.game_type, CompletedGame.finished_at, WattenMatchEvidence.game_id, own_count, bound).join(
        WattenProgressState, (WattenProgressState.user_id == credit.user_id)
        & (WattenProgressState.generation == credit.generation)).join(User, User.id == credit.user_id).outerjoin(
            CompletedGame, CompletedGame.game_id == credit.game_id).outerjoin(
                WattenMatchEvidence, WattenMatchEvidence.game_id == credit.game_id).where(User.is_active.is_(True))
    for user_id, game_id, finished, won, xp, policy, catalog, sequence, game_type, source_at, proof, count, binding in db.execute(
            query.execution_options(yield_per=SOURCE_PAGE_SIZE)):
        _require(game_type == "watten" and proof == game_id and count == 1 and binding
                 and as_utc(finished) == as_utc(source_at) and type(won) is bool, code)
        record(user_id, xp, policy, catalog, sequence)
        sources[user_id].add(game_id)
        totals[user_id]["matches"] += 1
        totals[user_id]["wins"] += won
    grant = WattenAchievementGrant
    query = select(grant.user_id, grant.source_game_id, grant.xp, grant.policy_version,
                   grant.catalog_version, grant.grant_sequence).join(
        WattenProgressState, (WattenProgressState.user_id == grant.user_id)
        & (WattenProgressState.generation == grant.generation)).join(User, User.id == grant.user_id).where(User.is_active.is_(True))
    for user_id, source, xp, policy, catalog, sequence in db.execute(query.execution_options(yield_per=SOURCE_PAGE_SIZE)):
        _require(source in sources[user_id], code)
        record(user_id, xp, policy, catalog, sequence)
    for identifier, state in states.items():
        _require(len(seen[identifier]) == state.grant_sequence, code)
    return totals


def _outcomes(db, names, existing_users, *, players, opponents):
    totals = defaultdict(lambda: {"wins": 0, "matches": 0})
    last_id = None
    while True:
        admitted = exists(select(GameParticipant.id).join(User, User.id == GameParticipant.user_id).where(
            GameParticipant.game_id == CompletedGame.id, User.is_active.is_(True)))
        query = select(CompletedGame, WattenMatchEvidence).outerjoin(
            WattenMatchEvidence, WattenMatchEvidence.game_id == CompletedGame.game_id).options(
                selectinload(CompletedGame.participants)).where(CompletedGame.game_type == "watten", admitted)
        if last_id is not None:
            query = query.where(CompletedGame.id > last_id)
        rows = list(db.execute(query.order_by(CompletedGame.id).limit(SOURCE_PAGE_SIZE)))
        if not rows:
            break
        for row, frozen in rows:
            accounts = {item.user_id for item in row.participants if item.user_id in names}
            if not accounts:
                continue
            match = _validated_match(row, frozen, min(accounts), existing_users)
            evidence = match.evidence
            # CPU participation is explicit in the validated roster, never
            # inferred from missing/deleted account IDs or an unknown profile.
            has_cpu = any(item.is_cpu for item in evidence.roster)
            if players is not None and evidence.player_count != players:
                continue
            if opponents == "human" and has_cpu or opponents == "cpu" and not has_cpu:
                continue
            for account in accounts:
                own = validate_membership(evidence, viewer_user_id=account, bindings=match.original_bindings)
                totals[account]["matches"] += 1
                totals[account]["wins"] += own.won
        last_id = rows[-1][0].id
    return totals


def build_watten_leaderboard(user_id: int, *, metric="xp", players=None, opponents="all", limit=50) -> dict:
    _require(type(user_id) is int and user_id > 0 and type(metric) is str and metric in {"xp", "wins", "win_rate"}
             and (players is None or type(players) is int and players in {2, 3, 4})
             and type(opponents) is str and opponents in {"all", "human", "cpu"}
             and type(limit) is int and 1 <= limit <= 100)
    _require(metric != "xp" or players is None and opponents == "all", "watten_leaderboard_xp_filter_unsupported")
    _require(database_schema_ready(), "watten_leaderboard_unavailable")
    # Validate all the viewer's current private source/journal rows too, even
    # when a global XP aggregation does not need to decode any foreign JSON.
    build_watten_account(user_id)
    with session_scope() as db:
        users = list(db.execute(select(User.id, User.username, User.is_active)))
        existing = {identifier for identifier, _name, _active in users}
        names = {identifier: name for identifier, name, active in users if active}
        _require(user_id in names)
        totals = _stored_xp(db) if metric == "xp" else _outcomes(db, names, existing, players=players, opponents=opponents)
        from .account_progress import owned_origin_ids
        from .models import AccountProgressOrigin
        from .watten_account import build_watten_account_in_session
        from .watten_merge import selected_matches
        for owner in set(db.scalars(select(AccountProgressOrigin.owner_user_id))):
            for origin in owned_origin_ids(db, owner):
                totals.pop(origin, None)
            if owner not in names:
                continue
            if metric == "xp":
                account = build_watten_account_in_session(db, owner)
                totals[owner] = {"xp": account["progress"]["total_xp"],
                                 "matches": account["statistics"]["credited_matches"],
                                 "wins": account["statistics"]["credited_wins"]}
            else:
                selected = [item for item in selected_matches(db, owner)
                            if (players is None or item.match.evidence.player_count == players)
                            and (opponents == "all" or (any(player.is_cpu for player in item.match.evidence.roster)
                                                        == (opponents == "cpu")))]
                if selected:
                    totals[owner] = {"matches": len(selected), "wins": sum(item.own.won for item in selected)}
    minimum = MIN_RATE_MATCHES if metric == "win_rate" else 0

    def value(identifier):
        item = totals[identifier]
        if metric == "xp":
            return item["xp"]
        if metric == "wins":
            return item["wins"]
        return Fraction(item["wins"], item["matches"])

    eligible = [identifier for identifier in totals if identifier in names and totals[identifier]["matches"] >= minimum]
    ordered = sorted(eligible, key=lambda identifier: (-value(identifier), names[identifier].casefold(), identifier))
    positions, previous, place = {}, None, 0
    for index, identifier in enumerate(ordered, 1):
        score = value(identifier)
        if score != previous:
            place, previous = index, score
        positions[identifier] = place

    def entry(identifier):
        item = totals[identifier]
        rate = round(item["wins"] / item["matches"] * 100, 1) if item["matches"] else None
        return {"place": positions.get(identifier), "display_name": names[identifier], "is_self": identifier == user_id,
                "value": float(value(identifier) * 100) if metric == "win_rate" else value(identifier),
                "exact_ratio": {"wins": item["wins"], "matches": item["matches"]} if metric == "win_rate" else None,
                "matches": item["matches"], "wins": item["wins"], "win_rate": rate, "eligible": identifier in positions}

    definitions = {
        "xp": {"de": "Gespeicherte Entwurfs-XP aus Partien und Erfolgen messen Ausdauer, nicht Spielstärke.",
               "en": "Stored draft XP from matches and achievements measures endurance, not playing strength."},
        "wins": {"de": "Siege aus allen gültigen abgeschlossenen Partien der gewählten Vergleichsgruppe.",
                 "en": "Wins from all valid completed matches in the selected comparison group."},
        "win_rate": {"de": "Siegquote der gewählten Vergleichsgruppe; mindestens zehn Partien, Platz nach ungerundeter Quote.",
                     "en": "Win rate in the selected comparison group; at least ten matches, ranked by the unrounded rate."},
    }
    sizes = {None: ("alle Tischgrössen", "all table sizes"), 2: ("Zweierpartien", "two-player matches"),
             3: ("Dreierpartien", "three-player matches"), 4: ("Viererpartien", "four-player matches")}[players]
    opponents_copy = {"all": ("mit und ohne CPU", "with and without CPUs"),
                      "human": ("ausschliesslich menschliche Sitze", "human seats only"),
                      "cpu": ("mit mindestens einer CPU", "with at least one CPU")}[opponents]
    return {"schema_version": 1, "game_type": "watten", "status": "draft", "coverage": {"complete": True},
            "metric": metric, "cohort": {"players": players, "opponents": opponents},
            "cohort_definition": {"de": f"Aktive Konten: {sizes[0]}, {opponents_copy[0]}.",
                                  "en": f"Active accounts: {sizes[1]}, {opponents_copy[1]}."},
            "population": "credited_matches_and_grants" if metric == "xp" else "all_completed_matches",
            "minimum_matches": minimum, "definition": definitions[metric], "total_players": len(ordered),
            "entries": [entry(identifier) for identifier in ordered[:limit]],
            "own_entry": entry(user_id) if user_id in totals else None}
