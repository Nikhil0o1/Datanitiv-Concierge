def req_of(billable: float, shrink_pct: float) -> float:
    """Platform formula: requirement = billable / (1 - shrink/100)."""
    if shrink_pct >= 100:
        raise ValueError("Shrinkage must be below 100%")
    return billable / (1 - shrink_pct / 100)


def compute_ou(projected: float, shrink_pct: float, billable: float = 50.0) -> float:
    """Over/under = projected FTE minus requirement at given shrinkage."""
    return projected - req_of(billable, shrink_pct)
