"""Rare Watten table effects with durable, account-bound completion evidence.

Offers and events contain public cosmetic information only. A live effect
requires two connected authenticated humans, changes no card/turn state, and
awards nothing until a native completed match has a stored personal credit.
"""

from __future__ import annotations

from hashlib import sha256
from uuid import uuid4

from fastapi import WebSocketDisconnect
from sqlalchemy import select

from .database import database_schema_ready, session_scope
from .models import (
    ActiveGame,
    User,
    WattenAchievementGrant,
    WattenMatchCredit,
    WattenProgressState,
    WattenTableSurpriseClaim,
    WattenTableSurpriseWitness,
)
from .security import as_utc, utcnow
from .watten_evidence import UNKNOWN, validate_membership
from .watten_progression import DRAFT_CATALOG_VERSION, DRAFT_POLICY_VERSION, Achievement, Text

EFFECTS = ("star", "hammer", "ufo", "portal", "dragon", "kraken", "clock", "blackhole")
_NAMES = (("Sternstunde", "Star moment"), ("Hammerauftritt", "Hammer time"), ("Besuch von oben", "Visitors from above"),
          ("Tür ins Blaue", "Door into the blue"), ("Drache am Stammtisch", "Dragon at the table"),
          ("Acht Arme am Tisch", "Eight arms at the table"), ("Zeit für Watten", "Time for Watten"),
          ("Loch im Wirtshaustisch", "Hole in the inn table"))
SURPRISE_ACHIEVEMENTS = tuple(
    Achievement(f"watten_surprise_{effect}_{role}", Text(de if role == "trigger" else f"{de} miterlebt",
                en if role == "trigger" else f"Witnessed: {en}"),
                Text("Löse die seltene Tischüberraschung selbst aus und beende das Spiel; mindestens zwei Menschen müssen verbunden mitspielen."
                     if role == "trigger" else "Erlebe die seltene Tischüberraschung verbunden mit und beende das Spiel; mindestens zwei Menschen müssen verbunden mitspielen.",
                     "Trigger the rare table surprise and complete the match; at least two humans must be connected and playing."
                     if role == "trigger" else "Witness the rare table surprise while connected and complete the match; at least two humans must be connected and playing."),
                "", 1, 25 if role == "trigger" else 10)
    for effect, (de, en) in zip(EFFECTS, _NAMES) for role in ("trigger", "witness")
)
_GOALS = {goal.achievement_id: goal for goal in SURPRISE_ACHIEVEMENTS}


def eligible_effect(game_id: str, deal_id: str) -> str | None:
    chance = sha256(f"watten-surprise-eligibility:v1:{game_id}:{deal_id}".encode()).digest()
    if int.from_bytes(chance, "big") % 50:
        return None
    variant = sha256(f"watten-surprise-variant:v1:{game_id}:{deal_id}".encode()).digest()
    return EFFECTS[int.from_bytes(variant, "big") % len(EFFECTS)]


def table_effects_projection(game: dict) -> dict:
    """The accepted durable claim paints this whole table, including rejoining
    viewers and later deals. A new table has no such claim and starts clean.

    The primary key begins with game_id; this bounded lookup neither loads
    witnesses nor changes the versioned engine/checkpoint schema.
    """
    if not database_schema_ready():
        return {"scorched_cards": False}
    with session_scope() as db:
        scorched = db.scalar(select(WattenTableSurpriseClaim.event_id).where(
            WattenTableSurpriseClaim.game_id == game["_id"],
            WattenTableSurpriseClaim.effect == "dragon").limit(1)) is not None
    return {"scorched_cards": scorched}


def _connected(game: dict, identity_for_socket=None) -> tuple:
    runtime = game["_watten"]
    humans = []
    for member in runtime.room.members:
        if member.seat is None or member.participant_id in runtime.absent:
            continue
        transport = next((item for item in game["_players"] if item["id"] == member.participant_id
                          and item.get("user_id") == member.account_id and item.get("ws") is not None), None)
        if transport is None:
            continue
        if identity_for_socket is not None:
            identity = identity_for_socket(transport["ws"])
            if identity is None or identity.user_id != member.account_id:
                continue
        humans.append(member)
    return tuple(humans)


def surprise_offer(game: dict, viewer_id: str | None) -> dict:
    runtime = game["_watten"]
    engine = runtime.engine
    offer = {"deal_id": engine.deal_id if engine else None, "effect": None}
    if (engine is None or engine.phase != "play" or runtime.absent or game.get("_finished")
            or game.get("_aborted") or viewer_id not in {item.participant_id for item in _connected(game)}
            or len(_connected(game)) < 2 or not database_schema_ready()):
        return offer
    effect = eligible_effect(game["_id"], engine.deal_id)
    if effect is None:
        return offer
    with session_scope() as db:
        if db.get(WattenTableSurpriseClaim, (game["_id"], engine.deal_id)) is None:
            offer["effect"] = effect
    return offer


async def handle_surprise(session, data: dict, identity_for_socket) -> None:
    """Caller owns the native game lock and has verified transport ownership."""
    game, runtime = session.game, session.game["_watten"]
    engine = runtime.engine
    if (set(data) != {"action", "deal_id", "effect"} or session.is_spectator or engine is None
            or engine.phase != "play" or runtime.absent or game.get("_finished") or game.get("_aborted")
            or data["deal_id"] != engine.deal_id or data["effect"] not in EFFECTS
            or eligible_effect(game["_id"], engine.deal_id) != data["effect"]):
        raise ValueError("watten_action_unavailable")
    humans = _connected(game, identity_for_socket)
    if len(humans) < 2 or session.player_id not in {member.participant_id for member in humans}:
        raise ValueError("watten_action_unavailable")
    from .watten_recipe import dumps_canonical_json
    from .watten_runtime import serialize_watten_game

    with session_scope() as db:
        # Serialize with checkpoint writers, including on SQLite. A stale
        # process may never claim against a newer persisted turn or terminal.
        if db.get_bind().dialect.name == "sqlite":
            connection = db.connection()
            if not connection.connection.driver_connection.in_transaction:
                connection.exec_driver_sql("BEGIN IMMEDIATE")
        source = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]).with_for_update())
        if source != dumps_canonical_json(serialize_watten_game(game)):
            raise ValueError("watten_stale_revision")
        if db.get(WattenTableSurpriseClaim, (game["_id"], engine.deal_id)) is not None:
            raise ValueError("watten_action_unavailable")
        if any((account := db.get(User, member.account_id)) is None or not account.is_active for member in humans):
            raise ValueError("watten_action_unavailable")
        event_id, now = uuid4().hex, utcnow()
        db.add(WattenTableSurpriseClaim(game_id=game["_id"], deal_id=engine.deal_id, effect=data["effect"],
                                       event_id=event_id, claimed_at=now, human_count=len(humans)))
        db.flush()
        for member in humans:
            db.add(WattenTableSurpriseWitness(game_id=game["_id"], deal_id=engine.deal_id, user_id=member.account_id,
                                             player_id=member.participant_id, initiated=member.participant_id == session.player_id))
    # The completed transaction, never a speculative client tap, authorizes
    # this live event. Reconnect snapshots expose no event or witness history.
    event = {"id": event_id, "effect": data["effect"], "deal_id": engine.deal_id, "game_id": game["_id"]}
    appearance = table_effects_projection(game)
    for recipient in [*game["_players"], *game["_spectators"]]:
        websocket = recipient.get("ws")
        if websocket is None:
            continue
        identity = identity_for_socket(websocket)
        if identity is not None and identity.user_id == recipient.get("user_id"):
            try:
                await websocket.send_json({"watten_table_surprise": event, "watten_table_effects": appearance})
            except (WebSocketDisconnect, RuntimeError, OSError):
                pass


def surprise_facts(db, user_id: int) -> tuple:
    """One private read per account, reused across its complete source history."""
    return tuple(db.execute(select(WattenTableSurpriseClaim, WattenTableSurpriseWitness).join(
        WattenTableSurpriseWitness,
        (WattenTableSurpriseWitness.game_id == WattenTableSurpriseClaim.game_id)
        & (WattenTableSurpriseWitness.deal_id == WattenTableSurpriseClaim.deal_id)).where(
            WattenTableSurpriseWitness.user_id == user_id)
        .order_by(WattenTableSurpriseClaim.claimed_at, WattenTableSurpriseClaim.deal_id)))


def qualifying_surprises(db, evidence, bindings, user_id: int, *, facts=None) -> dict:
    """Private frozen membership + durable activation prove each account's role."""
    if evidence.started_at is UNKNOWN:
        return {}
    own = validate_membership(evidence, viewer_user_id=user_id, bindings=bindings)
    rows = surprise_facts(db, user_id) if facts is None else facts
    result = {}
    for claim, witness in rows:
        if (claim.game_id != evidence.game_id or witness.user_id != user_id or witness.player_id != own.player_id
                or claim.deal_id not in {deal.deal_id for deal in evidence.deals}
                or not 2 <= claim.human_count <= evidence.player_count
                or eligible_effect(evidence.game_id, claim.deal_id) != claim.effect
                or not evidence.started_at <= as_utc(claim.claimed_at) <= evidence.finished_at):
            continue
        role = "trigger" if witness.initiated else "witness"
        result.setdefault(f"watten_surprise_{claim.effect}_{role}", claim)
    return result


def store_surprise_achievements(db, evidence, bindings) -> None:
    """Extend the existing grant sequence only after the native credit is stored."""
    from .watten_merge import effective_awards, is_merged
    db.flush()
    for user_id in sorted(binding.user_id for binding in bindings if binding.user_id is not None):
        state = db.scalar(select(WattenProgressState).where(WattenProgressState.user_id == user_id)
                          .with_for_update().execution_options(populate_existing=True))
        if state is None or db.get(WattenMatchCredit, (user_id, state.generation, evidence.game_id)) is None:
            continue
        inherited = effective_awards(db, user_id) if is_merged(db, user_id) else {}
        for key in qualifying_surprises(db, evidence, bindings, user_id):
            if key in inherited or db.get(WattenAchievementGrant, (user_id, state.generation, key)) is not None:
                continue
            state.grant_sequence += 1
            db.add(WattenAchievementGrant(user_id=user_id, generation=state.generation, achievement_id=key,
                                         catalog_version=DRAFT_CATALOG_VERSION, source_game_id=evidence.game_id,
                                         reached_at=evidence.finished_at, xp=_GOALS[key].xp,
                                         policy_version=DRAFT_POLICY_VERSION, grant_sequence=state.grant_sequence))
            db.flush()

    from .account_progress import progress_owner_ids
    from .watten_merge import grant_combined
    identities = [binding.user_id for binding in bindings if binding.user_id is not None]
    for owner_id in sorted(set(progress_owner_ids(db, identities).values())):
        if is_merged(db, owner_id):
            grant_combined(db, owner_id, reached_at=evidence.finished_at)
