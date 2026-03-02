import math


def recency_decay(age_minutes: float, half_life_minutes: float = 120) -> float:
    """Exponential decay multiplier.

    Default 2-hour half-life:
        0 min  -> 1.00
        30 min -> 0.78
        1 hr   -> 0.61
        2 hrs  -> 0.37
        4 hrs  -> 0.14
        6 hrs  -> 0.05
    """
    if age_minutes < 0:
        return 1.0
    return math.exp(-age_minutes / half_life_minutes)
