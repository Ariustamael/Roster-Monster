"""
Daytime duty solver — assigns MOs to OT, clinics, MOPD, and admin pool.

Runs AFTER call roster generation. For each weekday:
1. Determine available MO pool (exclude on-call, post-call, leave)
2. Assign OT assistants (full day, team match preferred)
3. Assign supervised clinic MOs (AM/PM, team match preferred)
4. Fill MOPD rooms (AM/PM, min 3 per session)
5. Remaining MOs go to admin pool (AM/PM)

Weekends/PH have no OT or clinics — only call team works.
"""

from datetime import date, timedelta
from dataclasses import dataclass, field
from collections import defaultdict

from ..models import (
    CallType, DutyType, Session, OVERNIGHT_CALL_TYPES, MO_GRADES,
)


@dataclass
class OTSlot:
    room: str
    consultant_id: int
    consultant_team_id: int | None
    assistants_needed: int
    is_la: bool


@dataclass
class ClinicSlot:
    room: str
    session: Session
    is_supervised: bool
    consultant_id: int | None = None
    consultant_team_id: int | None = None


@dataclass
class PersonInfo:
    id: int
    name: str
    team_id: int | None = None


@dataclass
class DayDutyConfig:
    d: date
    is_weekend: bool
    is_ph: bool
    ot_slots: list[OTSlot]
    am_clinics: list[ClinicSlot]
    pm_clinics: list[ClinicSlot]
    mopd_rooms_am: int = 6
    mopd_rooms_pm: int = 6
    min_mopd_per_session: int = 3


@dataclass
class DutyResult:
    date: date
    staff_id: int
    session: Session
    duty_type: DutyType
    location: str | None = None
    consultant_id: int | None = None


@dataclass
class DutySolverInput:
    year: int
    month: int
    days: list[DayDutyConfig]
    mo_pool: list[PersonInfo]
    leave_dates: dict[int, set[date]]
    call_assigned: dict[date, set[int]]
    postcall_dates: dict[date, set[int]]


@dataclass
class FairnessTracker:
    ot_days: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    clinic_sessions: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    mopd_sessions: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    admin_sessions: dict[int, int] = field(default_factory=lambda: defaultdict(int))

    def ot_score(self, pid: int) -> float:
        max_ot = max(self.ot_days.values()) if self.ot_days else 1
        return 10.0 * (1.0 - self.ot_days[pid] / max(max_ot, 1))

    def clinic_score(self, pid: int) -> float:
        max_c = max(self.clinic_sessions.values()) if self.clinic_sessions else 1
        return 5.0 * (1.0 - self.clinic_sessions[pid] / max(max_c, 1))

    def mopd_score(self, pid: int) -> float:
        max_m = max(self.mopd_sessions.values()) if self.mopd_sessions else 1
        return 3.0 * (1.0 - self.mopd_sessions[pid] / max(max_m, 1))


def _available_mos(
    day: DayDutyConfig,
    mo_pool: list[PersonInfo],
    leave_dates: dict[int, set[date]],
    call_assigned: dict[date, set[int]],
    postcall_dates: dict[date, set[int]],
) -> list[PersonInfo]:
    on_call = call_assigned.get(day.d, set())
    post_call = postcall_dates.get(day.d, set())
    return [
        p for p in mo_pool
        if p.id not in on_call
        and p.id not in post_call
        and day.d not in leave_dates.get(p.id, set())
    ]


def solve_duties(inp: DutySolverInput) -> list[DutyResult]:
    results: list[DutyResult] = []
    fairness = FairnessTracker()

    for pid in [p.id for p in inp.mo_pool]:
        fairness.ot_days[pid] = 0
        fairness.clinic_sessions[pid] = 0
        fairness.mopd_sessions[pid] = 0
        fairness.admin_sessions[pid] = 0

    for day in inp.days:
        if day.is_weekend or day.is_ph:
            continue

        available = _available_mos(
            day, inp.mo_pool, inp.leave_dates,
            inp.call_assigned, inp.postcall_dates,
        )
        if not available:
            continue

        am_assigned: set[int] = set()
        pm_assigned: set[int] = set()
        full_day_assigned: set[int] = set()

        # ── 1. OT assignments (full day) ────────────────────────────
        for ot in day.ot_slots:
            pool = [p for p in available if p.id not in full_day_assigned]
            if not pool:
                break

            scored = sorted(
                pool,
                key=lambda p: (
                    fairness.ot_score(p.id)
                    + (3.0 if ot.consultant_team_id and p.team_id == ot.consultant_team_id else 0.0)
                ),
                reverse=True,
            )

            for i in range(min(ot.assistants_needed, len(scored))):
                chosen = scored[i]
                results.append(DutyResult(
                    date=day.d, staff_id=chosen.id,
                    session=Session.FULL_DAY, duty_type=DutyType.OT,
                    location=ot.room, consultant_id=ot.consultant_id,
                ))
                full_day_assigned.add(chosen.id)
                am_assigned.add(chosen.id)
                pm_assigned.add(chosen.id)
                fairness.ot_days[chosen.id] += 1

        # ── 2. AM session ───────────────────────────────────────────
        am_pool = [p for p in available if p.id not in am_assigned]

        # Supervised clinics AM
        for clinic in day.am_clinics:
            if not clinic.is_supervised:
                continue
            candidates = [p for p in am_pool if p.id not in am_assigned]
            if not candidates:
                break
            scored = sorted(
                candidates,
                key=lambda p: (
                    fairness.clinic_score(p.id)
                    + (3.0 if clinic.consultant_team_id and p.team_id == clinic.consultant_team_id else 0.0)
                ),
                reverse=True,
            )
            chosen = scored[0]
            results.append(DutyResult(
                date=day.d, staff_id=chosen.id,
                session=Session.AM, duty_type=DutyType.SUPERVISED_CLINIC,
                location=clinic.room, consultant_id=clinic.consultant_id,
            ))
            am_assigned.add(chosen.id)
            fairness.clinic_sessions[chosen.id] += 1

        # MOPD AM
        mopd_am_pool = [p for p in am_pool if p.id not in am_assigned]
        supervised_am_count = sum(1 for c in day.am_clinics if c.is_supervised)
        mopd_slots_am = day.mopd_rooms_am - supervised_am_count
        mopd_to_assign = min(mopd_slots_am, len(mopd_am_pool))
        mopd_to_assign = max(mopd_to_assign, min(day.min_mopd_per_session, len(mopd_am_pool)))

        mopd_scored = sorted(
            mopd_am_pool,
            key=lambda p: fairness.mopd_score(p.id),
            reverse=True,
        )
        for i in range(min(mopd_to_assign, len(mopd_scored))):
            chosen = mopd_scored[i]
            results.append(DutyResult(
                date=day.d, staff_id=chosen.id,
                session=Session.AM, duty_type=DutyType.MOPD,
                location=f"MOPD",
            ))
            am_assigned.add(chosen.id)
            fairness.mopd_sessions[chosen.id] += 1

        # Admin AM
        for p in am_pool:
            if p.id not in am_assigned:
                results.append(DutyResult(
                    date=day.d, staff_id=p.id,
                    session=Session.AM, duty_type=DutyType.ADMIN,
                ))
                am_assigned.add(p.id)
                fairness.admin_sessions[p.id] += 1

        # ── 3. PM session ───────────────────────────────────────────
        pm_pool = [p for p in available if p.id not in pm_assigned]

        # Supervised clinics PM
        for clinic in day.pm_clinics:
            if not clinic.is_supervised:
                continue
            candidates = [p for p in pm_pool if p.id not in pm_assigned]
            if not candidates:
                break
            scored = sorted(
                candidates,
                key=lambda p: (
                    fairness.clinic_score(p.id)
                    + (3.0 if clinic.consultant_team_id and p.team_id == clinic.consultant_team_id else 0.0)
                ),
                reverse=True,
            )
            chosen = scored[0]
            results.append(DutyResult(
                date=day.d, staff_id=chosen.id,
                session=Session.PM, duty_type=DutyType.SUPERVISED_CLINIC,
                location=clinic.room, consultant_id=clinic.consultant_id,
            ))
            pm_assigned.add(chosen.id)
            fairness.clinic_sessions[chosen.id] += 1

        # MOPD PM
        mopd_pm_pool = [p for p in pm_pool if p.id not in pm_assigned]
        supervised_pm_count = sum(1 for c in day.pm_clinics if c.is_supervised)
        mopd_slots_pm = day.mopd_rooms_pm - supervised_pm_count
        mopd_to_assign = min(mopd_slots_pm, len(mopd_pm_pool))
        mopd_to_assign = max(mopd_to_assign, min(day.min_mopd_per_session, len(mopd_pm_pool)))

        mopd_scored = sorted(
            mopd_pm_pool,
            key=lambda p: fairness.mopd_score(p.id),
            reverse=True,
        )
        for i in range(min(mopd_to_assign, len(mopd_scored))):
            chosen = mopd_scored[i]
            results.append(DutyResult(
                date=day.d, staff_id=chosen.id,
                session=Session.PM, duty_type=DutyType.MOPD,
                location=f"MOPD",
            ))
            pm_assigned.add(chosen.id)
            fairness.mopd_sessions[chosen.id] += 1

        # Admin PM
        for p in pm_pool:
            if p.id not in pm_assigned:
                results.append(DutyResult(
                    date=day.d, staff_id=p.id,
                    session=Session.PM, duty_type=DutyType.ADMIN,
                ))
                pm_assigned.add(p.id)
                fairness.admin_sessions[p.id] += 1

    return results


def compute_duty_stats(
    results: list[DutyResult],
    mo_pool: list[PersonInfo],
) -> dict[str, dict]:
    stats: dict[str, dict] = {}
    pid_to_name = {p.id: p.name for p in mo_pool}

    for p in mo_pool:
        stats[p.name] = {
            "ot_days": 0,
            "supervised_sessions": 0,
            "mopd_sessions": 0,
            "admin_sessions": 0,
        }

    for r in results:
        name = pid_to_name.get(r.staff_id)
        if not name or name not in stats:
            continue
        if r.duty_type == DutyType.OT:
            stats[name]["ot_days"] += 1
        elif r.duty_type == DutyType.SUPERVISED_CLINIC:
            stats[name]["supervised_sessions"] += 1
        elif r.duty_type == DutyType.MOPD:
            stats[name]["mopd_sessions"] += 1
        elif r.duty_type == DutyType.ADMIN:
            stats[name]["admin_sessions"] += 1

    return stats
