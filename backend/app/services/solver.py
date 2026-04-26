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

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta

from .validators import (
    is_overnight,
    is_24h_call,
    check_post_call,
    check_call_gap,
    check_no_consecutive_different_types,
    check_not_already_assigned_today,
    check_max_consecutive,
    validate_full_roster,
)

logger = logging.getLogger(__name__)


@dataclass
class CallTypeInfo:
    id: int
    name: str
    display_order: int
    is_overnight: bool
    post_call_type: str
    max_consecutive_days: int
    min_consecutive_days: int
    min_gap_days: int
    switch_window_days: int
    difficulty_points: int
    counts_towards_fairness: bool
    applicable_days: str
    eligible_rank_names: set[str]
    required_conditions: str = ""
    is_night_float: bool = False
    night_float_run: str = ""
    uses_consultant_affinity: bool = False
    is_duty_only: bool = False
    # Names of other call types that must NOT be assigned on the same day.
    mutually_exclusive_names: set[str] = field(default_factory=set)


@dataclass
class PersonInfo:
    id: int
    name: str
    rank: str
    team_id: int | None = None
    supervisor_id: int | None = None
    # IDs of call types this person is eligible for beyond their rank default.
    extra_call_type_ids: set[int] = field(default_factory=set)


@dataclass
class DayConfig:
    d: date
    is_weekend: bool
    is_ph: bool
    is_stepdown: bool
    has_ext_ot: bool
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
    # Manual overrides: {date: {call_type: staff_id}} — seeded before solving
    # so the solver treats them as already-filled and respects daily/continuity rules.
    manual_overrides: dict[date, dict[str, int]] = field(default_factory=dict)


@dataclass
class FairnessTracker:
    total_24h: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    total_all: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    type_calls: dict[int, dict[str, int]] = field(
        default_factory=lambda: defaultdict(lambda: defaultdict(int))
    )
    weekend_calls: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    difficulty_points: dict[int, int] = field(default_factory=lambda: defaultdict(int))

    def record(
        self,
        pid: int,
        call_type: str,
        is_weekend_or_ph: bool,
        is_24h: bool,
        diff_points: int = 1,
    ):
        self.total_all[pid] += 1
        self.type_calls[pid][call_type] += 1
        self.difficulty_points[pid] += diff_points
        if is_24h:
            self.total_24h[pid] += 1
        if is_weekend_or_ph:
            self.weekend_calls[pid] += 1

    def score(
        self, pid: int, call_type: str, is_weekend_or_ph: bool, diff_points: int = 1
    ) -> float:
        s = 0.0
        total_24h = self.total_24h[pid]
        type_count = self.type_calls[pid][call_type]
        weekend_count = self.weekend_calls[pid]
        total_diff = self.difficulty_points[pid]

        max_24h = max(self.total_24h.values()) if self.total_24h else 1
        max_type = (
            max(
                (self.type_calls[p].get(call_type, 0) for p in self.total_all),
                default=1,
            )
            or 1
        )
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
    Tokens: Stepdown, Extended OT, PH, Not PH."""
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
        elif token == "Extended OT" and not day.has_ext_ot:
            return False
    return True


def _required_slots(
    day: DayConfig, call_type_configs: list[CallTypeInfo]
) -> list[CallTypeInfo]:
    slots = []
    for ct in sorted(call_type_configs, key=lambda c: c.display_order):
        if ct.is_duty_only:
            continue  # duty-only types are filled by the duty solver, not here
        if _day_matches_applicable(
            day, ct.applicable_days
        ) and _required_conditions_met(day, ct.required_conditions):
            slots.append(ct)
    return slots


def _build_ct_config_dict(call_type_configs: list[CallTypeInfo]) -> dict:
    return {
        ct.name: {
            "is_overnight": ct.is_overnight,
            "post_call_type": ct.post_call_type,
            "min_gap_days": ct.min_gap_days,
            "switch_window_days": ct.switch_window_days,
            "max_consecutive_days": ct.max_consecutive_days,
            "is_night_float": ct.is_night_float,
            "night_float_run": ct.night_float_run,
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

    # Rank check: pass if rank is in the default eligible set OR the person
    # has been granted explicit eligibility via extra_call_type_ids.
    if person.rank not in ct.eligible_rank_names and ct.id not in person.extra_call_type_ids:
        return False

    if not check_not_already_assigned_today(pid, d, daily_assignments):
        return False

    if not check_post_call(pid, d, assignments, stepdown_dates, ct_config_dict):
        return False

    # Night-float runs are expected to span multiple consecutive days; max_consecutive
    # gates *other* call types. Skip the check when today is within this call type's
    # night_float_run.
    in_nf_run = False
    if ct.is_night_float and ct.night_float_run:
        run_days = {t.strip() for t in ct.night_float_run.split(",") if t.strip()}
        in_nf_run = DAY_LABELS[d.weekday()] in run_days
    if not in_nf_run:
        if not check_max_consecutive(
            pid, d, ct.name, assignments, ct.max_consecutive_days
        ):
            return False

    # Same-type gap (applies to all call types; skip within night-float run)
    if not in_nf_run and not check_call_gap(
        pid,
        d,
        ct.name,
        assignments,
        stepdown_dates,
        ct_config_dict,
        ct.min_gap_days,
    ):
        return False

    # Cross-type switching (only applies when today's call is overnight)
    if is_overnight(ct.name, d, stepdown_dates, ct_config_dict):
        if not check_no_consecutive_different_types(
            pid, d, ct.name, assignments, stepdown_dates, ct_config_dict
        ):
            return False

    # Min consecutive days: on run-start days (no prior-day continuation for this
    # person + call type), require availability for the remainder of the run.
    # When the run is shorter than min_consec (e.g. starting Thu of a Tue-Fri
    # run = 2 days left), we cap at the remaining run length instead of failing,
    # so coverage still happens when a broken run would otherwise leave gaps.
    if ct.min_consecutive_days > 1:
        prev = d - timedelta(days=1)
        is_continuation = prev in assignments and assignments[prev].get(pid) == ct.name
        if not is_continuation:
            run_days: set[str] = set()
            if ct.night_float_run:
                run_days = {
                    t.strip() for t in ct.night_float_run.split(",") if t.strip()
                }
            needed = ct.min_consecutive_days - 1
            for offset in range(1, needed + 1):
                future = d + timedelta(days=offset)
                if run_days and DAY_LABELS[future.weekday()] not in run_days:
                    break  # end of run — stop requiring further availability
                if future in leave_dates.get(pid, set()):
                    return False
                if future in block_dates.get(pid, set()):
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

    if ct.uses_consultant_affinity and day.consultant_oncall_id is not None:
        if person.supervisor_id == day.consultant_oncall_id:
            score += 5.0
        elif (
            day.consultant_oncall_team_id is not None
            and person.team_id == day.consultant_oncall_team_id
        ):
            score += 3.0

    if day.d in request_dates.get(person.id, set()):
        score += 20.0

    # Night float run continuity bonus: same person should cover consecutive run days
    if ct.night_float_run:
        run_days = {d.strip() for d in ct.night_float_run.split(",")}
        today_label = DAY_LABELS[day.d.weekday()]
        if today_label in run_days:
            prev_day = day.d - timedelta(days=1)
            prev_label = DAY_LABELS[prev_day.weekday()]
            if prev_label in run_days and prev_day in assignments:
                if (
                    person.id in assignments[prev_day]
                    and assignments[prev_day].get(person.id) == ct.name
                ):
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


def _solve_cp_sat(
    inp: SolverInput,
    stepdown_dates: set[date],
    ct_config_dict: dict,
    time_limit_seconds: int = 30,
) -> dict[date, dict[int, str]] | None:
    """
    OR-Tools CP-SAT solver for call roster assignment.

    Builds a constraint-satisfaction model where each (person, day, call_type)
    triple is a boolean variable. Hard constraints mirror _is_eligible(); the
    objective minimises the spread of difficulty-points across staff.

    Returns the assignment dict on success, or None if infeasible / timeout.
    """
    try:
        from ortools.sat.python import cp_model  # type: ignore[import]
    except ImportError:
        logger.warning("ortools not installed — skipping CP-SAT, using greedy fallback")
        return None

    model = cp_model.CpModel()

    people = inp.mo_pool
    pid_index = {p.id: i for i, p in enumerate(people)}
    days = inp.days
    d_index = {day.d: i for i, day in enumerate(days)}

    # Pre-compute which call types are required on each day
    required_slots: dict[int, list[CallTypeInfo]] = {
        i: _required_slots(day, inp.call_type_configs) for i, day in enumerate(days)
    }

    # ── Decision variables ────────────────────────────────────────────────────
    # x[pi][di][cti] = 1 if person pi assigned call type cti on day di
    ct_index = {ct.name: i for i, ct in enumerate(inp.call_type_configs)}

    x: dict[tuple[int, int, int], cp_model.IntVar] = {}
    for pi in range(len(people)):
        for di in range(len(days)):
            for cti, ct in enumerate(inp.call_type_configs):
                x[(pi, di, cti)] = model.new_bool_var(f"x_{pi}_{di}_{cti}")

    # ── Hard constraints ─────────────────────────────────────────────────────

    # 1. Manual overrides: fix variables to 1
    override_set: set[tuple[int, int, str]] = set()  # (pid, di, ctype)
    for d_date, overrides in inp.manual_overrides.items():
        if d_date not in d_index:
            continue
        di = d_index[d_date]
        for ctype, pid in overrides.items():
            if pid not in pid_index or ctype not in ct_index:
                continue
            pi = pid_index[pid]
            cti = ct_index[ctype]
            model.add(x[(pi, di, cti)] == 1)
            override_set.add((pid, di, ctype))

    # 2. Coverage: each required slot must be filled by exactly one person.
    #    Mutually exclusive groups (e.g. MO3(WE) vs R1+2 on weekends) are
    #    handled as "exactly one assignment across the whole group" so the
    #    solver chooses which slot to fill rather than being forced to fill
    #    both — which would be infeasible or operationally wrong.
    def _cp_eligible(ct: CallTypeInfo, day: DayConfig) -> list[int]:
        return [
            pi
            for pi, p in enumerate(people)
            if (p.rank in ct.eligible_rank_names or ct.id in p.extra_call_type_ids)
            and day.d not in inp.leave_dates.get(p.id, set())
            and day.d not in inp.block_dates.get(p.id, set())
        ]

    processed_ctis: set[int] = set()
    for di, day in enumerate(days):
        for ct in required_slots[di]:
            cti = ct_index[ct.name]
            if cti in processed_ctis:
                continue

            # Collect all mutually exclusive partners also required today
            mutex_group: list[CallTypeInfo] = [ct]
            for ct2 in required_slots[di]:
                if ct2.name != ct.name and ct2.name in ct.mutually_exclusive_names:
                    mutex_group.append(ct2)

            if len(mutex_group) == 1:
                # No same-day mutual exclusivity — require exactly one person
                eligible = _cp_eligible(ct, day)
                if not eligible:
                    return None  # Infeasible slot — let greedy handle it
                model.add_exactly_one([x[(pi, di, cti)] for pi in eligible])
                for pi in set(range(len(people))) - set(eligible):
                    model.add(x[(pi, di, cti)] == 0)
            else:
                # Mutually exclusive group: at most one per slot, but exactly
                # one assignment across the entire group on this day.
                group_vars: list = []
                for ct_g in mutex_group:
                    cti_g = ct_index[ct_g.name]
                    eligible_g = _cp_eligible(ct_g, day)
                    ct_vars = [x[(pi, di, cti_g)] for pi in eligible_g]
                    if ct_vars:
                        model.add_at_most_one(ct_vars)
                    group_vars.extend(ct_vars)
                    for pi in set(range(len(people))) - set(eligible_g):
                        model.add(x[(pi, di, cti_g)] == 0)
                    processed_ctis.add(cti_g)
                if not group_vars:
                    return None  # Entire group infeasible — let greedy handle
                model.add(sum(group_vars) == 1)

            processed_ctis.add(cti)
        processed_ctis.clear()  # Reset per day

    # 3. Non-required slots: all zero (don't assign outside the schedule)
    for di, day in enumerate(days):
        required_ctis = {ct_index[ct.name] for ct in required_slots[di]}
        for cti in range(len(inp.call_type_configs)):
            if cti not in required_ctis:
                for pi in range(len(people)):
                    model.add(x[(pi, di, cti)] == 0)

    # 4. At most one call type per person per day
    for pi in range(len(people)):
        for di in range(len(days)):
            model.add_at_most_one(
                [x[(pi, di, cti)] for cti in range(len(inp.call_type_configs))]
            )

    # 5. Post-call gap: if overnight call on day d, person unavailable day d+1
    for pi, person in enumerate(people):
        for di, day in enumerate(days):
            for cti, ct in enumerate(inp.call_type_configs):
                if not ct.is_overnight or ct.post_call_type == "none":
                    continue
                if di + 1 >= len(days):
                    continue
                next_di = di + 1
                # x[pi][di][cti_overnight] = 1 → sum(x[pi][next_di][*]) = 0
                next_all = [
                    x[(pi, next_di, c)] for c in range(len(inp.call_type_configs))
                ]
                model.add(sum(next_all) == 0).only_enforce_if(x[(pi, di, cti)])

    # 6. Max consecutive days for same call type
    for pi in range(len(people)):
        for cti, ct in enumerate(inp.call_type_configs):
            max_c = ct.max_consecutive_days
            if max_c <= 0:
                continue
            for di in range(len(days) - max_c):
                window = [x[(pi, di + k, cti)] for k in range(max_c + 1)]
                model.add(sum(window) <= max_c)

    # 7. Min gap between same-type assignments (non-night-float)
    for pi in range(len(people)):
        for cti, ct in enumerate(inp.call_type_configs):
            if ct.is_night_float or ct.min_gap_days <= 1:
                continue
            gap = ct.min_gap_days
            for di in range(len(days)):
                for offset in range(1, gap):
                    di2 = di + offset
                    if di2 >= len(days):
                        break
                    model.add(x[(pi, di, cti)] + x[(pi, di2, cti)] <= 1)

    # 8. Night-float run continuity: consecutive run-days must be covered by the
    # same person.  Without this the fairness objective can split a Tue–Fri block
    # across two people (e.g. person A Tue+Wed, person B Thu+Fri), which is
    # operationally wrong.
    for cti, ct in enumerate(inp.call_type_configs):
        if not ct.is_night_float or not ct.night_float_run:
            continue
        run_days_set = {t.strip() for t in ct.night_float_run.split(",") if t.strip()}
        for di in range(len(days) - 1):
            label_a = DAY_LABELS[days[di].d.weekday()]
            label_b = DAY_LABELS[days[di + 1].d.weekday()]
            if label_a not in run_days_set or label_b not in run_days_set:
                continue
            # Both days are consecutive run-days: every person must have the
            # same assignment value on both days (either both 1 or both 0).
            for pi in range(len(people)):
                model.add(x[(pi, di, cti)] == x[(pi, di + 1, cti)])

    # 9. No overnight call-type switching within switch_window_days.
    # The greedy validator catches this; mirror it in CP-SAT so the solver
    # doesn't produce plans it would then flag as violations.
    overnight_ctis = [
        (cti, ct)
        for cti, ct in enumerate(inp.call_type_configs)
        if ct.is_overnight and ct.switch_window_days > 0
    ]
    for pi in range(len(people)):
        for cti1, ct1 in overnight_ctis:
            window = ct1.switch_window_days
            for di in range(len(days)):
                for offset in range(1, window + 1):
                    di2 = di + offset
                    if di2 >= len(days):
                        break
                    for cti2, ct2 in overnight_ctis:
                        if cti2 == cti1:
                            continue
                        # Person cannot have ct1 on di and a different overnight
                        # type on di2 (within the switching window).
                        model.add(x[(pi, di, cti1)] + x[(pi, di2, cti2)] <= 1)

    # ── Objective: minimise spread of difficulty-points across staff ──────────
    # difficulty[pi] = sum over all (di, cti) of ct.difficulty_points * x[pi][di][cti]
    # Minimise max(difficulty) - min(difficulty)
    diff_pts = [ct.difficulty_points for ct in inp.call_type_configs]

    # Scale to integers (CP-SAT requires integer coefficients)
    person_points = []
    for pi in range(len(people)):
        pts = sum(
            diff_pts[cti] * x[(pi, di, cti)]
            for di in range(len(days))
            for cti in range(len(inp.call_type_configs))
        )
        person_points.append(pts)

    if len(person_points) >= 2:
        max_pts = model.new_int_var(0, 10000, "max_pts")
        min_pts = model.new_int_var(0, 10000, "min_pts")
        for pts in person_points:
            model.add(pts <= max_pts)
            model.add(pts >= min_pts)
        model.minimize(max_pts - min_pts)

    # ── Solve ────────────────────────────────────────────────────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_seconds
    solver.parameters.log_search_progress = False

    status = solver.solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        logger.warning(
            "CP-SAT solver status=%s after %ds — falling back to greedy",
            solver.status_name(status),
            time_limit_seconds,
        )
        return None

    logger.info(
        "CP-SAT solver status=%s objective=%.1f wall=%.2fs",
        solver.status_name(status),
        solver.objective_value,
        solver.wall_time,
    )

    # Decode solution → {date: {staff_id: call_type}}
    result: dict[date, dict[int, str]] = {}
    for di, day in enumerate(days):
        for pi, person in enumerate(people):
            for cti, ct in enumerate(inp.call_type_configs):
                if solver.value(x[(pi, di, cti)]):
                    result.setdefault(day.d, {})[person.id] = ct.name

    # Merge manual overrides from prior_assignments (carry-over months)
    for d_date, mapping in inp.prior_assignments.items():
        if d_date not in {day.d for day in days}:
            result.setdefault(d_date, {}).update(mapping)

    return result


def solve(inp: SolverInput) -> tuple[dict[date, dict[int, str]], list[str]]:
    logger.info(
        "Solver starting: %d staff, %d days",
        len(inp.mo_pool),
        len(inp.days),
    )

    stepdown_dates: set[date] = set()
    for day in inp.days:
        if day.is_stepdown:
            stepdown_dates.add(day.d)

    ct_config_dict = _build_ct_config_dict(inp.call_type_configs)

    # ── Try OR-Tools CP-SAT first ─────────────────────────────────────────────
    cp_result = _solve_cp_sat(inp, stepdown_dates, ct_config_dict)
    if cp_result is not None:
        # Merge manual overrides explicitly
        for d_date, overrides in inp.manual_overrides.items():
            for ctype, pid in overrides.items():
                cp_result.setdefault(d_date, {})[pid] = ctype

        month_assignments = {
            d: mapping
            for d, mapping in cp_result.items()
            if any(day.d == d for day in inp.days)
        }
        # Run post-pass local search on the CP-SAT result too
        month_assignments = _local_search_swaps(
            month_assignments,
            cp_result,
            inp,
            stepdown_dates,
            ct_config_dict,
        )
        staff_names = {p.id: p.name for p in inp.mo_pool}
        violations = validate_full_roster(
            month_assignments, stepdown_dates, staff_names, ct_config_dict
        )
        total_assignments = sum(len(v) for v in month_assignments.values())
        logger.info(
            "CP-SAT solve complete: %d assignments, %d violations",
            total_assignments,
            len(violations),
        )
        if violations:
            for v in violations:
                logger.warning("Constraint violation: %s", v)
        return month_assignments, violations

    # ── Greedy fallback ────────────────────────────────────────────────────────
    logger.info("Using greedy solver (CP-SAT fallback)")
    assignments: dict[date, dict[int, str]] = {}

    for d, mapping in inp.prior_assignments.items():
        assignments[d] = dict(mapping)

    # stepdown_dates and ct_config_dict already computed above (before CP-SAT attempt)

    fairness = FairnessTracker()
    for pid in [p.id for p in inp.mo_pool]:
        fairness.total_all[pid] = 0
        fairness.total_24h[pid] = 0

    for day in inp.days:
        slots = _required_slots(day, inp.call_type_configs)
        daily: dict[int, str] = {}

        # Seed daily + assignments with manual overrides so the solver respects
        # them for double-assignment checks, post-call gaps, and night-float continuity.
        overrides_today = inp.manual_overrides.get(day.d, {})
        for ctype, pid in overrides_today.items():
            daily[pid] = ctype
            assignments.setdefault(day.d, {})[pid] = ctype
            call_is_24h = is_24h_call(ctype, day.d, stepdown_dates, ct_config_dict)
            ct_cfg = next((c for c in inp.call_type_configs if c.name == ctype), None)
            diff = ct_cfg.difficulty_points if ct_cfg else 1
            if ct_cfg is None or ct_cfg.counts_towards_fairness:
                fairness.record(
                    pid, ctype, day.is_weekend or day.is_ph, call_is_24h, diff
                )

        # Pre-assign night-float continuations before display-order slot processing.
        # Otherwise earlier-order slots (e.g. R1) can snap up the night-float person
        # before the continuity bonus applies to their real slot (e.g. R2).
        today_label = DAY_LABELS[day.d.weekday()]
        prev_day = day.d - timedelta(days=1)
        prev_label = DAY_LABELS[prev_day.weekday()]
        for ct in slots:
            if ct.name in overrides_today or ct.name in daily.values():
                continue
            if not ct.is_night_float or not ct.night_float_run:
                continue
            run_days = {t.strip() for t in ct.night_float_run.split(",") if t.strip()}
            if today_label not in run_days or prev_label not in run_days:
                continue
            prev_holder = next(
                (
                    pid
                    for pid, pct in assignments.get(prev_day, {}).items()
                    if pct == ct.name
                ),
                None,
            )
            if prev_holder is None:
                continue
            person = next((p for p in inp.mo_pool if p.id == prev_holder), None)
            if person is None:
                continue
            if not _is_eligible(
                person,
                day,
                ct,
                assignments,
                daily,
                inp.leave_dates,
                inp.block_dates,
                stepdown_dates,
                ct_config_dict,
            ):
                continue
            daily[person.id] = ct.name
            assignments.setdefault(day.d, {})[person.id] = ct.name
            call_is_24h = is_24h_call(ct.name, day.d, stepdown_dates, ct_config_dict)
            if ct.counts_towards_fairness:
                fairness.record(
                    person.id,
                    ct.name,
                    day.is_weekend or day.is_ph,
                    call_is_24h,
                    ct.difficulty_points,
                )

        for ct in slots:
            # Skip slots already filled by manual override or pre-assigned continuation
            if ct.name in overrides_today or ct.name in daily.values():
                continue
            # Mutual exclusion: if any mutually-exclusive call type is already
            # assigned today, skip this slot. Covers the R1+2 vs R1/R2 case
            # generically — no special-casing by name.
            if ct.mutually_exclusive_names and any(
                other in daily.values() for other in ct.mutually_exclusive_names
            ):
                continue

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
            call_is_24h = is_24h_call(ct.name, day.d, stepdown_dates, ct_config_dict)
            if ct.counts_towards_fairness:
                fairness.record(
                    chosen.id,
                    ct.name,
                    day.is_weekend or day.is_ph,
                    call_is_24h,
                    ct.difficulty_points,
                )

        assignments[day.d] = daily

    month_assignments = {
        d: mapping
        for d, mapping in assignments.items()
        if d.year == inp.year and d.month == inp.month
    }

    # Post-pass local search: swap pairs of same-call-type assignments if it
    # reduces difficulty-point stddev across staff and all constraints still hold.
    month_assignments = _local_search_swaps(
        month_assignments,
        assignments,
        inp,
        stepdown_dates,
        ct_config_dict,
    )

    staff_names = {p.id: p.name for p in inp.mo_pool}
    violations = validate_full_roster(
        month_assignments, stepdown_dates, staff_names, ct_config_dict
    )

    total_assignments = sum(len(v) for v in month_assignments.values())
    logger.info(
        "Solver complete: %d assignments, %d violations",
        total_assignments,
        len(violations),
    )
    if violations:
        for v in violations:
            logger.warning("Constraint violation: %s", v)

    return month_assignments, violations


def _local_search_swaps(
    month_assignments: dict[date, dict[int, str]],
    all_assignments: dict[date, dict[int, str]],
    inp: SolverInput,
    stepdown_dates: set[date],
    ct_config_dict: dict,
    max_passes: int = 5,
) -> dict[date, dict[int, str]]:
    """Try pairwise swaps (same call type, two different dates) that reduce
    difficulty-point stddev. Only swaps that preserve all hard constraints for
    both participants are kept. Iterates until no improvement or max_passes."""
    diff_by_type = {
        ct.name: (ct.difficulty_points if ct.counts_towards_fairness else 0)
        for ct in inp.call_type_configs
    }
    ct_by_name = {ct.name: ct for ct in inp.call_type_configs}

    def compute_diff_points() -> dict[int, int]:
        dp: dict[int, int] = defaultdict(int)
        for mapping in month_assignments.values():
            for pid, ctype in mapping.items():
                if pid == -1:
                    continue
                dp[pid] += diff_by_type.get(ctype, 1)
        return dp

    def stddev(values: list[float]) -> float:
        if not values:
            return 0.0
        mean = sum(values) / len(values)
        return (sum((v - mean) ** 2 for v in values) / len(values)) ** 0.5

    def current_score() -> float:
        dp = compute_diff_points()
        return stddev([float(dp.get(p.id, 0)) for p in inp.mo_pool])

    # Build a mutable view of all_assignments that local search will modify.
    # Manual overrides are frozen — never swap them.
    manual_keys: set[tuple[date, str]] = {
        (d, ct) for d, slots in inp.manual_overrides.items() for ct in slots
    }

    def is_valid_after_swap(
        pid: int,
        d: date,
        ct_name: str,
    ) -> bool:
        """Check pid is valid for (d, ct_name) under the hypothetical state where
        new_daily_pid replaces the current holder. We temporarily mutate
        all_assignments[d], run checks, then revert."""
        ct = ct_by_name.get(ct_name)
        if ct is None:
            return False
        person = next((p for p in inp.mo_pool if p.id == pid), None)
        if person is None:
            return False
        prev_day = all_assignments.get(d, {})
        original = dict(prev_day)
        # Apply the hypothetical: remove the old holder of ct_name, add pid
        new_day = {k: v for k, v in original.items() if v != ct_name}
        new_day[pid] = ct_name
        all_assignments[d] = new_day
        # Daily assignments should exclude the slot we're re-evaluating
        daily_excl = {k: v for k, v in new_day.items() if v != ct_name}
        try:
            ok = _is_eligible(
                person,
                _day_cfg_for(d, inp),
                ct,
                all_assignments,
                daily_excl,
                inp.leave_dates,
                inp.block_dates,
                stepdown_dates,
                ct_config_dict,
            )
        finally:
            all_assignments[d] = original
        return ok

    def find_holder(d: date, ct_name: str) -> int | None:
        for pid, ctype in month_assignments.get(d, {}).items():
            if ctype == ct_name and pid != -1:
                return pid
        return None

    def apply_swap(d1: date, d2: date, ct_name: str, p1: int, p2: int) -> None:
        month_assignments[d1].pop(p1, None)
        month_assignments[d1][p2] = ct_name
        month_assignments[d2].pop(p2, None)
        month_assignments[d2][p1] = ct_name
        all_assignments[d1] = month_assignments[d1]
        all_assignments[d2] = month_assignments[d2]

    swaps_applied = 0
    swaps_rejected_eligibility = 0
    swaps_rejected_stddev = 0
    passes_run = 0

    improved = True
    passes = 0
    while improved and passes < max_passes:
        improved = False
        passes += 1
        passes_run = passes
        baseline = current_score()
        # Candidate slots: (date, ct_name) pairs, excluding manual overrides
        # and call types that don't count towards fairness (no point balancing).
        slots_by_type: dict[str, list[date]] = defaultdict(list)
        for d, mapping in month_assignments.items():
            for pid, ctype in mapping.items():
                if pid == -1 or (d, ctype) in manual_keys:
                    continue
                ct_obj = ct_by_name.get(ctype)
                if ct_obj is not None and not ct_obj.counts_towards_fairness:
                    continue
                slots_by_type[ctype].append(d)

        for ct_name, dates in slots_by_type.items():
            dates_sorted = sorted(dates)
            for i in range(len(dates_sorted)):
                for j in range(i + 1, len(dates_sorted)):
                    d1, d2 = dates_sorted[i], dates_sorted[j]
                    p1 = find_holder(d1, ct_name)
                    p2 = find_holder(d2, ct_name)
                    if p1 is None or p2 is None or p1 == p2:
                        continue
                    # Reject if swap target person already holds a different slot
                    # on the same day — swapping would silently clobber that slot.
                    if (
                        p2 in month_assignments.get(d1, {})
                        and month_assignments[d1][p2] != ct_name
                    ):
                        continue
                    if (
                        p1 in month_assignments.get(d2, {})
                        and month_assignments[d2][p1] != ct_name
                    ):
                        continue
                    if not is_valid_after_swap(p2, d1, ct_name):
                        swaps_rejected_eligibility += 1
                        continue
                    if not is_valid_after_swap(p1, d2, ct_name):
                        swaps_rejected_eligibility += 1
                        continue
                    apply_swap(d1, d2, ct_name, p1, p2)
                    new_score = current_score()
                    if new_score < baseline - 1e-9:
                        baseline = new_score
                        improved = True
                        swaps_applied += 1
                    else:
                        apply_swap(d1, d2, ct_name, p2, p1)  # revert
                        swaps_rejected_stddev += 1

    logger.info(
        "local_search_swaps summary: passes_run=%d swaps_applied=%d "
        "swaps_rejected_eligibility=%d swaps_rejected_stddev=%d",
        passes_run,
        swaps_applied,
        swaps_rejected_eligibility,
        swaps_rejected_stddev,
    )
    return month_assignments


def _day_cfg_for(d: date, inp: SolverInput) -> DayConfig:
    for day in inp.days:
        if day.d == d:
            return day
    # Fallback for prior-month dates (shouldn't be swapped, but defensive)
    return DayConfig(
        d=d,
        is_weekend=d.weekday() >= 5,
        is_ph=False,
        is_stepdown=False,
        has_ext_ot=False,
    )


def compute_fairness_stats(
    assignments: dict[date, dict[int, str]],
    mo_pool: list[PersonInfo],
    stepdown_dates: set[date],
    call_type_configs: list[CallTypeInfo] | None = None,
) -> dict[str, dict]:
    ct_config_dict = (
        _build_ct_config_dict(call_type_configs) if call_type_configs else None
    )
    diff_by_type = (
        {ct.name: ct.difficulty_points for ct in call_type_configs}
        if call_type_configs
        else {}
    )
    counts_fairness = (
        {ct.name: ct.counts_towards_fairness for ct in call_type_configs}
        if call_type_configs
        else {}
    )

    ct_names = (
        sorted(ct.name for ct in call_type_configs)
        if call_type_configs
        else ["MO1", "MO2", "MO3", "MO4", "MO5"]
    )

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
            # Per-type count is always shown (assignment still happened),
            # but fairness aggregates skip call types flagged not-counting.
            if ctype in stats[name]["per_type"]:
                stats[name]["per_type"][ctype] += 1
            if not counts_fairness.get(ctype, True):
                continue
            stats[name]["total_all"] += 1
            if is_24h_call(ctype, d, stepdown_dates, ct_config_dict):
                stats[name]["total_24h"] += 1
            if is_wknd:
                stats[name]["weekend_ph"] += 1
            stats[name]["difficulty_points"] += diff_by_type.get(ctype, 1)

    return stats
