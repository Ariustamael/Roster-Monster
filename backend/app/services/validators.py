from datetime import date, timedelta
from ..models import CallType, OVERNIGHT_CALL_TYPES


def is_overnight(call_type: CallType, d: date, stepdown_dates: set[date]) -> bool:
    if call_type in {CallType.MO1, CallType.MO2}:
        return True
    if call_type == CallType.MO3 and d in stepdown_dates:
        return True
    return False


def check_post_call(
    person_id: int,
    d: date,
    assignments: dict[date, dict[int, CallType]],
    stepdown_dates: set[date],
) -> bool:
    """Return True if the person is free (not post-call) on date d."""
    prev = d - timedelta(days=1)
    if prev in assignments and person_id in assignments[prev]:
        prev_type = assignments[prev][person_id]
        if is_overnight(prev_type, prev, stepdown_dates):
            return False
    return True


def check_call_gap(
    person_id: int,
    d: date,
    call_type: CallType,
    assignments: dict[date, dict[int, CallType]],
    stepdown_dates: set[date],
    min_gap: int = 2,
) -> bool:
    """Return True if there are at least min_gap clear days since last overnight call."""
    if not is_overnight(call_type, d, stepdown_dates):
        return True
    for offset in range(1, min_gap + 2):
        prev = d - timedelta(days=offset)
        if prev in assignments and person_id in assignments[prev]:
            prev_type = assignments[prev][person_id]
            if is_overnight(prev_type, prev, stepdown_dates):
                gap = (d - prev).days - 1
                if gap < min_gap:
                    return False
    return True


def check_no_consecutive_different_types(
    person_id: int,
    d: date,
    call_type: CallType,
    assignments: dict[date, dict[int, CallType]],
    stepdown_dates: set[date],
) -> bool:
    """No switching between overnight call types within a short window."""
    if not is_overnight(call_type, d, stepdown_dates):
        return True
    for offset in range(1, 6):
        prev = d - timedelta(days=offset)
        if prev in assignments and person_id in assignments[prev]:
            prev_type = assignments[prev][person_id]
            if is_overnight(prev_type, prev, stepdown_dates):
                if prev_type != call_type:
                    return False
                return True
    return True


def check_not_already_assigned_today(
    person_id: int,
    d: date,
    daily_assignments: dict[int, CallType],
) -> bool:
    return person_id not in daily_assignments


def validate_full_roster(
    assignments: dict[date, dict[int, CallType]],
    stepdown_dates: set[date],
    staff_names: dict[int, str],
) -> list[str]:
    """Run all validators over a completed roster. Return list of violation strings."""
    violations = []
    sorted_dates = sorted(assignments.keys())

    for d in sorted_dates:
        for pid, ctype in assignments[d].items():
            name = staff_names.get(pid, f"ID:{pid}")

            if not check_post_call(pid, d, assignments, stepdown_dates):
                violations.append(
                    f"{d}: {name} assigned {ctype.value} but is post-call"
                )

            if not check_call_gap(pid, d, ctype, assignments, stepdown_dates):
                violations.append(
                    f"{d}: {name} assigned {ctype.value} with insufficient gap"
                )

            if not check_no_consecutive_different_types(
                pid, d, ctype, assignments, stepdown_dates
            ):
                violations.append(
                    f"{d}: {name} assigned {ctype.value} but previous call was different type"
                )

        pids_today = list(assignments[d].values())
        if len(pids_today) != len(set(assignments[d].keys())):
            violations.append(f"{d}: duplicate person in call assignments")

    return violations
