from datetime import date, timedelta


def is_overnight(call_type: str, d: date, stepdown_dates: set[date], call_type_configs: dict | None = None) -> bool:
    if call_type_configs:
        cfg = call_type_configs.get(call_type)
        if cfg:
            return cfg.get("is_overnight", False)
    # Fallback for legacy behavior
    if call_type in {"MO1", "MO2"}:
        return True
    if call_type == "MO3" and d in stepdown_dates:
        return True
    return False


def get_post_call_type(call_type: str, call_type_configs: dict | None = None) -> str:
    if call_type_configs:
        cfg = call_type_configs.get(call_type)
        if cfg:
            return cfg.get("post_call_type", "none")
    # Legacy fallback
    if call_type in {"MO1", "MO2"}:
        return "8am"
    return "none"


def check_post_call(
    person_id: int,
    d: date,
    assignments: dict[date, dict[int, str]],
    stepdown_dates: set[date],
    call_type_configs: dict | None = None,
) -> bool:
    """Return True if the person is free (not post-call) on date d."""
    prev = d - timedelta(days=1)
    if prev in assignments and person_id in assignments[prev]:
        prev_type = assignments[prev][person_id]
        pct = get_post_call_type(prev_type, call_type_configs)
        if pct in ("8am", "12pm", "5pm"):
            return False
        if pct == "call_only":
            return False
    return True


def check_call_gap(
    person_id: int,
    d: date,
    call_type: str,
    assignments: dict[date, dict[int, str]],
    stepdown_dates: set[date],
    call_type_configs: dict | None = None,
    min_gap: int | None = None,
) -> bool:
    """Return True if there are at least min_gap clear days since last overnight call."""
    if not is_overnight(call_type, d, stepdown_dates, call_type_configs):
        return True
    if min_gap is None:
        if call_type_configs and call_type in call_type_configs:
            min_gap = call_type_configs[call_type].get("min_gap_days", 2)
        else:
            min_gap = 2
    for offset in range(1, min_gap + 2):
        prev = d - timedelta(days=offset)
        if prev in assignments and person_id in assignments[prev]:
            prev_type = assignments[prev][person_id]
            if is_overnight(prev_type, prev, stepdown_dates, call_type_configs):
                gap = (d - prev).days - 1
                if gap < min_gap:
                    return False
    return True


def check_no_consecutive_different_types(
    person_id: int,
    d: date,
    call_type: str,
    assignments: dict[date, dict[int, str]],
    stepdown_dates: set[date],
    call_type_configs: dict | None = None,
) -> bool:
    """No switching between overnight call types within a short window."""
    if not is_overnight(call_type, d, stepdown_dates, call_type_configs):
        return True
    for offset in range(1, 6):
        prev = d - timedelta(days=offset)
        if prev in assignments and person_id in assignments[prev]:
            prev_type = assignments[prev][person_id]
            if is_overnight(prev_type, prev, stepdown_dates, call_type_configs):
                if prev_type != call_type:
                    return False
                return True
    return True


def check_not_already_assigned_today(
    person_id: int,
    d: date,
    daily_assignments: dict[int, str],
) -> bool:
    return person_id not in daily_assignments


def validate_full_roster(
    assignments: dict[date, dict[int, str]],
    stepdown_dates: set[date],
    staff_names: dict[int, str],
    call_type_configs: dict | None = None,
) -> list[str]:
    """Run all validators over a completed roster. Return list of violation strings."""
    violations = []
    sorted_dates = sorted(assignments.keys())

    for d in sorted_dates:
        for pid, ctype in assignments[d].items():
            name = staff_names.get(pid, f"ID:{pid}")

            if not check_post_call(pid, d, assignments, stepdown_dates, call_type_configs):
                violations.append(
                    f"{d}: {name} assigned {ctype} but is post-call"
                )

            if not check_call_gap(pid, d, ctype, assignments, stepdown_dates, call_type_configs):
                violations.append(
                    f"{d}: {name} assigned {ctype} with insufficient gap"
                )

            if not check_no_consecutive_different_types(
                pid, d, ctype, assignments, stepdown_dates, call_type_configs
            ):
                violations.append(
                    f"{d}: {name} assigned {ctype} but previous call was different type"
                )

        pids_today = list(assignments[d].values())
        if len(pids_today) != len(set(assignments[d].keys())):
            violations.append(f"{d}: duplicate person in call assignments")

    return violations
