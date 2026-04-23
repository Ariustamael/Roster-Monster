"""
Greedy priority-based call roster solver.

For each day, fills call slots based on call_type_config.
For each slot, scores all eligible MOs and picks the best candidate.

Hard constraints (must pass):
  - Not on leave
  - Not blocked (call preference)
  - Post-call: no assignment day after overnight call
  - Minimum gap between overnight calls (configurable per call type)
  - No switching overnight call types within 5-day window
  - Not already assigned to another call slot today
  - Rank must be in the call type's eligible ranks

Soft scoring (higher = more likely picked):
  - Fewer total calls this month
  - Fewer of this specific call type
  - Fewer weekend/PH calls (if applicable)
  - Team match bonus for first call slot
  - Call preference request bonus
  - Difficulty-weighted fairness
"""

from datetime import date, timedelta
from dataclasses import dataclass, field
from collections import defaultdict

from .validators import (
    is_overnight,
    check_post_call,
    check_call_gap,
    check_no_consecutive_different_types,
    check_not_already_assigned_today,
    validate_full_roster,
)


@dataclass
class CallTypeInfo:
    name: str
    display_order: int
    is_overnight: bool
    post_call_type: str
    max_consecutive_days: int
    min_gap_days: int
    difficulty_points: int
    counts_towards_fairness: bool
    applicable_days: str
    eligible_rank_names: set[str]
    required_conditions: str = ""
    is_night_float: bool = False
    night_float_run: str = ""


@dataclass
class PersonInfo:
    id: int
    name: str
    rank: str
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
    leave_dates: dict[int, set[date]]
    block_dates: dict[int, set[date]]
    request_dates: dict[int, set[date]]
    prior_assignments: dict[date, dict[int, str]] = field(default_factory=dict)
    call_type_configs: list[CallTypeInfo] = field(default_factory=list)


@dataclass
class FairnessTracker:
    total_24h: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    total_all: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    type_calls: dict[int, dict[str, int]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(int))
    )
    weekend_calls: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    difficulty_points: dict[int, int] = field(default_factory=lambda: defaultdict(int))

    def record(self, pid: int, call_type: str, is_weekend_or_ph: bool, is_24h: bool, diff_points: int = 1):
        self.total_all[pid] += 1
        self.type_calls[pid][call_type] += 1
        self.difficulty_points[pid] += diff_points
        if is_24h:
            self.total_24h[pid] += 1
        if is_weekend_or_ph:
            self.weekend_calls[pid] += 1

    def score(self, pid: int, call_type: str, is_weekend_or_ph: bool, diff_points: int = 1) -> float:
        s = 0.0
        total_24h = self.total_24h[pid]
        type_count = self.type_calls[pid][call_type]
        weekend_count = self.weekend_calls[pid]
        total_diff = self.difficulty_points[pid]

        max_24h = max(self.total_24h.values()) if self.total_24h else 1
        max_type = max(
            (self.type_calls[p].get(call_type, 0) for p in self.total_all),
            default=1,
        ) or 1
        max_weekend = max(self.weekend_calls.values()) if self.weekend_calls else 1
        max_diff = max(self.difficulty_points.values()) if self.difficulty_points else 1

        s += 10.0 * (1.0 - total_24h / max(max_24h, 1))
        s += 3.0 * (1.0 - type_count / max(max_type, 1))
        s += 2.0 * (1.0 - total_diff / max(max_diff, 1))
        if is_weekend_or_ph:
            s += 8.0 * (1.0 - weekend_count / max(max_weekend, 1))

        return s


DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _day_matches_applicable(day: DayConfig, applicable_days: str) -> bool:
    """Day-of-week OR logic. Tokens: Mon-Sun + PH (still applies on PH days)."""
    val = applicable_days.strip().lower()
    # Legacy shorthands kept for backward compat
    if val == "all":
        return True
    if val == "weekday":
        return day.d.weekday() < 5 and not day.is_ph and not day.is_stepdown
    if val == "weekend_ph":
        return day.is_weekend or day.is_ph
    day_label = DAY_LABELS[day.d.weekday()]
    tokens = [t.strip() for t in applicable_days.split(",")]
    if day_label in tokens:
        return True
    if "PH" in tokens and day.is_ph:
        return True
    return False


def _required_conditions_met(day: DayConfig, required_conditions: str) -> bool:
    """ALL condition tokens must be satisfied (AND logic).
    Tokens: Stepdown, Evening OT, PH, Not PH."""
    if not required_conditions or not required_conditions.strip():
        return True
    for token in [t.strip() for t in required_conditions.split(",")]:
        if not token:
            continue
        if token == "Stepdown" and not day.is_stepdown:
            return False
        elif token == "Not Stepdown" and day.is_stepdown:
            return False
        elif token == "PH" and not day.is_ph:
            return False
        elif token == "Not PH" and day.is_ph:
            return False
        elif token == "Evening OT" and not day.has_evening_ot:
            return False
    return True


def _required_slots(day: DayConfig, call_type_configs: list[CallTypeInfo]) -> list[CallTypeInfo]:
    slots = []
    for ct in sorted(call_type_configs, key=lambda c: c.display_order):
        if _day_matches_applicable(day, ct.applicable_days) and _required_conditions_met(day, ct.required_conditions):
            slots.append(ct)
    return slots


def _build_ct_config_dict(call_type_configs: list[CallTypeInfo]) -> dict:
    return {
        ct.name: {
            "is_overnight": ct.is_overnight,
            "post_call_type": ct.post_call_type,
            "min_gap_days": ct.min_gap_days,
        }
        for ct in call_type_configs
    }


def _is_eligible(
    person: PersonInfo,
    day: DayConfig,
    ct: CallTypeInfo,
    assignments: dict[date, dict[int, str]],
    daily_assignments: dict[int, str],
    leave_dates: dict[int, set[date]],
    block_dates: dict[int, set[date]],
    stepdown_dates: set[date],
    ct_config_dict: dict,
) -> bool:
    pid = person.id
    d = day.d

    if d in leave_dates.get(pid, set()):
        return False

    if d in block_dates.get(pid, set()):
        return False

    if person.rank not in ct.eligible_rank_names:
        return False

    if not check_not_already_assigned_today(pid, d, daily_assignments):
        return False

    if not check_post_call(pid, d, assignments, stepdown_dates, ct_config_dict):
        return False

    if is_overnight(ct.name, d, stepdown_dates, ct_config_dict):
        if not check_call_gap(pid, d, ct.name, assignments, stepdown_dates, ct_config_dict, ct.min_gap_days):
            return False
        if not check_no_consecutive_different_types(
            pid, d, ct.name, assignments, stepdown_dates, ct_config_dict
        ):
            return False

    return True


def _score_candidate(
    person: PersonInfo,
    day: DayConfig,
    ct: CallTypeInfo,
    fairness: FairnessTracker,
    request_dates: dict[int, set[date]],
    assignments: dict[date, dict[int, str]],
    stepdown_dates: set[date],
) -> float:
    score = 0.0
    is_wknd_ph = day.is_weekend or day.is_ph

    score += fairness.score(person.id, ct.name, is_wknd_ph, ct.difficulty_points)

    if ct.display_order == 0 and day.consultant_oncall_id is not None:
        if person.supervisor_id == day.consultant_oncall_id:
            score += 5.0
        elif day.consultant_oncall_team_id is not None and person.team_id == day.consultant_oncall_team_id:
            score += 3.0

    if day.d in request_dates.get(person.id, set()):
        score += 4.0

    # Night float run continuity bonus: same person should cover consecutive run days
    if ct.night_float_run:
        run_days = {d.strip() for d in ct.night_float_run.split(",")}
        today_label = DAY_LABELS[day.d.weekday()]
        if today_label in run_days:
            prev_day = day.d - timedelta(days=1)
            prev_label = DAY_LABELS[prev_day.weekday()]
            if prev_label in run_days and prev_day in assignments:
                if person.id in assignments[prev_day] and assignments[prev_day].get(person.id) == ct.name:
                    score += 25.0

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


def solve(inp: SolverInput) -> tuple[dict[date, dict[int, str]], list[str]]:
    assignments: dict[date, dict[int, str]] = {}

    for d, mapping in inp.prior_assignments.items():
        assignments[d] = dict(mapping)

    stepdown_dates: set[date] = set()
    for day in inp.days:
        if day.is_stepdown:
            stepdown_dates.add(day.d)

    ct_config_dict = _build_ct_config_dict(inp.call_type_configs)

    fairness = FairnessTracker()
    for pid in [p.id for p in inp.mo_pool]:
        fairness.total_all[pid] = 0
        fairness.total_24h[pid] = 0

    for day in inp.days:
        slots = _required_slots(day, inp.call_type_configs)
        daily: dict[int, str] = {}

        for ct in slots:
            eligible = [
                p
                for p in inp.mo_pool
                if _is_eligible(
                    p,
                    day,
                    ct,
                    assignments,
                    daily,
                    inp.leave_dates,
                    inp.block_dates,
                    stepdown_dates,
                    ct_config_dict,
                )
            ]

            if not eligible:
                daily[-1] = ct.name
                continue

            scored = sorted(
                eligible,
                key=lambda p: _score_candidate(
                    p,
                    day,
                    ct,
                    fairness,
                    inp.request_dates,
                    assignments,
                    stepdown_dates,
                ),
                reverse=True,
            )

            chosen = scored[0]
            daily[chosen.id] = ct.name
            call_is_24h = is_overnight(ct.name, day.d, stepdown_dates, ct_config_dict)
            fairness.record(chosen.id, ct.name, day.is_weekend or day.is_ph, call_is_24h, ct.difficulty_points)

        assignments[day.d] = daily

    month_assignments = {
        d: mapping
        for d, mapping in assignments.items()
        if d.year == inp.year and d.month == inp.month
    }

    staff_names = {p.id: p.name for p in inp.mo_pool}
    violations = validate_full_roster(month_assignments, stepdown_dates, staff_names, ct_config_dict)

    return month_assignments, violations


def compute_fairness_stats(
    assignments: dict[date, dict[int, str]],
    mo_pool: list[PersonInfo],
    stepdown_dates: set[date],
    call_type_configs: list[CallTypeInfo] | None = None,
) -> dict[str, dict]:
    ct_config_dict = _build_ct_config_dict(call_type_configs) if call_type_configs else None
    diff_by_type = {ct.name: ct.difficulty_points for ct in call_type_configs} if call_type_configs else {}

    ct_names = sorted(ct.name for ct in call_type_configs) if call_type_configs else ["MO1", "MO2", "MO3", "MO4", "MO5"]

    stats: dict[str, dict] = {}
    for p in mo_pool:
        per_type = {name: 0 for name in ct_names}
        stats[p.name] = {
            "total_24h": 0,
            "total_all": 0,
            "per_type": per_type,
            "weekend_ph": 0,
            "difficulty_points": 0,
        }

    pid_to_name = {p.id: p.name for p in mo_pool}
    for d, mapping in sorted(assignments.items()):
        is_wknd = d.weekday() >= 5
        for pid, ctype in mapping.items():
            name = pid_to_name.get(pid)
            if name is None:
                continue
            stats[name]["total_all"] += 1
            if ctype in stats[name]["per_type"]:
                stats[name]["per_type"][ctype] += 1
            if is_overnight(ctype, d, stepdown_dates, ct_config_dict):
                stats[name]["total_24h"] += 1
            if is_wknd:
                stats[name]["weekend_ph"] += 1
            stats[name]["difficulty_points"] += diff_by_type.get(ctype, 1)

    return stats
