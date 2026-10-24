"""Small, deterministic CPU progression; no accounts, cards, storage or training.

The coordinator supplies only completed-Watten counts of the humans at this
table. Their existing difficulty profiles determine the median parameters.
The policy receives no IDs or historical matches. More experience buys a larger
hypothetical sample and more precise decisions, without changing card information
or legal actions.
"""

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True, slots=True)
class CpuSkill:
    samples: int = 24
    confidence: float = 0.82
    near_best: float = 0.045
    partnership: float = 0.025
    bid_minimum: float = 0.66

    def __post_init__(self) -> None:
        if (type(self.samples) is not int or not 1 <= self.samples <= 64
                or any(type(value) not in {int, float} for value in (
                    self.confidence, self.near_best, self.partnership, self.bid_minimum))
                or not 0.5 <= self.confidence <= 1 or not 0 <= self.near_best <= 0.1
                or not 0 <= self.partnership <= 0.06 or not 0.6 <= self.bid_minimum <= 0.8):
            raise ValueError("watten_cpu_invalid_skill")


def skill_for_completed_games(completed: int) -> CpuSkill:
    """Fixed transparent tiers, derived from durable completed-game membership.

    This is bounded adaptation, not machine learning, Elo, or a difficulty
    setting a client may select. The thresholds are implementation choices.
    """
    if type(completed) is not int or completed < 0:
        raise ValueError("watten_cpu_invalid_experience")
    if completed < 10:
        return CpuSkill(16, 0.72, 0.08, 0.018, 0.70)
    if completed < 30:
        return CpuSkill()
    if completed < 75:
        return CpuSkill(40, 0.90, 0.025, 0.03, 0.65)
    return CpuSkill(64, 0.96, 0.012, 0.035, 0.64)


def skill_for_table(completed_games: Iterable[int]) -> CpuSkill:
    """Median of configured difficulty, not of uncapped experience counts.

    All profile parameters are monotonic across tiers. An odd table keeps its
    middle profile; an even table averages the two middle profiles. The sample
    budget remains an integer within CpuSkill's existing bounds.
    """
    profiles = sorted((skill_for_completed_games(count) for count in completed_games), key=lambda item: item.samples)
    if not profiles:
        return skill_for_completed_games(0)
    middle = len(profiles) // 2
    if len(profiles) % 2:
        return profiles[middle]
    lower, upper = profiles[middle - 1:middle + 1]
    return CpuSkill(
        samples=(lower.samples + upper.samples) // 2,
        confidence=(lower.confidence + upper.confidence) / 2,
        near_best=(lower.near_best + upper.near_best) / 2,
        partnership=(lower.partnership + upper.partnership) / 2,
        bid_minimum=(lower.bid_minimum + upper.bid_minimum) / 2,
    )
