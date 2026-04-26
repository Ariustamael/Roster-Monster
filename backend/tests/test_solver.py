"""Unit tests for solver constraint logic — no database required."""
import pytest
from datetime import date, timedelta
from collections import defaultdict

import statistics

from app.services.solver import (
    CallTypeInfo,
    FairnessTracker,
    PersonInfo,
    DayConfig,
    SolverInput,
    _build_ct_config_dict,
    _is_eligible,
    _local_search_swaps,
    _score_candidate,
    compute_fairness_stats,
    solve,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_call_type(
    name: str = "MO1",
    is_overnight: bool = True,
    post_call_type: str = "8am",
    max_consecutive_days: int = 3,
    min_consecutive_days: int = 1,
    min_gap_days: int = 3,
    switch_window_days: int = 5,
    difficulty_points: int = 2,
    eligible_rank_names: set[str] | None = None,
    applicable_days: str = "any",
) -> CallTypeInfo:
    return CallTypeInfo(
        name=name,
        display_order=1,
        is_overnight=is_overnight,
        post_call_type=post_call_type,
        max_consecutive_days=max_consecutive_days,
        min_consecutive_days=min_consecutive_days,
        min_gap_days=min_gap_days,
        switch_window_days=switch_window_days,
        difficulty_points=difficulty_points,
        counts_towards_fairness=True,
        applicable_days=applicable_days,
        eligible_rank_names=eligible_rank_names or {"Medical Officer"},
        required_conditions="",
    )


def make_person(
    pid: int = 1,
    name: str = "Alice",
    rank: str = "Medical Officer",
) -> PersonInfo:
    return PersonInfo(id=pid, name=name, rank=rank)


def make_day(d: date | None = None, is_weekend: bool = False, is_ph: bool = False) -> DayConfig:
    return DayConfig(
        d=d or date(2026, 5, 4),  # Monday
        is_weekend=is_weekend,
        is_ph=is_ph,
        is_stepdown=False,
        has_ext_ot=False,
    )


def make_ct_config_dict(ct: CallTypeInfo) -> dict:
    """Minimal ct_config_dict required by validators."""
    return {
        ct.name: {
            "is_overnight": ct.is_overnight,
            "post_call_type": ct.post_call_type,
            "max_consecutive_days": ct.max_consecutive_days,
            "min_gap_days": ct.min_gap_days,
            "switch_window_days": ct.switch_window_days,
            "is_night_float": ct.is_night_float,
            "night_float_run": ct.night_float_run,
            "mutually_exclusive_names": set(),
        }
    }


# ── _is_eligible: leave ───────────────────────────────────────────────────────

def test_is_eligible_on_leave_returns_false():
    person = make_person()
    day = make_day()
    ct = make_call_type()
    leave_dates = {person.id: {day.d}}

    result = _is_eligible(
        person, day, ct,
        assignments={},
        daily_assignments={},
        leave_dates=leave_dates,
        block_dates={},
        stepdown_dates=set(),
        ct_config_dict=make_ct_config_dict(ct),
    )
    assert result is False


def test_is_eligible_not_on_leave_returns_true():
    person = make_person()
    day = make_day()
    ct = make_call_type()

    result = _is_eligible(
        person, day, ct,
        assignments={},
        daily_assignments={},
        leave_dates={},
        block_dates={},
        stepdown_dates=set(),
        ct_config_dict=make_ct_config_dict(ct),
    )
    assert result is True


# ── _is_eligible: block ───────────────────────────────────────────────────────

def test_is_eligible_blocked_returns_false():
    person = make_person()
    day = make_day()
    ct = make_call_type()
    block_dates = {person.id: {day.d}}

    result = _is_eligible(
        person, day, ct,
        assignments={},
        daily_assignments={},
        leave_dates={},
        block_dates=block_dates,
        stepdown_dates=set(),
        ct_config_dict=make_ct_config_dict(ct),
    )
    assert result is False


# ── _is_eligible: rank eligibility ────────────────────────────────────────────

def test_is_eligible_wrong_rank_returns_false():
    person = make_person(rank="Consultant")
    day = make_day()
    ct = make_call_type(eligible_rank_names={"Medical Officer"})

    result = _is_eligible(
        person, day, ct,
        assignments={},
        daily_assignments={},
        leave_dates={},
        block_dates={},
        stepdown_dates=set(),
        ct_config_dict=make_ct_config_dict(ct),
    )
    assert result is False


def test_is_eligible_correct_rank_returns_true():
    person = make_person(rank="Medical Officer")
    day = make_day()
    ct = make_call_type(eligible_rank_names={"Medical Officer"})

    result = _is_eligible(
        person, day, ct,
        assignments={},
        daily_assignments={},
        leave_dates={},
        block_dates={},
        stepdown_dates=set(),
        ct_config_dict=make_ct_config_dict(ct),
    )
    assert result is True


# ── _is_eligible: already assigned today ──────────────────────────────────────

def test_is_eligible_already_assigned_today_returns_false():
    person = make_person()
    day = make_day()
    ct = make_call_type()
    # Person already has a different call type today
    daily_assignments = {person.id: "MO2"}

    result = _is_eligible(
        person, day, ct,
        assignments={},
        daily_assignments=daily_assignments,
        leave_dates={},
        block_dates={},
        stepdown_dates=set(),
        ct_config_dict=make_ct_config_dict(ct),
    )
    assert result is False


# ── _is_eligible: post-call gap ───────────────────────────────────────────────

def test_is_eligible_postcall_gap_violated_returns_false():
    """Person worked overnight call yesterday — should be ineligible today."""
    person = make_person()
    today = date(2026, 5, 5)
    yesterday = today - timedelta(days=1)
    day = make_day(d=today)
    ct = make_call_type(name="MO1", is_overnight=True, post_call_type="8am")
    ct_config = make_ct_config_dict(ct)

    # Yesterday person had overnight call MO1
    assignments = {yesterday: {person.id: "MO1"}}

    result = _is_eligible(
        person, day, ct,
        assignments=assignments,
        daily_assignments={},
        leave_dates={},
        block_dates={},
        stepdown_dates=set(),
        ct_config_dict=ct_config,
    )
    assert result is False


# ── _is_eligible: max consecutive ─────────────────────────────────────────────

def test_is_eligible_max_consecutive_exceeded_returns_false():
    """Person assigned 3 consecutive days with max_consecutive=3 — day 4 is ineligible."""
    person = make_person()
    today = date(2026, 5, 7)
    ct = make_call_type(
        name="MO1",
        is_overnight=False,
        post_call_type="none",
        max_consecutive_days=3,
        min_gap_days=1,
    )
    ct_config = make_ct_config_dict(ct)

    # Built assignment history: 3 consecutive days of same type
    assignments = {
        date(2026, 5, 4): {person.id: "MO1"},
        date(2026, 5, 5): {person.id: "MO1"},
        date(2026, 5, 6): {person.id: "MO1"},
    }
    day = make_day(d=today)

    result = _is_eligible(
        person, day, ct,
        assignments=assignments,
        daily_assignments={},
        leave_dates={},
        block_dates={},
        stepdown_dates=set(),
        ct_config_dict=ct_config,
    )
    assert result is False


# ── compute_fairness_stats ────────────────────────────────────────────────────
# Signature: compute_fairness_stats(assignments, mo_pool, stepdown_dates, call_type_configs)
# Returns: dict keyed by staff name (str)

def test_compute_fairness_stats_counts_correctly():
    p1 = make_person(pid=1, name="Alice")
    p2 = make_person(pid=2, name="Bob")
    ct = make_call_type(name="MO1", difficulty_points=2)

    month_assignments = {
        date(2026, 5, 4): {1: "MO1"},
        date(2026, 5, 5): {1: "MO1", 2: "MO1"},
    }

    stats = compute_fairness_stats(month_assignments, [p1, p2], set(), [ct])

    assert stats["Alice"]["total_all"] == 2
    assert stats["Bob"]["total_all"] == 1
    assert stats["Alice"]["per_type"]["MO1"] == 2
    assert stats["Bob"]["per_type"]["MO1"] == 1


def test_compute_fairness_stats_empty_assignments():
    p1 = make_person(pid=1, name="Alice")
    ct = make_call_type()

    stats = compute_fairness_stats({}, [p1], set(), [ct])
    assert stats["Alice"]["total_all"] == 0
    assert stats["Alice"]["total_24h"] == 0


# ── OR-Tools CP-SAT smoke test ────────────────────────────────────────────────

def test_cp_sat_solver_finds_feasible_solution():
    """CP-SAT should assign the single required slot to the one eligible person."""
    from app.services.solver import SolverInput, solve

    p1 = make_person(pid=1, name="Alice", rank="Medical Officer")
    ct = make_call_type(
        name="MO1",
        is_overnight=False,
        post_call_type="none",
        max_consecutive_days=7,
        min_gap_days=1,
        eligible_rank_names={"Medical Officer"},
        applicable_days="all",
    )
    d = date(2026, 6, 1)
    day = make_day(d=d)

    inp = SolverInput(
        year=2026,
        month=6,
        days=[day],
        mo_pool=[p1],
        leave_dates={},
        block_dates={},
        request_dates={},
        call_type_configs=[ct],
    )

    assignments, violations = solve(inp)
    # Alice should be assigned MO1 on June 1
    assert d in assignments
    assert 1 in assignments[d]
    assert assignments[d][1] == "MO1"
    assert violations == []


# ── _score_candidate ─────────────────────────────────────────────────────────

def test_score_candidate_request_bonus():
    """Person who requested the date scores higher than one who did not."""
    p_req = make_person(pid=1, name="Alice")
    p_no  = make_person(pid=2, name="Bob")
    ct  = make_call_type()
    day = make_day()
    ft  = FairnessTracker()
    requests = {1: {day.d}}

    s_req = _score_candidate(p_req, day, ct, ft, requests, {}, set())
    s_no  = _score_candidate(p_no,  day, ct, ft, {},        {}, set())
    assert s_req > s_no


def test_score_candidate_fewer_calls_scores_higher():
    """Person with no prior calls scores higher than a busier peer."""
    p_few  = make_person(pid=1, name="Alice")
    p_many = make_person(pid=2, name="Bob")
    ct  = make_call_type()
    day = make_day()
    ft  = FairnessTracker()
    for _ in range(5):
        ft.record(p_many.id, ct.name, False, True, ct.difficulty_points)

    s_few  = _score_candidate(p_few,  day, ct, ft, {}, {}, set())
    s_many = _score_candidate(p_many, day, ct, ft, {}, {}, set())
    assert s_few > s_many


def test_score_candidate_consultant_affinity_bonus():
    """Person supervised by today's on-call consultant gets an affinity bonus."""
    consultant_id = 99
    p_aff = make_person(pid=1, name="Alice")
    p_aff.supervisor_id = consultant_id
    p_neu = make_person(pid=2, name="Bob")

    ct = make_call_type()
    ct.uses_consultant_affinity = True
    day = make_day()
    day.consultant_oncall_id = consultant_id

    ft = FairnessTracker()
    s_aff = _score_candidate(p_aff, day, ct, ft, {}, {}, set())
    s_neu = _score_candidate(p_neu, day, ct, ft, {}, {}, set())
    assert s_aff > s_neu


# ── _local_search_swaps ───────────────────────────────────────────────────────

def _make_solver_input_for_swaps(
    n_people: int, n_days: int, ct_name: str = "MO1"
) -> SolverInput:
    """Build a SolverInput with n_people and n_days, all eligible for ct_name."""
    ct = make_call_type(
        name=ct_name,
        is_overnight=False,
        post_call_type="none",
        max_consecutive_days=n_days,
        min_gap_days=1,
        applicable_days="all",
    )
    pool = [make_person(pid=i, name=f"Staff{i}") for i in range(1, n_people + 1)]
    start = date(2026, 7, 1)
    days = [make_day(d=start + timedelta(days=i)) for i in range(n_days)]
    return SolverInput(
        year=2026,
        month=7,
        days=days,
        mo_pool=pool,
        leave_dates={},
        block_dates={},
        request_dates={},
        call_type_configs=[ct],
    )


def test_local_search_swaps_does_not_increase_stddev():
    """
    _local_search_swaps must never increase the stddev of difficulty points.
    Run the greedy solver to get an initial assignment, then verify that after
    the local-search pass the stddev is equal or lower.
    """
    inp = _make_solver_input_for_swaps(n_people=5, n_days=20)
    ct = inp.call_type_configs[0]
    cdict = _build_ct_config_dict([ct])

    # Build an unbalanced initial assignment: give person 1 most of the calls.
    start = inp.days[0].d
    month_assignments: dict = {}
    for i, day in enumerate(inp.days):
        pid = (i % 5) + 1  # round-robin but skewed
        month_assignments[day.d] = {pid: ct.name}

    all_assignments = dict(month_assignments)

    def _diff_stddev(assignments: dict) -> float:
        pool_ids = [p.id for p in inp.mo_pool]
        totals = {pid: 0 for pid in pool_ids}
        for mapping in assignments.values():
            for pid, _ in mapping.items():
                if pid in totals:
                    totals[pid] += ct.difficulty_points
        vals = list(totals.values())
        return statistics.pstdev(vals)

    stddev_before = _diff_stddev(month_assignments)

    _local_search_swaps(
        inp=inp,
        month_assignments=month_assignments,
        all_assignments=all_assignments,
        stepdown_dates=set(),
        ct_config_dict=cdict,
    )

    stddev_after = _diff_stddev(month_assignments)
    assert stddev_after <= stddev_before + 1e-9, (
        f"local_search_swaps increased stddev: {stddev_before:.3f} -> {stddev_after:.3f}"
    )
