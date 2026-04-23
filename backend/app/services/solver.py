"""
Greedy priority-based call roster solver.

For each day, fills call slots in order: MO1 → MO2 → MO3 → MO4 → MO5.
For each slot, scores all eligible MOs and picks the best candidate.

Hard constraints (must pass):
  - Not on leave
  - Not blocked (call preference)
  - Post-call: no assignment day after overnight call
  - Minimum 2-day gap between overnight calls
  - No switching overnight call types within 5-day window
  - Not already assigned to another call slot today

Soft scoring (higher = more likely picked):
  - Fewer total calls this month
  - Fewer of this specific call type
  - Fewer weekend/PH calls (if applicable)
  - Team match bonus for MO1 (MO's team matches on-call consultant's team)
  - Call preference request bonus
"""

from datetime import date, timedelta
from dataclasses import dataclass, field
from collections import defaultdict

from ..models import CallType, Grade
from .validators import (
    is_overnight,
    check_post_call,
    check_call_gap,
    check_no_consecutive_different_types,
    check_not_already_assigned_today,
    validate_full_roster,
)


@dataclass
class PersonInfo:
    id: int
    name: str
    grade: Grade
    team_id: int | None = None
    supervisor_id: int | None = None


@dataclass
class DayConfig:
    d: date
    is_weekend: bool
    is_ph: bool
    is_stepdown: bool
    has_evening_ot: bool
    consultant_oncall_id: int | None = None
    consultant_oncall_team_id: int | None = None
    ac_oncall_id: int | None = None


@dataclass
class SolverInput:
    year: int
    month: int
    days: list[DayConfig]
    mo_pool: list[PersonInfo]
    leave_dates: dict[int, set[date]]  # person_id → dates
    block_dates: dict[int, set[date]]  # person_id → blocked dates
    request_dates: dict[int, set[date]]  # person_id → requested dates
    # Carryover from previous month: recent overnight calls
    prior_assignments: dict[date, dict[int, CallType]] = field(default_factory=dict)


@dataclass
class FairnessTracker:
    total_24h: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    total_all: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    type_calls: dict[int, dict[str, int]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(int))
    )
    weekend_calls: dict[int, int] = field(default_factory=lambda: defaultdict(int))

    def record(self, pid: int, call_type: CallType, is_weekend_or_ph: bool, is_24h: bool):
        self.total_all[pid] += 1
        self.type_calls[pid][call_type.value] += 1
        if is_24h:
            self.total_24h[pid] += 1
        if is_weekend_or_ph:
            self.weekend_calls[pid] += 1

    def score(self, pid: int, call_type: CallType, is_weekend_or_ph: bool) -> float:
        s = 0.0
        total_24h = self.total_24h[pid]
        type_count = self.type_calls[pid][call_type.value]
        weekend_count = self.weekend_calls[pid]

        max_24h = max(self.total_24h.values()) if self.total_24h else 1
        max_type = max(
            (self.type_calls[p].get(call_type.value, 0) for p in self.total_all),
            default=1,
        ) or 1
        max_weekend = max(self.weekend_calls.values()) if self.weekend_calls else 1

        s += 10.0 * (1.0 - total_24h / max(max_24h, 1))
        s += 3.0 * (1.0 - type_count / max(max_type, 1))
        if is_weekend_or_ph:
            s += 8.0 * (1.0 - weekend_count / max(max_weekend, 1))

        return s


def _required_slots(day: DayConfig) -> list[CallType]:
    slots = [CallType.MO1, CallType.MO2]
    if day.is_weekend or day.is_ph:
        if day.is_stepdown:
            slots.append(CallType.MO3)
    else:
        slots.append(CallType.MO3)
    if day.has_evening_ot and not day.is_weekend and not day.is_ph:
        slots.extend([CallType.MO4, CallType.MO5])
    return slots


def _is_eligible(
    person: PersonInfo,
    day: DayConfig,
    call_type: CallType,
    assignments: dict[date, dict[int, CallType]],
    daily_assignments: dict[int, CallType],
    leave_dates: dict[int, set[date]],
    block_dates: dict[int, set[date]],
    stepdown_dates: set[date],
) -> bool:
    pid = person.id
    d = day.d

    if d in leave_dates.get(pid, set()):
        return False

    if d in block_dates.get(pid, set()):
        return False

    # Weekday MO3 (referral duty) restricted to Senior Medical Officers
    if call_type == CallType.MO3 and not day.is_weekend and not day.is_ph and not day.is_stepdown:
        if person.grade != Grade.SENIOR_MEDICAL_OFFICER:
            return False

    if not check_not_already_assigned_today(pid, d, daily_assignments):
        return False

    if not check_post_call(pid, d, assignments, stepdown_dates):
        return False

    if is_overnight(call_type, d, stepdown_dates):
        if not check_call_gap(pid, d, call_type, assignments, stepdown_dates):
            return False
        if not check_no_consecutive_different_types(
            pid, d, call_type, assignments, stepdown_dates
        ):
            return False

    return True


def _score_candidate(
    person: PersonInfo,
    day: DayConfig,
    call_type: CallType,
    fairness: FairnessTracker,
    request_dates: dict[int, set[date]],
    assignments: dict[date, dict[int, CallType]],
    stepdown_dates: set[date],
) -> float:
    score = 0.0
    is_wknd_ph = day.is_weekend or day.is_ph

    score += fairness.score(person.id, call_type, is_wknd_ph)

    if call_type == CallType.MO1 and day.consultant_oncall_id is not None:
        if person.supervisor_id == day.consultant_oncall_id:
            score += 5.0
        elif day.consultant_oncall_team_id is not None and person.team_id == day.consultant_oncall_team_id:
            score += 3.0

    if day.d in request_dates.get(person.id, set()):
        score += 4.0

    last_call_date = None
    for offset in range(1, 10):
        prev = day.d - timedelta(days=offset)
        if prev in assignments and person.id in assignments[prev]:
            last_call_date = prev
            break
    if last_call_date:
        days_since = (day.d - last_call_date).days
        score += min(days_since * 0.3, 2.0)

    return score


def solve(inp: SolverInput) -> tuple[dict[date, dict[int, CallType]], list[str]]:
    assignments: dict[date, dict[int, CallType]] = {}

    for d, mapping in inp.prior_assignments.items():
        assignments[d] = dict(mapping)

    stepdown_dates: set[date] = set()
    for day in inp.days:
        if day.is_stepdown:
            stepdown_dates.add(day.d)

    fairness = FairnessTracker()
    for pid in [p.id for p in inp.mo_pool]:
        fairness.total_all[pid] = 0
        fairness.total_24h[pid] = 0

    for day in inp.days:
        slots = _required_slots(day)
        daily: dict[int, CallType] = {}

        for call_type in slots:
            eligible = [
                p
                for p in inp.mo_pool
                if _is_eligible(
                    p,
                    day,
                    call_type,
                    assignments,
                    daily,
                    inp.leave_dates,
                    inp.block_dates,
                    stepdown_dates,
                )
            ]

            if not eligible:
                daily[-1] = call_type
                continue

            scored = sorted(
                eligible,
                key=lambda p: _score_candidate(
                    p,
                    day,
                    call_type,
                    fairness,
                    inp.request_dates,
                    assignments,
                    stepdown_dates,
                ),
                reverse=True,
            )

            chosen = scored[0]
            daily[chosen.id] = call_type
            call_is_24h = is_overnight(call_type, day.d, stepdown_dates)
            fairness.record(chosen.id, call_type, day.is_weekend or day.is_ph, call_is_24h)

        assignments[day.d] = daily

    month_assignments = {
        d: mapping
        for d, mapping in assignments.items()
        if d.year == inp.year and d.month == inp.month
    }

    staff_names = {p.id: p.name for p in inp.mo_pool}
    violations = validate_full_roster(month_assignments, stepdown_dates, staff_names)

    return month_assignments, violations


def compute_fairness_stats(
    assignments: dict[date, dict[int, CallType]],
    mo_pool: list[PersonInfo],
    stepdown_dates: set[date],
) -> dict[str, dict]:
    stats: dict[str, dict] = {}
    for p in mo_pool:
        stats[p.name] = {
            "total_24h": 0,
            "total_all": 0,
            "MO1": 0,
            "MO2": 0,
            "MO3": 0,
            "MO4": 0,
            "MO5": 0,
            "weekend_ph": 0,
        }

    pid_to_name = {p.id: p.name for p in mo_pool}
    for d, mapping in sorted(assignments.items()):
        is_wknd = d.weekday() >= 5
        for pid, ctype in mapping.items():
            name = pid_to_name.get(pid)
            if name is None:
                continue
            stats[name]["total_all"] += 1
            stats[name][ctype.value] += 1
            if is_overnight(ctype, d, stepdown_dates):
                stats[name]["total_24h"] += 1
            if is_wknd:
                stats[name]["weekend_ph"] += 1

    return stats
