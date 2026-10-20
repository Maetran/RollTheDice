"""Draft calibration on legal evidence; no production grants or timing claims."""

from dataclasses import FrozenInstanceError, replace
from datetime import timedelta

import pytest

from app.watten_bidding import retourschneider_candidate
from app.watten_cards import DealtCards, make_deck
from app.watten_engine import SeatBinding, next_deal, start_match
from app.watten_evidence import UNKNOWN, BidEvidence, PlayerBids, PublicProfile, WattenEvidenceError, adapt_result_v1
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


def test_empty_is_explicit_draft_and_first_regular_match_proposes_fast_early_progress():
    empty = evaluate_draft((), viewer_user_id=1)
    assert empty.status == "draft" and empty.total_xp == 0 and not empty.credits and not empty.achievements
    assert empty.policy_version == DRAFT_POLICY_VERSION == 1
    assert empty.catalog_version == DRAFT_CATALOG_VERSION == 2
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
                 input_for(eight_plus_three_evidence(retour=True), own_player="B"))
    order = (*templates[:6], *(templates[6:] * 10))
    order += (templates[3],) * (1000 - len(order))
    samples = tuple(reidentified(item, index, day_offset=index * 2) for index, item in enumerate(order))
    proposal = evaluate_draft(samples, viewer_user_id=1)
    assert awarded(proposal) == {item.achievement_id for item in DRAFT_ACHIEVEMENTS}
    assert len(awarded(proposal)) == len(DRAFT_ACHIEVEMENTS) == 32
    assert proposal.achievement_xp == MAX_DRAFT_ACHIEVEMENT_XP == 2670 <= MAX_ONETIME_XP_BUDGET == 3500
    assert proposal.total_xp == proposal.match_xp + proposal.achievement_xp == 12670
    assert all(item.policy_version == 1 and item.catalog_version == 2 for item in (*proposal.credits, *proposal.achievements))
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
