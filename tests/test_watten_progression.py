"""Draft calibration on legal evidence; no production grants or timing claims."""

from dataclasses import FrozenInstanceError, replace
from datetime import timedelta

import pytest

from app.watten_bidding import retourschneider_candidate
from app.watten_cards import DealtCards, make_deck
from app.watten_engine import SeatBinding, next_deal, retourschneider_decider, retourschneider_offer, start_match
from app.watten_evidence import (
    UNKNOWN,
    BidEvidence,
    PlayerBids,
    PublicProfile,
    WattenEvidenceError,
    adapt_result_v1,
    replay_score_accounts,
)
from app.watten_match_evidence import advance_bid_counters, new_bid_counters
from app.watten_play import legal_cards
from app.watten_progression import (
    DRAFT_ACHIEVEMENTS,
    DRAFT_CATALOG_VERSION,
    DRAFT_MATCH_XP,
    DRAFT_POLICY_VERSION,
    DRAFT_TITLES,
    MAX_DRAFT_ACHIEVEMENT_XP,
    MAX_ONETIME_XP_BUDGET,
    MatchInput,
    WattenProgressionError,
    evaluate_draft,
    title_for_xp,
)
from app.watten_surprises import SURPRISE_ACHIEVEMENTS
from tests.test_watten_engine import dealt, finish, ready, recipe, step
from tests.test_watten_evidence import (
    FINISHED,
    bindings_for,
    co_winner_result,
    native_result,
    public_evidence,
    result_for,
    scored_go,
)


def observed_profile(count_players=4, *, determination="ladinisch", blind=True, critical=True, cpus=(1,)):
    original = recipe(count_players, determination, blind, critical, target_points=3)
    bindings = tuple(SeatBinding(item.player_id, None if index in cpus else item.account_id)
                     for index, item in enumerate(original.bindings))
    state = start_match(replace(original, bindings=bindings), "profile-0", dealt(count_players), first_dealer="A")
    for number in range(20):
        state = finish(ready(state))
        if state.phase == "match_complete":
            break
        candidate = retourschneider_candidate(state.ledger)
        if candidate is not None:
            state = step(state, candidate[0], "retourschneider", "decline")
        state = next_deal(state, f"profile-{number + 1}", dealt(count_players))
    assert state.phase == "match_complete"
    old = adapt_result_v1(result_for(state), finished_at=FINISHED)
    profile = PublicProfile("watten-house", 1, determination, blind, critical, False, False, False)
    # This fixture observes every real command, all of which were card plays
    # and call/inspection actions. Complete zeros therefore have actual proof.
    bids = BidEvidence(True, tuple(PlayerBids(player, 0, 0, 0, 0) for player in state.recipe.seats))
    return replace(old, source="public_match_v1", profile=profile, started_at=FINISHED - timedelta(seconds=1), bids=bids)


def input_for(evidence, *, own_player=None):
    own_player = own_player or next(item.player_id for item in evidence.roster if not item.is_cpu)
    assert not next(item for item in evidence.roster if item.player_id == own_player).is_cpu
    bindings, other = [], 2
    for item in bindings_for(evidence):
        if item.user_id is None:
            bindings.append(item)
        elif item.player_id == own_player:
            bindings.append(replace(item, user_id=1))
        else:
            bindings.append(replace(item, user_id=other))
            other += 1
    return MatchInput(evidence, tuple(bindings))


def reidentified(item, number, *, day_offset=0):
    game_id = f"match-{number:05}"
    evidence = replace(item.evidence, game_id=game_id, finished_at=FINISHED + timedelta(days=day_offset),
                       started_at=(UNKNOWN if item.evidence.started_at is UNKNOWN
                                   else FINISHED + timedelta(days=day_offset) - timedelta(seconds=1)))
    return MatchInput(evidence, tuple(replace(binding, game_id=game_id) for binding in item.bindings))


def awarded(proposal):
    return {item.achievement_id for item in proposal.achievements}


def winning_player(evidence):
    return next(item.player_id for item in evidence.roster
                if not item.is_cpu and any(item.player_id in winners for winners in evidence.winners))


def counter_evidence():
    state = scored_go(start_match(recipe(2, target_points=3), "counter", dealt(2), first_dealer="A"), 0, 4)
    evidence = public_evidence(result_for(state))
    return replace(evidence, bids=BidEvidence(True, (PlayerBids("A", 1, 1, 0, 0), PlayerBids("B", 0, 1, 0, 1))))


def schneider_evidence():
    state = scored_go(start_match(recipe(2, target_points=3), "schneider", dealt(2), first_dealer="A"), 0, 4)
    return public_evidence(result_for(state))


def retourschneider_state(*, fail=False):
    state = start_match(recipe(4), "retour-first", dealt(), first_dealer="A")
    state = scored_go(state, 1, 2)
    state = next_deal(state, "retour-gestrichen", dealt())
    state = scored_go(state, 0, 9)
    for player in state.parties.parties[1]:
        state = step(state, player, "retourschneider", "accept")
    if fail:
        hands = (("bells-A", "bells-K", "bells-O", "bells-U", "bells-10"),
                 ("hearts-8", "hearts-9", "hearts-10", "hearts-U", "hearts-O"),
                 ("bells-7", "hearts-7", "leaves-7", "acorns-7", "bells-6"),
                 ("leaves-8", "leaves-9", "leaves-10", "leaves-U", "leaves-O"))
        used = {card for hand in hands for card in hand}
        deal = DealtCards(hands, tuple(card for card in make_deck() if card not in used), tuple(hand[-1] for hand in hands))
        state = finish(ready(next_deal(state, "retour-failed", deal)))
    for number in range(6):
        if state.phase == "match_complete":
            break
        state = next_deal(state, f"retour-comeback-{number}", dealt())
        state = scored_go(state, 1, 2)
        if state.phase == "match_complete":
            break
    assert state.phase == "match_complete"
    return state


def retourschneider_evidence(*, fail=False):
    return public_evidence(result_for(retourschneider_state(fail=fail)))


def eight_plus_three_evidence(*, retour=False, prefix=8, last_points=3, target=11):
    state = start_match(recipe(4 if retour else 2, target_points=target), "eight-start", dealt(4 if retour else 2), first_dealer="A")
    if retour:
        state = scored_go(state, 1, 2)
        state = scored_go(next_deal(state, "eight-gestrichen", dealt()), 0, 9)
        for player in state.parties.parties[1]:
            state = step(state, player, "retourschneider", "accept")
        state = scored_go(next_deal(state, "eight-return", dealt()), 1, 8)
        # A held three-point round lets the challengers finish 8+3 while
        # the already gestrichen opponents never initiate a forbidden bid.
        hands = (("hearts-8", "hearts-9", "hearts-10", "hearts-U", "hearts-O"),
                 ("bells-A", "bells-K", "bells-O", "bells-U", "bells-10"),
                 ("leaves-8", "leaves-9", "leaves-10", "leaves-U", "leaves-O"),
                 ("bells-7", "hearts-7", "leaves-7", "acorns-7", "bells-6"))
        used = {card for hand in hands for card in hand}
        deal = DealtCards(hands, tuple(card for card in make_deck() if card not in used), tuple(hand[-1] for hand in hands))
        state = ready(next_deal(state, "eight-final", deal))
        first = state.play.current_player_id
        state = step(state, first, "play_card", state.play.hands[state.recipe.seats.index(first)][0])
        state = step(state, "B", "bid")
        state = step(state, state.parties.decider(0), "respond", "hold")
        state = finish(state)
    else:
        state = scored_go(state, 0, prefix)
        state = next_deal(state, "eight-final", dealt(2))
        state = scored_go(state, state.parties.party_of("A"), last_points)
    assert state.phase == "match_complete"
    return public_evidence(result_for(state))


def tracked_step(state, counters, player, kind, value=None):
    """One accepted engine command; bid counters advance exactly as the runtime does."""
    return step(state, player, kind, value), advance_bid_counters(counters, player, kind, value)


def tracked_go(state, counters, winning_party, points):
    """Like scored_go, but every bid actor comes from the accepted commands themselves."""
    state = ready(state)
    starter = winning_party ^ ((points - 2) % 2)
    for _ in range(len(state.recipe.seats) + 1):
        player = state.play.current_player_id
        if state.play.plays and state.parties.party_of(player) == starter:
            break
        state = step(state, player, "play_card", legal_cards(state.play, state.bid_state, player)[0])
    state, counters = tracked_step(state, counters, state.play.current_player_id, "bid")
    for _ in range(points - 2):
        decider = state.parties.decider(1 - state.bid_state.pending.party)
        state, counters = tracked_step(state, counters, decider, "respond", "counter")
    assert state.bid_state.pending.party == winning_party
    return tracked_step(state, counters, state.parties.decider(1 - winning_party), "respond", "go")


def solo(state):
    return next(index for index, party in enumerate(state.parties.parties) if len(party) == 1)


def pair(state):
    return 1 - solo(state)


def tracked_match(count, plan):
    """A real match to eleven: each plan step is (player id or party chooser, deal points).

    Any offered Retourschneider is declined through the real command, as in native_result.
    """
    state = start_match(recipe(count, target_points=11), "tracked-0", dealt(count), first_dealer="A")
    counters = new_bid_counters(state)
    for index, (pick, points) in enumerate(plan):
        if index:
            state = next_deal(state, f"tracked-{index}", dealt(count))
        party = pick(state) if callable(pick) else state.parties.party_of(pick)
        state, counters = tracked_go(state, counters, party, points)
        candidate = retourschneider_candidate(state.ledger) if state.phase != "match_complete" else None
        if candidate is not None:
            state = step(state, candidate[0], "retourschneider", "decline")
    assert state.phase == "match_complete"
    return replace(public_evidence(result_for(state)), bids=BidEvidence(True, counters))


class TrackedJourney:
    """The accepted probe journeys (decider opens, real holds and Retourschneider votes),
    with bid counters advanced only by the runtime's advance_bid_counters."""

    def __init__(self, count, cards=None):
        self.count = count
        self.state = start_match(recipe(count, target_points=11), "tracked-0", cards or dealt(count), first_dealer="A")
        self.counters = new_bid_counters(self.state)

    def step(self, player, kind, value=None):
        self.state, self.counters = tracked_step(self.state, self.counters, player, kind, value)

    def _play_until(self, player):
        for _ in range(self.count * 4):
            state = self.state
            if state.play.plays and state.play.current_player_id == player:
                return
            self.step(state.play.current_player_id, "play_card",
                      legal_cards(state.play, state.bid_state, state.play.current_player_id)[0])
        raise AssertionError("no bid opportunity before the deal ended")

    def _play_out(self):
        while self.state.phase == "play":
            state = self.state
            self.step(state.play.current_player_id, "play_card",
                      legal_cards(state.play, state.bid_state, state.play.current_player_id)[0])

    def go(self, player, points):
        self.state = ready(self.state)
        winner = self.state.parties.party_of(player)
        initiator = self.state.parties.decider(winner ^ ((points - 2) % 2))
        self._play_until(initiator)
        self.step(initiator, "bid")
        for _ in range(points - 2):
            self.step(self.state.parties.decider(1 - self.state.bid_state.pending.party), "respond", "counter")
        assert self.state.bid_state.pending.party == winner
        self.step(self.state.parties.decider(1 - winner), "respond", "go")

    def hold_to_tricks(self, player):
        self.state = ready(self.state)
        opponent = self.state.parties.decider(1 - self.state.parties.party_of(player))
        self._play_until(opponent)
        self.step(opponent, "bid")
        self.step(player, "respond", "hold")
        self._play_out()
        assert self.state.bid_state.result.reason == "tricks"
        assert self.state.bid_state.result.winning_party == self.state.parties.party_of(player)

    def tricks_without_bid(self, player):
        self.state = ready(self.state)
        self._play_out()
        result = self.state.bid_state.result
        assert (result.reason, result.points, result.winning_party) == ("tricks", 2, self.state.parties.party_of(player))

    def next(self, *, accept_retour=False, cards=None):
        members = retourschneider_offer(self.state)
        if members:
            if accept_retour:
                for player in members:
                    self.step(player, "retourschneider", "accept")
            else:
                self.step(retourschneider_decider(self.state, members), "retourschneider", "decline")
        self.state = next_deal(self.state, f"tracked-{len(self.state.ledger.applied_results)}", cards or dealt(self.count))

    def evidence(self):
        assert self.state.phase == "match_complete"
        return replace(public_evidence(result_for(self.state)),
                       bids=BidEvidence(True, self.counters, self.state.discarded_bid_increases))


def seat_cards(strong_seat, count):
    """Every deal: one seat holds the four sevens (strike 7, bells) and the bells ace."""
    strong = ("hearts-7", "bells-7", "leaves-7", "acorns-7", "bells-A")
    weak = [tuple(f"{suit}-{rank}" for rank in ("8", "9", "10", "U", "O")) for suit in ("hearts", "leaves", "acorns")]
    hands = tuple(strong if seat == strong_seat else weak.pop(0) for seat in range(count))
    used = {card for hand in hands for card in hand}
    return DealtCards(hands, tuple(card for card in make_deck() if card not in used), tuple(hand[-1] for hand in hands))


def max_deficit_before_final(evidence, own_player):
    return max(max(score.points for score in snapshot if own_player not in score.members)
               - next(score.points for score in snapshot if own_player in score.members)
               for snapshot in replay_score_accounts(evidence)[:-1])


def solo_of(evidence, index):
    return next(party[0] for party in evidence.deals[index].parties if len(party) == 1)


def unlocked(evidence, own_player):
    return awarded(evaluate_draft((input_for(evidence, own_player=own_player),), viewer_user_id=1))


@pytest.mark.parametrize("count", (2, 4))
@pytest.mark.parametrize("deficit,expected", ((7, True), (6, False)))
def test_comeback_needs_seven_points_behind_the_strongest_opponent_before_the_final_deal(count, deficit, expected):
    evidence = tracked_match(count, [("B", deficit), ("A", 11)])
    assert ("watten_comeback_seven" in unlocked(evidence, "A")) is expected
    assert "watten_comeback_seven" not in unlocked(evidence, "B")


@pytest.mark.parametrize("deficit,expected", ((7, True), (6, False)))
def test_three_player_comeback_against_rotating_solos(deficit, expected):
    evidence = tracked_match(3, [(solo, deficit), (solo, 2), (solo, 11)])
    own = solo_of(evidence, 2)
    assert len({solo_of(evidence, index) for index in range(3)}) == 3
    assert ("watten_comeback_seven" in unlocked(evidence, own)) is expected


def test_three_player_co_winner_still_behind_at_the_end_is_no_comeback():
    evidence = tracked_match(3, [(solo, 7), (pair, 11)])
    leader, own = solo_of(evidence, 0), next(player for player in evidence.deals[1].parties[evidence.deals[1].winning_party]
                                              if player != solo_of(evidence, 0))
    scores = {score.members[0]: score.points for score in evidence.scores}
    assert (scores[own], scores[leader]) == (11, 18) and len(evidence.winners) == 2
    assert "watten_comeback_seven" not in unlocked(evidence, own)


def test_declined_retourschneider_keeps_the_real_score_path_for_a_comeback():
    journey = TrackedJourney(4)
    journey.go("B", 2)
    journey.next()
    journey.go("A", 9)
    # Once gestrichen, nobody may open; B's side then wins base-stake tricks with real cards.
    journey.next(cards=seat_cards(1, 4))
    while journey.state.phase != "match_complete":
        journey.tricks_without_bid("B")
        if journey.state.phase != "match_complete":
            journey.next(cards=seat_cards(1, 4))
    evidence = journey.evidence()
    assert evidence.target_points == 11 and any("B" in winners for winners in evidence.winners)
    assert evidence.retourschneider is not None and not evidence.retourschneider.accepted
    assert max_deficit_before_final(evidence, "B") >= 7
    assert "watten_comeback_seven" in unlocked(evidence, "B")


def test_accepted_retourschneider_excludes_an_otherwise_qualifying_comeback():
    journey = TrackedJourney(4)
    journey.go("B", 2)
    journey.next()
    journey.go("A", 9)
    journey.next(accept_retour=True)
    for _ in range(6):
        journey.go("B", 2)
        if journey.state.phase == "match_complete":
            break
        journey.next()
    evidence = journey.evidence()
    assert evidence.target_points == 11 and any("B" in winners for winners in evidence.winners)
    assert evidence.retourschneider.accepted and evidence.retourschneider.members == ("B", "D")
    assert max_deficit_before_final(evidence, "B") >= 7
    assert "watten_comeback_seven" not in unlocked(evidence, "B")
    assert "watten_retourschneider_win" in unlocked(evidence, "B")


def test_accepted_retourschneider_and_legacy_results_never_count_as_comebacks():
    accepted = retourschneider_evidence()
    assert accepted.retourschneider.accepted
    assert "watten_comeback_seven" not in unlocked(accepted, "B")
    legacy = adapt_result_v1(result_for(retourschneider_state()), finished_at=FINISHED)
    assert "watten_comeback_seven" not in unlocked(legacy, "B")


@pytest.mark.parametrize("plan,expected", (
    ([("A", 3), ("A", 4), ("A", 4)], True),
    ([("A", 2), ("A", 4), ("A", 5)], False),  # one base-stake win
    ([("A", 4), ("A", 7)], False),  # only two won deals
))
def test_raised_every_win_needs_three_raised_own_wins_and_own_bid_action(plan, expected):
    evidence = tracked_match(2, plan)
    assert ("watten_raised_every_win" in unlocked(evidence, "A")) is expected
    assert "watten_raised_every_win" not in unlocked(evidence, "B")
    assert "watten_raised_every_win" not in unlocked(replace(evidence, bids=BidEvidence()), "A")
    legacy = adapt_result_v1(result_for_evidence_state(plan), finished_at=FINISHED)
    assert "watten_raised_every_win" not in unlocked(legacy, "A")


def result_for_evidence_state(plan):
    state = start_match(recipe(2, target_points=11), "tracked-0", dealt(2), first_dealer="A")
    for index, (player, points) in enumerate(plan):
        if index:
            state = next_deal(state, f"tracked-{index}", dealt(2))
        state = scored_go(state, state.parties.party_of(player), points)
    return result_for(state)


def test_raised_every_win_counts_each_four_player_winner_by_own_recorded_bid_action():
    evidence = tracked_match(4, [("A", 3), ("A", 4), ("A", 4)])
    for player in ("A", "C"):
        own = next(item for item in evidence.bids.players if item.player_id == player)
        acted = own.initiated + own.countered + own.held >= 1
        assert ("watten_raised_every_win" in unlocked(evidence, player)) is acted


def test_raised_every_win_counts_four_real_holds_without_any_own_bid_or_counter():
    cards = seat_cards(0, 2)
    journey = TrackedJourney(2, cards)
    for index in range(4):
        if index:
            journey.next(cards=cards)
        journey.hold_to_tricks("A")
    evidence = journey.evidence()
    own = next(item for item in evidence.bids.players if item.player_id == "A")
    assert (own.initiated, own.countered, own.held) == (0, 0, 4)
    assert all(deal.reason == "tricks" and deal.points == 3 for deal in evidence.deals)
    assert "watten_raised_every_win" in unlocked(evidence, "A")


def test_raised_every_win_excludes_a_winning_partner_who_never_bid_countered_or_held():
    journey = TrackedJourney(4)
    for index, (player, points) in enumerate((("A", 3), ("B", 2), ("B", 2), ("A", 4), ("A", 4))):
        if index:
            journey.next()
        journey.go(player, points)
    evidence = journey.evidence()
    silent = next(item for item in evidence.bids.players if item.player_id == "C")
    assert (silent.initiated, silent.countered, silent.held) == (0, 0, 0)
    assert any("C" in winners for winners in evidence.winners)
    assert "watten_raised_every_win" in unlocked(evidence, "A")
    assert "watten_raised_every_win" not in unlocked(evidence, "C")


def test_raised_every_win_follows_three_player_sides_deal_by_deal():
    evidence = tracked_match(3, [(solo, 3), (pair, 4), (pair, 4)])
    own = solo_of(evidence, 0)
    sides = [deal.parties[deal.winning_party] for deal in evidence.deals]
    assert all(own in side for side in sides) and len(set(sides)) == 3
    assert "watten_raised_every_win" in unlocked(evidence, own)


def test_combined_core_and_rare_catalogue_fits_the_one_time_budget():
    assert [item.xp for item in DRAFT_ACHIEVEMENTS[-2:]] == [80, 60]
    assert sum(item.xp for item in DRAFT_ACHIEVEMENTS[:-2]) == 2670 and len(DRAFT_ACHIEVEMENTS[:-2]) == 32
    assert len(SURPRISE_ACHIEVEMENTS) == 16 and sum(item.xp for item in SURPRISE_ACHIEVEMENTS) == 280
    assert MAX_DRAFT_ACHIEVEMENT_XP + sum(item.xp for item in SURPRISE_ACHIEVEMENTS) == 3090 <= MAX_ONETIME_XP_BUDGET
    assert [title.xp for title in DRAFT_TITLES] == [
        0, 20, 50, 90, 150, 230, 330, 460, 630, 850, 1130, 1480, 1910, 2430, 3050, 3780, 4630, 5610, 6730,
        8000, 9430, 11030]


def test_empty_is_explicit_draft_and_first_regular_match_proposes_fast_early_progress():
    empty = evaluate_draft((), viewer_user_id=1)
    assert empty.status == "draft" and empty.total_xp == 0 and not empty.credits and not empty.achievements
    assert empty.policy_version == DRAFT_POLICY_VERSION == 1
    assert empty.catalog_version == DRAFT_CATALOG_VERSION == 3
    assert empty.title.current.level == 1 and empty.title.xp_to_next == 20
    _state, payload = native_result()
    item = input_for(adapt_result_v1(payload, finished_at=FINISHED))
    first = evaluate_draft((item,), viewer_user_id=1)
    assert len(first.credits) == 1 and first.match_xp == DRAFT_MATCH_XP == 10
    assert {"watten_matches_1", "watten_two"} <= awarded(first)
    assert first.title.current.level > 1 and first.title.next_title.xp - first.total_xp == first.title.xp_to_next
    assert all(grant.source_game_id == item.evidence.game_id for grant in first.achievements)
    with pytest.raises(FrozenInstanceError):
        first.credits[0].xp = 999
    with pytest.raises(FrozenInstanceError):
        first.counters.completed = 999


def test_duplicate_reorder_and_repeated_evaluation_are_same_proposal_not_persistent_awards():
    evidence = observed_profile()
    original = input_for(evidence)
    first, second = reidentified(original, 1), reidentified(original, 2, day_offset=2)
    reordered_bindings = replace(first, bindings=tuple(reversed(first.bindings)))
    expected = evaluate_draft((first, second), viewer_user_id=1)
    assert evaluate_draft((second, reordered_bindings, first, second), viewer_user_id=1) == expected
    assert evaluate_draft((first, second), viewer_user_id=1) == expected
    assert len(expected.credits) == 2 and expected.counters.completed == 2
    assert len({item.achievement_id for item in expected.achievements}) == len(expected.achievements)
    assert expected.play_days == tuple(sorted(expected.play_days))


@pytest.mark.parametrize("conflict", ("evidence", "bindings"))
def test_same_game_id_with_different_valid_authoritative_inputs_is_rejected(conflict):
    item = input_for(observed_profile())
    if conflict == "evidence":
        different = replace(item, evidence=replace(item.evidence, finished_at=FINISHED + timedelta(seconds=1)))
    else:
        different = replace(item, bindings=tuple(replace(row, user_id=98) if row.user_id == 2 else row for row in item.bindings))
    with pytest.raises(WattenProgressionError, match="conflicting_match"):
        evaluate_draft((item, different), viewer_user_id=1)


def test_every_duplicate_still_requires_full_membership_and_cpu_cannot_get_credits():
    item = input_for(observed_profile())
    forged = replace(item, bindings=tuple(replace(row, user_id=44) if row.user_id == 1 else row for row in item.bindings))
    with pytest.raises(WattenEvidenceError, match="membership"):
        evaluate_draft((item, forged), viewer_user_id=1)
    with pytest.raises(WattenEvidenceError, match="membership"):
        evaluate_draft((replace(item, bindings=tuple(replace(row, user_id=1) if row.position == 1 else
                                                   replace(row, user_id=99) if row.user_id == 1 else row
                                                   for row in item.bindings)),), viewer_user_id=1)


def test_legacy_unknown_does_not_imply_normal_profile_or_no_bids_even_for_a_winner():
    _state, payload = native_result()
    evidence = adapt_result_v1(payload, finished_at=FINISHED)
    proposal = evaluate_draft((input_for(evidence, own_player=winning_player(evidence)),), viewer_user_id=1)
    assert proposal.counters.wins == 1 and proposal.counters.two == 1
    assert proposal.counters.normal == proposal.counters.ladinisch == proposal.counters.blind == proposal.counters.critical == 0
    assert proposal.counters.bid_matches == proposal.counters.counter_matches == proposal.counters.quiet_wins == 0
    assert not {"watten_normal", "watten_quiet_win", "watten_bid", "watten_counter"} & awarded(proposal)


def test_complete_real_bid_commands_and_complete_quiet_match_can_unlock_tactical_goals():
    counter = input_for(counter_evidence())
    quiet_evidence = observed_profile(2, determination="normal", blind=False, critical=False, cpus=())
    quiet = reidentified(input_for(quiet_evidence, own_player=winning_player(quiet_evidence)), 2)
    proposal = evaluate_draft((counter, quiet), viewer_user_id=1)
    assert {"watten_bid", "watten_counter", "watten_quiet_win"} <= awarded(proposal)
    assert proposal.counters.bid_matches == proposal.counters.counter_matches == proposal.counters.quiet_wins == 1


def test_human_and_cpu_tables_short_or_legacy_matches_each_propose_ten_xp_without_duration_gate():
    pure = observed_profile(2, determination="normal", blind=False, critical=False, cpus=())
    cpu = observed_profile()
    human_credit = evaluate_draft((input_for(pure),), viewer_user_id=1).credits[0]
    cpu_credit = evaluate_draft((input_for(cpu),), viewer_user_id=1).credits[0]
    assert human_credit.xp == cpu_credit.xp == 10
    assert human_credit.cpu_count == 0 and cpu_credit.cpu_count == 1
    assert pure.finished_at - pure.started_at == timedelta(seconds=1)


def test_deleted_other_human_is_not_a_cpu_or_a_new_account_credit():
    _state, payload = native_result()
    item = input_for(adapt_result_v1(payload, finished_at=FINISHED))
    deleted = replace(item, bindings=tuple(replace(row, user_id=None) if row.user_id == 2 else row for row in item.bindings))
    proposal = evaluate_draft((deleted,), viewer_user_id=1)
    assert proposal.credits[0].cpu_count == 0 and proposal.counters.cpu_matches == 0
    with pytest.raises(WattenEvidenceError, match="membership"):
        evaluate_draft((deleted,), viewer_user_id=2)


def test_both_three_player_co_winners_receive_a_win_and_four_player_team_members_do_too():
    evidence = adapt_result_v1(co_winner_result(), finished_at=FINISHED)
    for player, won in (("A", False), ("B", True), ("C", True)):
        proposal = evaluate_draft((input_for(evidence, own_player=player),), viewer_user_id=1)
        assert proposal.credits[0].won is won and proposal.counters.wins == won
    team = observed_profile(4, determination="normal", blind=False, critical=False, cpus=())
    for player in team.winners[0]:
        proposal = evaluate_draft((input_for(team, own_player=player),), viewer_user_id=1)
        assert proposal.counters.team_wins == 1 and "watten_team_first" in awarded(proposal)


def test_distinct_swiss_days_accumulate_with_gaps_and_need_no_streak():
    item = input_for(observed_profile())
    same_day = reidentified(item, 1)
    different_day = reidentified(item, 2, day_offset=90)
    repeated_day = reidentified(item, 3, day_offset=90)
    proposal = evaluate_draft((same_day, different_day, repeated_day), viewer_user_id=1)
    assert proposal.counters.completed == 3 and proposal.counters.days == 2
    assert "watten_days_two" in awarded(proposal) and "watten_days_ten" not in awarded(proposal)
    grant = next(item for item in proposal.achievements if item.achievement_id == "watten_days_two")
    assert grant.source_game_id == different_day.evidence.game_id


def test_finite_bilingual_catalog_is_reachable_from_regular_legal_matches_in_all_modes():
    two = observed_profile(2, determination="normal", blind=False, critical=False, cpus=())
    three = observed_profile(3, determination="normal", blind=False, critical=False, cpus=())
    four = observed_profile()
    templates = (input_for(two, own_player=winning_player(two)), input_for(three), input_for(counter_evidence()),
                 input_for(four, own_player=winning_player(four)),
                 input_for(schneider_evidence(), own_player="A"), input_for(retourschneider_evidence(), own_player="B"),
                 input_for(eight_plus_three_evidence(), own_player="A"),
                 input_for(eight_plus_three_evidence(retour=True), own_player="B"),
                 input_for(tracked_match(2, [("B", 7), ("A", 11)]), own_player="A"),
                 input_for(tracked_match(2, [("A", 3), ("A", 4), ("A", 4)]), own_player="A"))
    order = (*templates[:6], *templates[8:], *(templates[6:8] * 10))
    order += (templates[3],) * (1000 - len(order))
    samples = tuple(reidentified(item, index, day_offset=index * 2) for index, item in enumerate(order))
    proposal = evaluate_draft(samples, viewer_user_id=1)
    assert awarded(proposal) == {item.achievement_id for item in DRAFT_ACHIEVEMENTS}
    assert len(awarded(proposal)) == len(DRAFT_ACHIEVEMENTS) == 34
    assert proposal.achievement_xp == MAX_DRAFT_ACHIEVEMENT_XP == 2810 <= MAX_ONETIME_XP_BUDGET == 3500
    assert proposal.total_xp == proposal.match_xp + proposal.achievement_xp == 12810
    assert all(item.policy_version == 1 and item.catalog_version == 3 for item in (*proposal.credits, *proposal.achievements))
    assert proposal.counters.completed == 1000 and proposal.counters.variety == 3
    assert proposal.title.current.level == 22 and proposal.title.next_title is None and proposal.title.xp_to_next == 0
    for definition in DRAFT_ACHIEVEMENTS:
        assert definition.name.de.strip() and definition.name.en.strip()
        assert definition.condition.de.strip() and definition.condition.en.strip()
        assert definition.target > 0 and definition.xp > 0


def test_schneider_achievement_requires_a_native_winner_and_never_an_accepted_retour():
    evidence = schneider_evidence()
    for player, expected in (("A", True), ("B", False)):
        proposal = evaluate_draft((input_for(evidence, own_player=player),), viewer_user_id=1)
        assert ("watten_schneider_win" in awarded(proposal)) is expected
    legacy = replace(evidence, source="result_v1", profile=UNKNOWN, started_at=UNKNOWN, bids=BidEvidence())
    assert "watten_schneider_win" not in awarded(evaluate_draft((input_for(legacy, own_player="A"),), viewer_user_id=1))
    failed_retour = retourschneider_evidence(fail=True)
    proposal = evaluate_draft((input_for(failed_retour, own_player="A"),), viewer_user_id=1)
    assert not {"watten_schneider_win", "watten_retourschneider_win"} & awarded(proposal)


def test_retourschneider_achievement_belongs_only_to_the_successful_challenging_team():
    evidence = retourschneider_evidence()
    for player in ("B", "D"):
        proposal = evaluate_draft((input_for(evidence, own_player=player),), viewer_user_id=1)
        grant = next(item for item in proposal.achievements if item.achievement_id == "watten_retourschneider_win")
        assert grant.xp == 120 and grant.source_game_id == evidence.game_id
        assert proposal.counters.retourschneider_wins == 1 and proposal.counters.schneider_wins == 0
    proposal = evaluate_draft((input_for(evidence, own_player="A"),), viewer_user_id=1)
    assert "watten_retourschneider_win" not in awarded(proposal)
    legacy = replace(evidence, source="result_v1", profile=UNKNOWN, started_at=UNKNOWN, bids=BidEvidence())
    assert "watten_retourschneider_win" not in awarded(evaluate_draft((input_for(legacy, own_player="B"),), viewer_user_id=1))


@pytest.mark.parametrize("retour,player", ((False, "A"), (True, "B")))
def test_eight_plus_three_goals_have_separate_counters_and_unlock_at_three_and_ten(retour, player):
    evidence = eight_plus_three_evidence(retour=retour)
    item = input_for(evidence, own_player=player)
    for count in (1, 2, 3, 9, 10):
        matches = tuple(reidentified(item, number) for number in range(count))
        proposal = evaluate_draft(matches, viewer_user_id=1)
        goals = awarded(proposal)
        assert proposal.counters.eight_plus_three_wins == (0 if retour else count)
        assert proposal.counters.retourschneider_eight_plus_three_wins == (count if retour else 0)
        assert ("watten_eight_plus_three" in goals) is (not retour and count >= 10)
        assert ("watten_retourschneider_eight_plus_three_three" in goals) is (retour and count >= 3)
        assert ("watten_retourschneider_eight_plus_three" in goals) is (retour and count >= 10)
        if count == 10:
            goal_id = "watten_retourschneider_eight_plus_three" if retour else "watten_eight_plus_three"
            grant = next(grant for grant in proposal.achievements if grant.achievement_id == goal_id)
            assert grant.source_game_id == matches[-1].evidence.game_id and grant.xp == (200 if retour else 80)
            assert evaluate_draft((*matches, matches[-1]), viewer_user_id=1) == proposal


@pytest.mark.parametrize("prefix,last_points,target", ((9, 3, 11), (8, 4, 11), (7, 4, 11), (8, 3, 10)))
def test_eight_plus_three_rejects_other_start_final_scores_and_targets(prefix, last_points, target):
    evidence = eight_plus_three_evidence(prefix=prefix, last_points=last_points, target=target)
    proposal = evaluate_draft((input_for(evidence, own_player="A"),), viewer_user_id=1)
    assert proposal.counters.eight_plus_three_wins == proposal.counters.retourschneider_eight_plus_three_wins == 0


@pytest.mark.parametrize("retour,winner,loser", ((False, "A", "B"), (True, "B", "A")))
def test_eight_plus_three_requires_completed_native_own_win_and_never_legacy(retour, winner, loser):
    evidence = eight_plus_three_evidence(retour=retour)
    for source, player in ((evidence, loser), (replace(evidence, source="result_v1", profile=UNKNOWN,
                                                    started_at=UNKNOWN, bids=BidEvidence()), winner)):
        proposal = evaluate_draft((input_for(source, own_player=player),), viewer_user_id=1)
        assert proposal.counters.eight_plus_three_wins == proposal.counters.retourschneider_eight_plus_three_wins == 0


def test_a_round_alone_cannot_supply_completed_match_evidence_for_eight_plus_three():
    state = scored_go(start_match(recipe(2), "unfinished-eight", dealt(2), first_dealer="A"), 0, 8)
    assert state.phase == "deal_complete"
    with pytest.raises(ValueError):
        result_for(state)


def test_350_match_intensive_week_cannot_finish_catalog_or_reach_top_three_titles_even_with_maximum_bonus():
    item = input_for(observed_profile())
    week = tuple(reidentified(item, index, day_offset=index // 50) for index in range(350))
    proposal = evaluate_draft(week, viewer_user_id=1)
    assert proposal.counters.completed == 350 and proposal.counters.days == 7
    assert "watten_matches_1000" not in awarded(proposal)
    assert len(awarded(proposal)) < len(DRAFT_ACHIEVEMENTS)
    assert proposal.title.current.level < 20
    assert title_for_xp(350 * 10 + MAX_ONETIME_XP_BUDGET).current.level < 20
    assert 350 * 10 + MAX_ONETIME_XP_BUDGET == 7000 < DRAFT_TITLES[19].xp


def test_title_gaps_strictly_grow_and_highest_title_needs_no_rare_achievement():
    assert len(DRAFT_TITLES) == 22 and DRAFT_TITLES[-1].xp == 11030
    gaps = [right.xp - left.xp for left, right in zip(DRAFT_TITLES, DRAFT_TITLES[1:])]
    assert all(right > left > 0 for left, right in zip(gaps, gaps[1:]))
    assert title_for_xp(1102 * 10).current.level == 21
    assert title_for_xp(1103 * 10).current.level == 22
    assert all(item.name.de.strip() and item.name.en.strip() for item in DRAFT_TITLES)
    for title in DRAFT_TITLES:
        assert title_for_xp(title.xp).current == title
        if title.xp:
            assert title_for_xp(title.xp - 1).current.level == title.level - 1


@pytest.mark.parametrize("viewer,matches", ((True, ()), (0, ()), ("1", ()), (1, []), (1, ({},))))
def test_invalid_identity_or_nonvalidated_input_has_no_proposal(viewer, matches):
    with pytest.raises(WattenProgressionError):
        evaluate_draft(matches, viewer_user_id=viewer)


@pytest.mark.parametrize("xp", (-1, True, 1.5, "10"))
def test_invalid_xp_does_not_select_a_title(xp):
    with pytest.raises(WattenProgressionError):
        title_for_xp(xp)
