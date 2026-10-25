"""Pure Watten progression evaluation, consumed by the native durable journal.

Version 1 is the calibration example from WATTEN_PROGRESSION_PLAN.md. Humans
receive the same ten proposed XP at human/CPU tables, including valid short
matches. XP measures participation, not skill, Elo or a competition ranking.
Calling evaluate_draft again recomputes the same complete proposal; the
transactional journal separately enforces durable exactly-once grants.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime

from .watten_evidence import UNKNOWN, MatchEvidence, ProjectedBinding, replay_score_accounts, validate_membership

DRAFT_POLICY_VERSION = 1
DRAFT_CATALOG_VERSION = 3
DRAFT_MATCH_XP = 10
MAX_ONETIME_XP_BUDGET = 3500


class WattenProgressionError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class Text:
    de: str
    en: str


@dataclass(frozen=True, slots=True)
class Title:
    level: int
    xp: int
    name: Text


_TITLE_ROWS = (
    (0, "Türgucker", "Peeking through the door"),
    (20, "Banklfinder", "Bench finder"),
    (50, "Platznehmer", "Taking a seat"),
    (90, "Kartenwärmer", "Card warmer"),
    (150, "Blattlsortierer", "Hand sorter"),
    (230, "Stichsucher", "Trick seeker"),
    (330, "Rundenschnupperer", "Getting a taste for the game"),
    (460, "Trumpfspürer", "Trump tracker"),
    (630, "Schlagmerker", "Schlag spotter"),
    (850, "Bankltüftler", "Bench tactician"),
    (1130, "Ansagefuchs", "Canny caller"),
    (1480, "Partnerversteher", "In tune with a partner"),
    (1910, "Tischstratege", "Table strategist"),
    (2430, "Wirtshausfuchs", "Wily inn regular"),
    (3050, "Rundenkenner", "Seasoned player"),
    (3780, "Stammtischstütze", "Pillar of the regulars' table"),
    (4630, "Blattlmeister", "Master of the hand"),
    (5610, "Wattermeister", "Watten master"),
    (6730, "Stammtischgrösse", "Big name at the regulars' table"),
    (8000, "Wirtshauslegende", "Inn legend"),
    (9430, "Watterlegende", "Watten legend"),
    (11030, "Watter-Urgestein", "Watten stalwart"),
)
DRAFT_TITLES = tuple(Title(index + 1, xp, Text(de, en)) for index, (xp, de, en) in enumerate(_TITLE_ROWS))


@dataclass(frozen=True, slots=True)
class Achievement:
    achievement_id: str
    name: Text
    condition: Text
    counter: str
    target: int
    xp: int


def _quantity(target, xp, de, en):
    condition = (Text("Schliesse eine reguläre Watten-Partie ab.", "Complete one regular Watten match.") if target == 1 else
                 Text(f"Schliesse {target} reguläre Watten-Partien ab.", f"Complete {target} regular Watten matches."))
    return Achievement(f"watten_matches_{target}", Text(de, en),
                       condition, "completed", target, xp)


def _goal(key, de, en, description_de, description_en, counter, target, xp):
    return Achievement(f"watten_{key}", Text(de, en), Text(description_de, description_en), counter, target, xp)


DRAFT_ACHIEVEMENTS = (
    _quantity(1, 10, "Aufi geht's!", "Let's get playing!"),
    _quantity(5, 20, "No a Runde", "Another round"),
    _quantity(10, 30, "Hocker warm", "Seat warmed up"),
    _quantity(50, 60, "Banklbekanntschaft", "A familiar face at the bench"),
    _quantity(100, 100, "Stammplatz gefunden", "Found my regular seat"),
    _quantity(250, 150, "Am Tisch daheim", "At home at the table"),
    _quantity(500, 250, "Gehört zum Inventar", "Part of the furniture"),
    _quantity(1000, 400, "Bankl mit Namensschild", "A bench with my name on it"),
    _goal("two", "Zu zweit geht's aa", "Two make a table", "Schliesse eine Zweierpartie ab.",
          "Complete a two-player match.", "two", 1, 20),
    _goal("three", "Aller guten Watter sind drei", "Three's a good table", "Schliesse eine Dreierpartie ab.",
          "Complete a three-player match.", "three", 1, 30),
    _goal("four", "Vier Leut, ein Tisch", "Four players, one table", "Schliesse eine Viererpartie ab.",
          "Complete a four-player match.", "four", 1, 30),
    _goal("variety", "Für jede Bank a Platz", "A seat at every table",
          "Schliesse je eine Zweier-, Dreier- und Viererpartie ab.",
          "Complete a match with each of two, three and four players.", "variety", 3, 50),
    _goal("team_first", "Gscheid zamgspielt", "Played well together", "Gewinne eine Viererpartie mit deinem Team.",
          "Win a four-player match with your team.", "team_wins", 1, 40),
    _goal("team_ten", "Eingespielte Bank", "A well-matched bench", "Gewinne zehn Viererpartien mit deinem Team.",
          "Win ten four-player matches with your team.", "team_wins", 10, 100),
    _goal("cpu_first", "Mit'm Computer auf Du", "On first-name terms with the CPU",
          "Schliesse eine Partie mit mindestens einer CPU ab.",
          "Complete a match with at least one CPU.", "cpu_matches", 1, 20),
    _goal("cpu_twentyfive", "Stammgast aus Silizium", "A silicon regular",
          "Schliesse 25 Partien mit CPU-Beteiligung ab.", "Complete 25 matches that include a CPU.", "cpu_matches", 25, 80),
    _goal("days_two", "Da bin i wieder", "Back at the table", "Schliesse an zwei verschiedenen Schweizer Kalendertagen je eine Partie ab.",
          "Complete matches on two different Swiss calendar days.", "days", 2, 30),
    _goal("days_ten", "Wieder a Platz frei?", "Room for me again?", "Schliesse an zehn verschiedenen Schweizer Kalendertagen je eine Partie ab.",
          "Complete matches on ten different Swiss calendar days.", "days", 10, 70),
    _goal("days_fifty", "Den Weg kennt ma", "I know the way", "Schliesse an 50 verschiedenen Schweizer Kalendertagen je eine Partie ab.",
          "Complete matches on 50 different Swiss calendar days.", "days", 50, 150),
    _goal("days_hundred", "Viele Abende, a Stammtisch", "Many evenings, one table",
          "Schliesse an 100 verschiedenen Schweizer Kalendertagen je eine Partie ab; Pausen sind erlaubt.",
          "Complete matches on 100 different Swiss calendar days; breaks are allowed.", "days", 100, 250),
    _goal("normal", "Laut und deutlich", "Loud and clear", "Schliesse eine belegte Partie mit normaler Ansage ab.",
          "Complete a match with a confirmed normal-call profile.", "normal", 1, 20),
    _goal("ladinisch", "Kurz gschaut, gut gmerkt", "A quick look, well remembered",
          "Schliesse eine belegte Ladinisch-Partie ab.", "Complete a match with a confirmed Ladinisch profile.", "ladinisch", 1, 30),
    _goal("blind", "Mit Gspür am Tisch", "A feel for the table", "Schliesse eine belegte blinde Viererpartie ab.",
          "Complete a match with a confirmed blind four-player profile.", "blind", 1, 40),
    _goal("critical", "Die Kritischen kennen mi", "The criticals know me",
          "Schliesse eine belegte Partie mit Kritischen ab.",
          "Complete a match with a confirmed critical-card profile.", "critical", 1, 40),
    _goal("bid", "A bissl mehr geht", "A little more", "Biete selbst in einer Partie mit vollständig belegten Gebotsdaten.",
          "Initiate a bid in a match with complete public bid records.", "bid_matches", 1, 20),
    _goal("counter", "I leg no oan drauf", "One more from me",
          "Kontere selbst in einer Partie mit vollständig belegten Gebotsdaten.",
          "Counter a bid in a match with complete public bid records.", "counter_matches", 1, 30),
    _goal("quiet_win", "Leise gewonnen", "Quiet win",
          "Gewinne ohne eigenes Bieten oder Kontern; die Gebotsdaten müssen vollständig belegt sein.",
          "Win without initiating or countering a bid; public bid records must be complete.", "quiet_wins", 1, 40),
    _goal("schneider_win", "Sauber gschneidert", "Clean Schneider",
          "Gewinne ein vollständig belegtes Spiel, ohne dass die Gegenseite Punkte erzielt. Ein angenommener Retourschneider zählt nicht.",
          "Win a fully recorded match while every opposing score remains zero. An accepted Retourschneider does not count.",
          "schneider_wins", 1, 60),
    _goal("retourschneider_win", "Vier Nockerl, bitte!", "Four loss marks, please!",
          "Gewinne mit deinem Team einen angenommenen Retourschneider vollständig: Nach dem Löschen eurer Punkte müsst ihr jede Runde bis zum Spielsieg gewinnen.",
          "Win an accepted Retourschneider with your team: after erasing your score, win every remaining round until the match is won.",
          "retourschneider_wins", 1, 120),
    _goal("eight_plus_three", "8+3 isch Mittag", "8+3 means lunchtime",
          "Gewinne zehn vollständig belegte Spiele bis elf mit der letzten Runde von genau acht auf elf Punkte. Die letzte Runde muss drei Punkte bringen; angenommene Retourschneider zählen nicht.",
          "Win ten fully recorded matches played to eleven by moving from exactly eight to eleven points in the final three-point round. Accepted Retourschneider games do not count.",
          "eight_plus_three_wins", 10, 80),
    _goal("retourschneider_eight_plus_three_three", "8+3 isch Feiertag", "8+3 means a holiday",
          "Gewinne mit deinem Team drei angenommene Retourschneider bis elf mit der letzten Runde von genau acht auf elf Punkte. Die letzte Runde muss drei Punkte bringen.",
          "Win three accepted Retourschneider matches played to eleven with your team, moving from exactly eight to eleven points in the final three-point round.",
          "retourschneider_eight_plus_three_wins", 3, 100),
    _goal("retourschneider_eight_plus_three", "8+3 isch a Wunder", "8+3 means a miracle",
          "Gewinne mit deinem Team zehn angenommene Retourschneider bis elf mit der letzten Runde von genau acht auf elf Punkte. Die letzte Runde muss drei Punkte bringen.",
          "Win ten accepted Retourschneider matches played to eleven with your team, moving from exactly eight to eleven points in the final three-point round.",
          "retourschneider_eight_plus_three_wins", 10, 200),
    # Catalogue version 3 appends these two goals; earlier IDs and prices stay unchanged.
    _goal("comeback_seven", "Vom Rand zurück", "Back from the edge",
          "Gewinne ein vollständig belegtes Spiel bis elf, nachdem du zwischenzeitlich mindestens sieben Punkte hinter der stärksten Gegenseite lagst. Zu dritt musst du am Ende mindestens so viele Punkte haben wie alle anderen. Ein angenommener Retourschneider zählt nicht.",
          "Win a fully recorded match to eleven after trailing the strongest opponent by at least seven points. In a three-player match you must finish with at least as many points as everyone else. An accepted Retourschneider does not count.",
          "comeback_wins", 1, 80),
    _goal("raised_every_win", "Nur mit Aufschlag", "Never at the base stake",
          "Gewinne ein Spiel mit vollständig belegten Geboten, in dem deine Seite mindestens drei Runden gewinnt und jede davon mehr als zwei Punkte bringt. Du selbst musst dabei mindestens einmal bieten, kontern oder halten.",
          "Win a match with complete bid records in which your side wins at least three rounds, each worth more than two points. You must bid, counter or hold at least once yourself.",
          "raised_wins", 1, 60),
)
MAX_DRAFT_ACHIEVEMENT_XP = sum(item.xp for item in DRAFT_ACHIEVEMENTS)


@dataclass(frozen=True, slots=True)
class MatchInput:
    evidence: MatchEvidence
    bindings: tuple[ProjectedBinding, ...]


@dataclass(frozen=True, slots=True)
class MatchCredit:
    game_id: str
    player_id: str
    finished_at: datetime
    play_day: str
    player_count: int
    cpu_count: int
    won: bool
    xp: int = DRAFT_MATCH_XP
    policy_version: int = DRAFT_POLICY_VERSION
    catalog_version: int = DRAFT_CATALOG_VERSION


@dataclass(frozen=True, slots=True)
class AchievementGrant:
    achievement_id: str
    source_game_id: str
    reached_at: datetime
    xp: int
    policy_version: int = DRAFT_POLICY_VERSION
    catalog_version: int = DRAFT_CATALOG_VERSION


@dataclass(frozen=True, slots=True)
class Counters:
    completed: int = 0
    wins: int = 0
    two: int = 0
    three: int = 0
    four: int = 0
    variety: int = 0
    team_wins: int = 0
    cpu_matches: int = 0
    days: int = 0
    normal: int = 0
    ladinisch: int = 0
    blind: int = 0
    critical: int = 0
    bid_matches: int = 0
    counter_matches: int = 0
    quiet_wins: int = 0
    schneider_wins: int = 0
    retourschneider_wins: int = 0
    eight_plus_three_wins: int = 0
    retourschneider_eight_plus_three_wins: int = 0
    comeback_wins: int = 0
    raised_wins: int = 0


@dataclass(frozen=True, slots=True)
class TitleProgress:
    current: Title
    next_title: Title | None
    xp_to_next: int


def title_for_xp(xp: int) -> TitleProgress:
    if type(xp) is not int or xp < 0:
        raise WattenProgressionError("watten_progression_invalid_xp")
    current = max((item for item in DRAFT_TITLES if item.xp <= xp), key=lambda item: item.level)
    next_title = DRAFT_TITLES[current.level] if current.level < len(DRAFT_TITLES) else None
    return TitleProgress(current, next_title, next_title.xp - xp if next_title else 0)


@dataclass(frozen=True, slots=True)
class ProgressionProposal:
    viewer_user_id: int
    credits: tuple[MatchCredit, ...]
    achievements: tuple[AchievementGrant, ...]
    counters: Counters
    play_days: tuple[str, ...]
    match_xp: int
    achievement_xp: int
    total_xp: int
    title: TitleProgress
    status: str = "draft"
    policy_version: int = DRAFT_POLICY_VERSION
    catalog_version: int = DRAFT_CATALOG_VERSION


def _advance(current: Counters, evidence: MatchEvidence, own, days: set[str]) -> Counters:
    mode = {2: "two", 3: "three", 4: "four"}[evidence.player_count]
    values = {mode: getattr(current, mode) + 1, "completed": current.completed + 1,
              "wins": current.wins + own.won, "days": len(days),
              "cpu_matches": current.cpu_matches + any(item.is_cpu for item in evidence.roster),
              "team_wins": current.team_wins + (evidence.player_count == 4 and own.won)}
    profile = evidence.profile
    if profile is not UNKNOWN:
        values[profile.determination] = getattr(current, profile.determination) + 1
        values["blind"] = current.blind + profile.blind
        values["critical"] = current.critical + profile.critical
    if evidence.bids.complete:
        bids = next(item for item in evidence.bids.players if item.player_id == own.player_id)
        values["bid_matches"] = current.bid_matches + (bids.initiated > 0)
        values["counter_matches"] = current.counter_matches + (bids.countered > 0)
        values["quiet_wins"] = current.quiet_wins + (own.won and bids.initiated == bids.countered == 0)
        # Membership is checked per deal: three-player solo/pair sides change every deal.
        # Deals won before an accepted Retourschneider still count (stricter).
        won_deals = [deal for deal in evidence.deals if own.player_id in deal.parties[deal.winning_party]]
        values["raised_wins"] = current.raised_wins + (
            own.won and len(won_deals) >= 3 and all(deal.points >= 3 for deal in won_deals)
            and bids.initiated + bids.countered + bids.held >= 1)
    if own.won and evidence.source == "public_match_v1":
        # Native completed evidence has already replayed every score and the
        # accepted erasure. Legacy unknown data cannot invent a comeback.
        retour = evidence.retourschneider
        own_score = next(score for score in evidence.scores if own.player_id in score.members)
        final = evidence.deals[-1]
        # Full evidence replays scores and earlier erasures: final 11 minus
        # the last three-point round proves an immediately preceding eight.
        eight_plus_three = (evidence.target_points == 11 and own_score.points == 11 and final.points == 3
                            and own.player_id in final.parties[final.winning_party])
        if retour is not None and retour.accepted:
            values["retourschneider_wins"] = current.retourschneider_wins + (own.player_id in retour.members)
            values["retourschneider_eight_plus_three_wins"] = current.retourschneider_eight_plus_three_wins + (
                eight_plus_three and own.player_id in retour.members)
        elif all(score.points == 0 for score in evidence.scores if score.members not in evidence.winners):
            values["schneider_wins"] = current.schneider_wins + 1
        if retour is None or not retour.accepted:
            values["eight_plus_three_wins"] = current.eight_plus_three_wins + eight_plus_three
        if (evidence.target_points == 11 and (retour is None or not retour.accepted)
                and (evidence.player_count != 3 or all(own_score.points >= score.points for score in evidence.scores))):
            # The validated replay (including a declined Retourschneider) gives each
            # deal's scores; the final deal is excluded, the deficit must come before it.
            deficits = [max(score.points for score in snapshot if own.player_id not in score.members)
                        - next(score.points for score in snapshot if own.player_id in score.members)
                        for snapshot in replay_score_accounts(evidence)[:-1]]
            values["comeback_wins"] = current.comeback_wins + (max(deficits, default=0) >= 7)
    result = replace(current, **values)
    return replace(result, variety=sum(getattr(result, key) > 0 for key in ("two", "three", "four")))


def evaluate_draft(matches: tuple[MatchInput, ...], *, viewer_user_id: int) -> ProgressionProposal:
    """Evaluate a trusted complete input set, without writing or consuming grants.

    Every occurrence passes full relational membership validation, including a
    duplicate. Same game ID with conflicting evidence or bindings is rejected.
    Out-of-order input produces the same chronological credits/grant sources.
    """
    if type(viewer_user_id) is not int or viewer_user_id < 1 or type(matches) is not tuple:
        raise WattenProgressionError("watten_progression_invalid_input")
    unique = {}
    for item in matches:
        if type(item) is not MatchInput:
            raise WattenProgressionError("watten_progression_invalid_input")
        own = validate_membership(item.evidence, viewer_user_id=viewer_user_id, bindings=item.bindings)
        ordered = tuple(sorted(item.bindings, key=lambda row: row.position))
        canonical = MatchInput(item.evidence, ordered)
        previous = unique.get(item.evidence.game_id)
        if previous is not None and previous[0] != canonical:
            raise WattenProgressionError("watten_progression_conflicting_match")
        unique[item.evidence.game_id] = canonical, own
    credits, grants, unlocked, days = [], [], set(), set()
    counters = Counters()
    for item, own in sorted(unique.values(), key=lambda pair: (pair[0].evidence.finished_at, pair[0].evidence.game_id)):
        evidence = item.evidence
        days.add(evidence.play_day)
        counters = _advance(counters, evidence, own, days)
        credits.append(MatchCredit(evidence.game_id, own.player_id, evidence.finished_at, evidence.play_day,
                                   evidence.player_count, sum(player.is_cpu for player in evidence.roster), own.won))
        for achievement in DRAFT_ACHIEVEMENTS:
            if achievement.achievement_id not in unlocked and getattr(counters, achievement.counter) >= achievement.target:
                unlocked.add(achievement.achievement_id)
                grants.append(AchievementGrant(achievement.achievement_id, evidence.game_id, evidence.finished_at, achievement.xp))
    match_xp = len(credits) * DRAFT_MATCH_XP
    achievement_xp = sum(item.xp for item in grants)
    total = match_xp + achievement_xp
    return ProgressionProposal(viewer_user_id, tuple(credits), tuple(grants), counters, tuple(sorted(days)),
                               match_xp, achievement_xp, total, title_for_xp(total))
