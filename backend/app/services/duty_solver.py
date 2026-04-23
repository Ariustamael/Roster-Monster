"""
Daytime duty solver — assigns MOs to OT, clinics, MOPD, and admin pool.

Runs AFTER call roster generation. For each weekday:
1. Consultant affinity pull: if an on-call MO's supervisor is operating today,
   pull that MO to the supervisor's OT and mark their anchor role (WARD_MO /
   EOT_MO) as vacated.
2. Assign remaining OT assistant slots (team match preferred, fairness scored).
3. Backfill vacated anchor roles from the remaining available pool.
4. Assign supervised clinic MOs (AM/PM, team match preferred).
5. Fill MOPD rooms (AM/PM).
6. Remaining MOs go to admin pool (AM/PM).

Weekends/PH have no OT or clinics — only the call team works.
"""

from datetime import date
from dataclasses import dataclass, field
from collections import defaultdict

from ..models import DutyType, Session


@dataclass
class OTSlot:
    room: str
    consultant_id: int | None
    consultant_team_id: int | None
    assistants_needed: int
    registrar_needed: int = 0
    is_emergency: bool = False
    linked_call_slot: str | None = None


@dataclass
class ClinicSlot:
    room: str
    session: Session
    clinic_type: str = "Sup"
    mos_required: int = 1
    consultant_id: int | None = None
    consultant_team_id: int | None = None


@dataclass
class PersonInfo:
    id: int
    name: str
    rank: str = ""
    team_id: int | None = None
    supervisor_id: int | None = None


@dataclass
class DayDutyConfig:
    d: date
    is_weekend: bool
    is_ph: bool
    ot_slots: list[OTSlot]
    am_clinics: list[ClinicSlot]
    pm_clinics: list[ClinicSlot]


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
    postcall_12pm_dates: dict[date, set[int]] = field(default_factory=dict)
    postcall_5pm_dates: dict[date, set[int]] = field(default_factory=dict)
    call_only_dates: dict[date, set[int]] = field(default_factory=dict)
    # New: maps {date: {call_type_name: staff_id}} for affinity pull
    call_by_type: dict[date, dict[str, int]] = field(default_factory=dict)
    # New: maps call_type_name → anchor duty type ("MO1" → "Ward MO", "MO2" → "EOT MO")
    default_duty_by_call_type: dict[str, str] = field(default_factory=dict)
    ssr_rank_name: str = "Senior Staff Registrar"
    sr_rank_name: str = "Senior Resident"


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


def _available_mos_am(
    day: DayDutyConfig,
    mo_pool: list[PersonInfo],
    leave_dates: dict[int, set[date]],
    call_assigned: dict[date, set[int]],
    postcall_dates: dict[date, set[int]],
    call_only_dates: dict[date, set[int]],
) -> list[PersonInfo]:
    on_call = call_assigned.get(day.d, set())
    post_call = postcall_dates.get(day.d, set())
    call_only = call_only_dates.get(day.d, set())
    return [
        p for p in mo_pool
        if p.id not in on_call
        and p.id not in post_call
        and p.id not in call_only
        and day.d not in leave_dates.get(p.id, set())
    ]


def _available_mos_pm(
    day: DayDutyConfig,
    mo_pool: list[PersonInfo],
    leave_dates: dict[int, set[date]],
    call_assigned: dict[date, set[int]],
    postcall_dates: dict[date, set[int]],
    postcall_12pm_dates: dict[date, set[int]],
    call_only_dates: dict[date, set[int]],
) -> list[PersonInfo]:
    on_call = call_assigned.get(day.d, set())
    post_call = postcall_dates.get(day.d, set())
    post_call_12 = postcall_12pm_dates.get(day.d, set())
    call_only = call_only_dates.get(day.d, set())
    return [
        p for p in mo_pool
        if p.id not in on_call
        and p.id not in post_call
        and p.id not in post_call_12
        and p.id not in call_only
        and day.d not in leave_dates.get(p.id, set())
    ]


def _assign_session(
    day: DayDutyConfig,
    session: Session,
    clinics: list[ClinicSlot],
    pool: list[PersonInfo],
    assigned: set[int],
    fairness: FairnessTracker,
    results: list[DutyResult],
    ssr_rank: str,
    sr_rank: str,
) -> None:
    """Assign clinics (NC/Sup/MOPD/CAT-A) for one session."""
    for clinic in clinics:
        if clinic.mos_required <= 0:
            continue
        if clinic.clinic_type == "MOPD":
            continue

        candidates = [
            p for p in pool
            if p.id not in assigned and p.rank != ssr_rank
        ]
        if not candidates:
            continue

        scored = sorted(
            candidates,
            key=lambda p: (
                fairness.clinic_score(p.id)
                + (5.0 if clinic.consultant_id and p.supervisor_id == clinic.consultant_id else 0.0)
                + (3.0 if clinic.consultant_team_id and p.team_id == clinic.consultant_team_id else 0.0)
            ),
            reverse=True,
        )

        duty_type = DutyType.CAT_A if clinic.clinic_type == "CAT-A" else DutyType.CLINIC
        for i in range(min(clinic.mos_required, len(scored))):
            chosen = scored[i]
            results.append(DutyResult(
                date=day.d, staff_id=chosen.id,
                session=session, duty_type=duty_type,
                location=clinic.room, consultant_id=clinic.consultant_id,
            ))
            assigned.add(chosen.id)
            fairness.clinic_sessions[chosen.id] += 1

    mopd_clinics = [c for c in clinics if c.clinic_type == "MOPD" and c.mos_required > 0]
    mopd_total = sum(c.mos_required for c in mopd_clinics)
    if mopd_total > 0:
        mopd_pool = [
            p for p in pool
            if p.id not in assigned
            and p.rank != ssr_rank
            and p.rank != sr_rank
        ]
        mopd_scored = sorted(
            mopd_pool,
            key=lambda p: fairness.mopd_score(p.id),
            reverse=True,
        )
        for i in range(min(mopd_total, len(mopd_scored))):
            chosen = mopd_scored[i]
            results.append(DutyResult(
                date=day.d, staff_id=chosen.id,
                session=session, duty_type=DutyType.MOPD,
                location="MOPD",
            ))
            assigned.add(chosen.id)
            fairness.mopd_sessions[chosen.id] += 1


def solve_duties(inp: DutySolverInput) -> list[DutyResult]:
    results: list[DutyResult] = []
    fairness = FairnessTracker()

    ssr_rank = inp.ssr_rank_name
    sr_rank = inp.sr_rank_name

    person_by_id: dict[int, PersonInfo] = {p.id: p for p in inp.mo_pool}

    for pid in [p.id for p in inp.mo_pool]:
        fairness.ot_days[pid] = 0
        fairness.clinic_sessions[pid] = 0
        fairness.mopd_sessions[pid] = 0
        fairness.admin_sessions[pid] = 0

    for day in inp.days:
        if day.is_weekend or day.is_ph:
            continue

        available_am = _available_mos_am(
            day, inp.mo_pool, inp.leave_dates,
            inp.call_assigned, inp.postcall_dates,
            inp.call_only_dates,
        )
        if not available_am and not inp.default_duty_by_call_type:
            continue

        am_assigned: set[int] = set()
        pm_assigned: set[int] = set()
        full_day_assigned: set[int] = set()

        # ── Consultant affinity pull ────────────────────────────────
        # Find which consultants are operating today
        ot_cons_today: set[int] = {
            slot.consultant_id for slot in day.ot_slots if slot.consultant_id
        }
        vacated_anchor_roles: set[str] = set()

        if ot_cons_today and inp.default_duty_by_call_type:
            for call_type_name, anchor_duty in inp.default_duty_by_call_type.items():
                mo_id = inp.call_by_type.get(day.d, {}).get(call_type_name)
                if mo_id is None:
                    continue
                mo_person = person_by_id.get(mo_id)
                if mo_person is None or mo_person.supervisor_id is None:
                    continue
                if mo_person.supervisor_id not in ot_cons_today:
                    continue
                # Find the supervisor's OT slot and assign the MO there
                for ot in day.ot_slots:
                    if ot.consultant_id == mo_person.supervisor_id and ot.assistants_needed > 0:
                        dt = DutyType.EOT if ot.is_emergency else DutyType.OT
                        results.append(DutyResult(
                            date=day.d, staff_id=mo_id,
                            session=Session.FULL_DAY, duty_type=dt,
                            location=ot.room, consultant_id=ot.consultant_id,
                        ))
                        ot.assistants_needed -= 1
                        full_day_assigned.add(mo_id)
                        am_assigned.add(mo_id)
                        pm_assigned.add(mo_id)
                        fairness.ot_days[mo_id] += 1
                        vacated_anchor_roles.add(anchor_duty)
                        break

        # ── 1. OT assignments (full day) ────────────────────────────
        for ot in day.ot_slots:
            if ot.assistants_needed <= 0 and ot.registrar_needed <= 0:
                continue
            pool = [p for p in available_am if p.id not in full_day_assigned]
            if not pool:
                break

            duty_type = DutyType.EOT if ot.is_emergency else DutyType.OT

            # Registrar slots first (SSR/SR ranks)
            if ot.registrar_needed > 0:
                reg_pool = [p for p in pool if p.rank in (ssr_rank, sr_rank)]
                reg_scored = sorted(
                    reg_pool,
                    key=lambda p: (
                        fairness.ot_score(p.id)
                        + (5.0 if ot.consultant_id and p.supervisor_id == ot.consultant_id else 0.0)
                        + (3.0 if ot.consultant_team_id and p.team_id == ot.consultant_team_id else 0.0)
                    ),
                    reverse=True,
                )
                for i in range(min(ot.registrar_needed, len(reg_scored))):
                    chosen = reg_scored[i]
                    results.append(DutyResult(
                        date=day.d, staff_id=chosen.id,
                        session=Session.FULL_DAY, duty_type=duty_type,
                        location=ot.room, consultant_id=ot.consultant_id,
                    ))
                    full_day_assigned.add(chosen.id)
                    am_assigned.add(chosen.id)
                    pm_assigned.add(chosen.id)
                    fairness.ot_days[chosen.id] += 1
                pool = [p for p in available_am if p.id not in full_day_assigned]

            # Assistant slots
            scored = sorted(
                [p for p in pool],
                key=lambda p: (
                    fairness.ot_score(p.id)
                    + (5.0 if ot.consultant_id and p.supervisor_id == ot.consultant_id else 0.0)
                    + (3.0 if ot.consultant_team_id and p.team_id == ot.consultant_team_id else 0.0)
                    + (3.0 if p.rank == sr_rank else 0.0)
                ),
                reverse=True,
            )

            for i in range(min(ot.assistants_needed, len(scored))):
                chosen = scored[i]
                results.append(DutyResult(
                    date=day.d, staff_id=chosen.id,
                    session=Session.FULL_DAY, duty_type=duty_type,
                    location=ot.room, consultant_id=ot.consultant_id,
                ))
                full_day_assigned.add(chosen.id)
                am_assigned.add(chosen.id)
                pm_assigned.add(chosen.id)
                fairness.ot_days[chosen.id] += 1

        # ── Backfill vacated anchor roles ───────────────────────────
        if "Ward MO" in vacated_anchor_roles:
            # WARD_MO: AM only (covers 0800-1730 until MO1 returns from OT)
            ward_candidates = sorted(
                [p for p in available_am if p.id not in am_assigned],
                key=lambda p: fairness.clinic_score(p.id),
                reverse=True,
            )
            if ward_candidates:
                chosen = ward_candidates[0]
                results.append(DutyResult(
                    date=day.d, staff_id=chosen.id,
                    session=Session.AM, duty_type=DutyType.WARD_MO,
                ))
                am_assigned.add(chosen.id)
                fairness.clinic_sessions[chosen.id] += 1

        if "EOT MO" in vacated_anchor_roles:
            # EOT_MO: Full day (covers MO2's daytime EOT duty)
            eot_candidates = sorted(
                [p for p in available_am if p.id not in full_day_assigned],
                key=lambda p: fairness.ot_score(p.id),
                reverse=True,
            )
            if eot_candidates:
                chosen = eot_candidates[0]
                results.append(DutyResult(
                    date=day.d, staff_id=chosen.id,
                    session=Session.FULL_DAY, duty_type=DutyType.EOT_MO,
                ))
                full_day_assigned.add(chosen.id)
                am_assigned.add(chosen.id)
                pm_assigned.add(chosen.id)
                fairness.ot_days[chosen.id] += 1

        # ── 2. AM session ───────────────────────────────────────────
        am_pool = [p for p in available_am if p.id not in am_assigned]
        _assign_session(
            day, Session.AM, day.am_clinics, am_pool,
            am_assigned, fairness, results, ssr_rank, sr_rank,
        )

        for p in am_pool:
            if p.id not in am_assigned:
                results.append(DutyResult(
                    date=day.d, staff_id=p.id,
                    session=Session.AM, duty_type=DutyType.ADMIN,
                ))
                am_assigned.add(p.id)
                fairness.admin_sessions[p.id] += 1

        # ── 3. PM session ───────────────────────────────────────────
        available_pm = _available_mos_pm(
            day, inp.mo_pool, inp.leave_dates,
            inp.call_assigned, inp.postcall_dates,
            inp.postcall_12pm_dates, inp.call_only_dates,
        )
        pm_pool = [p for p in available_pm if p.id not in pm_assigned]
        _assign_session(
            day, Session.PM, day.pm_clinics, pm_pool,
            pm_assigned, fairness, results, ssr_rank, sr_rank,
        )

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
            "eot_days": 0,
            "supervised_sessions": 0,
            "mopd_sessions": 0,
            "admin_sessions": 0,
            "ward_mo_sessions": 0,
            "eot_mo_sessions": 0,
        }

    for r in results:
        name = pid_to_name.get(r.staff_id)
        if not name or name not in stats:
            continue
        if r.duty_type == DutyType.OT:
            stats[name]["ot_days"] += 1
        elif r.duty_type == DutyType.EOT:
            stats[name]["eot_days"] += 1
        elif r.duty_type in (DutyType.CLINIC, DutyType.CAT_A):
            stats[name]["supervised_sessions"] += 1
        elif r.duty_type == DutyType.MOPD:
            stats[name]["mopd_sessions"] += 1
        elif r.duty_type == DutyType.ADMIN:
            stats[name]["admin_sessions"] += 1
        elif r.duty_type == DutyType.WARD_MO:
            stats[name]["ward_mo_sessions"] += 1
        elif r.duty_type == DutyType.EOT_MO:
            stats[name]["eot_mo_sessions"] += 1

    return stats
