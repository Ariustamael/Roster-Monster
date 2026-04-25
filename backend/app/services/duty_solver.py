"""
Daytime duty solver — assigns MOs to OT, clinics (priority-ordered), and admin pool.

Runs AFTER call roster generation. For each weekday:
1. Consultant affinity pull: if an on-call MO's supervisor is operating today,
   pull that MO to the supervisor's OT and mark their anchor role (WARD_MO /
   EOT_MO) as vacated.
2. Assign remaining OT assistant slots (team match preferred, fairness scored).
3. Backfill vacated anchor roles from the remaining available pool.
4. Assign supervised clinic MOs (AM/PM, team match preferred).
5. Remaining clinic capacity follows the same priority order.
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
    session: "Session" = None  # type: ignore[assignment]  # AM / PM / FULL_DAY
    priority: int = 5
    # Staff IDs resolved from linked_manpower. When set, these are pre-assigned
    # to this OT slot before the general pool is used, even if they're on call
    # that day (the premise is that this OT *is* their daytime role).
    preferred_staff_ids: list[int] = field(default_factory=list)
    max_registrars: int = 1
    # Set of rank names eligible for this slot. Empty = no restriction.
    eligible_ranks: set[str] = field(default_factory=set)


@dataclass
class ClinicSlot:
    room: str
    session: Session
    clinic_type: str = "Sup"
    mos_required: int = 1
    consultant_id: int | None = None
    consultant_team_id: int | None = None
    priority: int = 5
    # Set of rank names eligible for this slot. Empty = no restriction.
    eligible_ranks: set[str] = field(default_factory=set)


@dataclass
class PersonInfo:
    id: int
    name: str
    rank: str = ""
    team_id: int | None = None
    supervisor_id: int | None = None
    duty_preference: str | None = None  # "OT" or "Clinic" or None
    has_admin_role: bool = False
    can_do_clinic: bool = True
    can_do_ot: bool = True


@dataclass
class DayDutyConfig:
    d: date
    is_weekend: bool
    is_ph: bool
    ot_slots: list[OTSlot]
    am_clinics: list[ClinicSlot]
    pm_clinics: list[ClinicSlot]
    # Staff already locked into AM / PM via manual overrides — solver must not
    # reassign them to other slots this session.
    pre_assigned_am: set[int] = field(default_factory=set)
    pre_assigned_pm: set[int] = field(default_factory=set)


@dataclass
class DutyResult:
    date: date
    staff_id: int
    session: Session
    duty_type: DutyType
    location: str | None = None
    consultant_id: int | None = None
    clinic_type: str | None = None  # template label (MOPD / Hand VC / Sup / NC)


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
    # New: anchor_duty name → set of eligible rank names for backfill
    anchor_duty_eligible_ranks: dict[str, set[str]] = field(default_factory=dict)
    # Set of rank names flagged as is_registrar_tier in RankConfig.
    # Falls back to the legacy ssr/sr names if empty (for backwards compat).
    registrar_rank_names: set[str] = field(default_factory=set)
    ssr_rank_name: str = "Senior Staff Registrar"
    sr_rank_name: str = "Senior Resident"


@dataclass
class FairnessTracker:
    ot_days: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    clinic_sessions: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    admin_sessions: dict[int, int] = field(default_factory=lambda: defaultdict(int))

    def ot_score(self, pid: int) -> float:
        max_ot = max(self.ot_days.values()) if self.ot_days else 1
        return 10.0 * (1.0 - self.ot_days[pid] / max(max_ot, 1))

    def clinic_score(self, pid: int) -> float:
        max_c = max(self.clinic_sessions.values()) if self.clinic_sessions else 1
        return 5.0 * (1.0 - self.clinic_sessions[pid] / max(max_c, 1))


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
        p
        for p in mo_pool
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
        p
        for p in mo_pool
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
    """Assign clinics for one session — all rendered uniformly as Clinic; the
    template label and priority distinguish kinds (SUP / NC / MOPD / HAND VC etc)."""
    # priority: 1 = highest (fill first), 10 = lowest
    for clinic in sorted(clinics, key=lambda c: c.priority):
        if clinic.mos_required <= 0:
            continue

        candidates = [
            p for p in pool
            if p.id not in assigned and p.rank != ssr_rank and p.can_do_clinic
            and (not clinic.eligible_ranks or p.rank in clinic.eligible_ranks)
        ]
        if not candidates:
            continue

        scored = sorted(
            candidates,
            key=lambda p: (
                fairness.clinic_score(p.id)
                + (
                    5.0
                    if clinic.consultant_id and p.supervisor_id == clinic.consultant_id
                    else 0.0
                )
                + (
                    3.0
                    if clinic.consultant_team_id
                    and p.team_id == clinic.consultant_team_id
                    else 0.0
                )
                + (2.0 if p.duty_preference == "Clinic" else 0.0)
                + (-5.0 if p.has_admin_role else 0.0)
            ),
            reverse=True,
        )

        for i in range(min(clinic.mos_required, len(scored))):
            chosen = scored[i]
            results.append(
                DutyResult(
                    date=day.d,
                    staff_id=chosen.id,
                    session=session,
                    duty_type=DutyType.CLINIC,
                    location=clinic.room,
                    consultant_id=clinic.consultant_id,
                    clinic_type=clinic.clinic_type,
                )
            )
            assigned.add(chosen.id)
            fairness.clinic_sessions[chosen.id] += 1


def solve_duties(inp: DutySolverInput) -> list[DutyResult]:
    results: list[DutyResult] = []
    fairness = FairnessTracker()

    ssr_rank = inp.ssr_rank_name
    sr_rank = inp.sr_rank_name
    # Prefer the RankConfig is_registrar_tier flag; fall back to legacy names
    registrar_ranks_set = (
        set(inp.registrar_rank_names) if inp.registrar_rank_names else {ssr_rank, sr_rank}
    )

    person_by_id: dict[int, PersonInfo] = {p.id: p for p in inp.mo_pool}

    for pid in [p.id for p in inp.mo_pool]:
        fairness.ot_days[pid] = 0
        fairness.clinic_sessions[pid] = 0
        fairness.admin_sessions[pid] = 0

    for day in inp.days:
        if day.is_weekend or day.is_ph:
            continue

        available_am = _available_mos_am(
            day,
            inp.mo_pool,
            inp.leave_dates,
            inp.call_assigned,
            inp.postcall_dates,
            inp.call_only_dates,
        )
        if not available_am and not inp.default_duty_by_call_type:
            continue

        am_assigned: set[int] = set(day.pre_assigned_am)
        pm_assigned: set[int] = set(day.pre_assigned_pm)
        full_day_assigned: set[int] = set(day.pre_assigned_am) & set(day.pre_assigned_pm)

        # ── Consultant affinity pull ────────────────────────────────
        # Find which consultants are operating today
        ot_cons_today: set[int] = {
            slot.consultant_id for slot in day.ot_slots if slot.consultant_id
        }
        vacated_anchor_roles: set[str] = set()

        # Compute PM pool upfront (needed for PM OTs)
        available_pm_precomp = _available_mos_pm(
            day, inp.mo_pool, inp.leave_dates,
            inp.call_assigned, inp.postcall_dates,
            inp.postcall_12pm_dates, inp.call_only_dates,
        )

        def _ot_session_context(ot_slot):
            """Return (pool, assigned_set, session_value) for this OT based on its session."""
            s = ot_slot.session or Session.FULL_DAY
            allowed_ranks = ot_slot.eligible_ranks
            # Respect per-staff can_do_ot flag and per-resource rank eligibility.
            def ot_eligible(p):
                if not p.can_do_ot:
                    return False
                if allowed_ranks and p.rank not in allowed_ranks:
                    return False
                return True
            if s == Session.AM:
                return (
                    [p for p in available_am if p.id not in am_assigned and ot_eligible(p)],
                    am_assigned, Session.AM,
                )
            if s == Session.PM:
                return (
                    [p for p in available_pm_precomp if p.id not in pm_assigned and ot_eligible(p)],
                    pm_assigned, Session.PM,
                )
            return (
                [p for p in available_am if p.id not in full_day_assigned and ot_eligible(p)],
                full_day_assigned, Session.FULL_DAY,
            )

        def _mark_ot_assigned(pid, session_value):
            if session_value == Session.AM:
                am_assigned.add(pid)
            elif session_value == Session.PM:
                pm_assigned.add(pid)
            else:
                full_day_assigned.add(pid)
                am_assigned.add(pid)
                pm_assigned.add(pid)

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
                    if (
                        ot.consultant_id == mo_person.supervisor_id
                        and ot.assistants_needed > 0
                    ):
                        dt = DutyType.EOT if ot.is_emergency else DutyType.OT
                        ot_session_val = ot.session or Session.FULL_DAY
                        results.append(
                            DutyResult(
                                date=day.d,
                                staff_id=mo_id,
                                session=ot_session_val,
                                duty_type=dt,
                                location=ot.room,
                                consultant_id=ot.consultant_id,
                            )
                        )
                        ot.assistants_needed -= 1
                        _mark_ot_assigned(mo_id, ot_session_val)
                        fairness.ot_days[mo_id] += 1
                        # Anchor role only fully vacated when it's a full-day pull
                        if ot_session_val == Session.FULL_DAY:
                            vacated_anchor_roles.add(anchor_duty)
                        break

        # ── 1. OT assignments (respecting each OT's session + priority) ──
        # priority: 1 = highest (fill first), 10 = lowest
        for ot in sorted(day.ot_slots, key=lambda o: o.priority):
            if ot.assistants_needed <= 0 and ot.registrar_needed <= 0:
                continue
            ot_session_val = ot.session or Session.FULL_DAY
            duty_type = DutyType.EOT if ot.is_emergency else DutyType.OT

            # Track registrars assigned to this OT across all pick phases
            # (preferred / registrar / assistant) to enforce max_registrars.
            registrars_in_ot = 0
            registrar_ranks = registrar_ranks_set

            # Pre-assign linked_manpower (call holders of the linked types).
            # These bypass the on-call daytime block because the premise is
            # that this OT *is* their daytime role. Still respect leave and
            # not-already-assigned-today.
            for pref_id in ot.preferred_staff_ids:
                if ot.assistants_needed <= 0:
                    break
                if pref_id in full_day_assigned:
                    continue
                if ot_session_val == Session.AM and pref_id in am_assigned:
                    continue
                if ot_session_val == Session.PM and pref_id in pm_assigned:
                    continue
                if day.d in inp.leave_dates.get(pref_id, set()):
                    continue
                person = person_by_id.get(pref_id)
                if person is None:
                    continue
                # Linked-manpower picks are explicit user intent, so we don't
                # enforce the registrar cap against them — but we do count
                # them so downstream assistant picks respect the cap.
                is_reg = person.rank in registrar_ranks
                results.append(
                    DutyResult(
                        date=day.d,
                        staff_id=pref_id,
                        session=ot_session_val,
                        duty_type=duty_type,
                        location=ot.room,
                        consultant_id=ot.consultant_id,
                    )
                )
                ot.assistants_needed -= 1
                _mark_ot_assigned(pref_id, ot_session_val)
                fairness.ot_days[pref_id] += 1
                if is_reg:
                    registrars_in_ot += 1

            if ot.assistants_needed <= 0 and ot.registrar_needed <= 0:
                continue
            pool, _assigned_set, ot_session_val = _ot_session_context(ot)
            if not pool:
                continue

            duty_type = DutyType.EOT if ot.is_emergency else DutyType.OT

            # Registrar slots first (SSR/SR ranks)
            if ot.registrar_needed > 0:
                reg_pool = [p for p in pool if p.rank in registrar_ranks_set]
                reg_scored = sorted(
                    reg_pool,
                    key=lambda p: (
                        fairness.ot_score(p.id)
                        + (
                            5.0
                            if ot.consultant_id and p.supervisor_id == ot.consultant_id
                            else 0.0
                        )
                        + (
                            3.0
                            if ot.consultant_team_id
                            and p.team_id == ot.consultant_team_id
                            else 0.0
                        )
                    ),
                    reverse=True,
                )
                for i in range(min(ot.registrar_needed, len(reg_scored))):
                    chosen = reg_scored[i]
                    results.append(
                        DutyResult(
                            date=day.d,
                            staff_id=chosen.id,
                            session=ot_session_val,
                            duty_type=duty_type,
                            location=ot.room,
                            consultant_id=ot.consultant_id,
                        )
                    )
                    _mark_ot_assigned(chosen.id, ot_session_val)
                    fairness.ot_days[chosen.id] += 1
                # Refresh pool after registrar picks
                pool, _assigned_set, _ = _ot_session_context(ot)

            # Assistant slots
            scored = sorted(
                [p for p in pool],
                key=lambda p: (
                    fairness.ot_score(p.id)
                    + (
                        5.0
                        if ot.consultant_id and p.supervisor_id == ot.consultant_id
                        else 0.0
                    )
                    + (
                        3.0
                        if ot.consultant_team_id and p.team_id == ot.consultant_team_id
                        else 0.0
                    )
                    + (3.0 if p.rank == sr_rank else 0.0)
                    # Duty preference nudge + admin-role deprioritization
                    + (2.0 if p.duty_preference == "OT" else 0.0)
                    + (-5.0 if p.has_admin_role else 0.0)
                ),
                reverse=True,
            )

            filled = 0
            for chosen in scored:
                if filled >= ot.assistants_needed:
                    break
                # Enforce max_registrars across the whole OT slot
                if chosen.rank in registrar_ranks and registrars_in_ot >= ot.max_registrars:
                    continue
                results.append(
                    DutyResult(
                        date=day.d,
                        staff_id=chosen.id,
                        session=ot_session_val,
                        duty_type=duty_type,
                        location=ot.room,
                        consultant_id=ot.consultant_id,
                    )
                )
                _mark_ot_assigned(chosen.id, ot_session_val)
                fairness.ot_days[chosen.id] += 1
                if chosen.rank in registrar_ranks:
                    registrars_in_ot += 1
                filled += 1

        # ── Anchor role assignments (Ward MO / EOT MO) ─────────────
        # Always generate an anchor role entry. If the MO was pulled to OT,
        # backfill from the available pool. Otherwise the MO covers it themselves.
        for call_type_name, anchor_duty in inp.default_duty_by_call_type.items():
            mo_id = inp.call_by_type.get(day.d, {}).get(call_type_name)
            if mo_id is None:
                continue
            anchor_dt = (
                DutyType.WARD_MO if anchor_duty == "Ward MO" else DutyType.EOT_MO
            )
            if mo_id not in full_day_assigned or anchor_duty not in vacated_anchor_roles:
                # Either: MO is on call and not pulled (covers their role themselves), or
                # MO is in an OT slot whose linked_manpower includes their call type
                # (their OT IS their anchor role — emit the anchor row anyway so the
                # Call Team always shows it).
                mo_person = person_by_id.get(mo_id)
                allowed_ranks = inp.anchor_duty_eligible_ranks.get(anchor_duty, set())
                if mo_person and (not allowed_ranks or mo_person.rank in allowed_ranks):
                    results.append(
                        DutyResult(
                            date=day.d,
                            staff_id=mo_id,
                            session=Session.FULL_DAY,
                            duty_type=anchor_dt,
                        )
                    )
            else:
                # MO was pulled to OT — backfill with someone else.
                # Respect the anchor call type's eligible ranks so e.g. Ward MO
                # (SMO/MO only) doesn't get backfilled by an SSR registrar.
                allowed_ranks = inp.anchor_duty_eligible_ranks.get(anchor_duty, set())
                candidates = sorted(
                    [
                        p for p in available_am
                        if p.id not in full_day_assigned
                        and (not allowed_ranks or p.rank in allowed_ranks)
                    ],
                    key=lambda p: fairness.ot_score(p.id),
                    reverse=True,
                )
                if candidates:
                    chosen = candidates[0]
                    results.append(
                        DutyResult(
                            date=day.d,
                            staff_id=chosen.id,
                            session=Session.FULL_DAY,
                            duty_type=anchor_dt,
                        )
                    )
                    full_day_assigned.add(chosen.id)
                    am_assigned.add(chosen.id)
                    pm_assigned.add(chosen.id)
                    fairness.ot_days[chosen.id] += 1

        # ── 2. AM session ───────────────────────────────────────────
        am_pool = [p for p in available_am if p.id not in am_assigned]
        _assign_session(
            day,
            Session.AM,
            day.am_clinics,
            am_pool,
            am_assigned,
            fairness,
            results,
            ssr_rank,
            sr_rank,
        )

        for p in am_pool:
            if p.id not in am_assigned:
                results.append(
                    DutyResult(
                        date=day.d,
                        staff_id=p.id,
                        session=Session.AM,
                        duty_type=DutyType.ADMIN,
                    )
                )
                am_assigned.add(p.id)
                fairness.admin_sessions[p.id] += 1

        # ── 3. PM session ───────────────────────────────────────────
        available_pm = _available_mos_pm(
            day,
            inp.mo_pool,
            inp.leave_dates,
            inp.call_assigned,
            inp.postcall_dates,
            inp.postcall_12pm_dates,
            inp.call_only_dates,
        )
        pm_pool = [p for p in available_pm if p.id not in pm_assigned]
        _assign_session(
            day,
            Session.PM,
            day.pm_clinics,
            pm_pool,
            pm_assigned,
            fairness,
            results,
            ssr_rank,
            sr_rank,
        )

        for p in pm_pool:
            if p.id not in pm_assigned:
                results.append(
                    DutyResult(
                        date=day.d,
                        staff_id=p.id,
                        session=Session.PM,
                        duty_type=DutyType.ADMIN,
                    )
                )
                pm_assigned.add(p.id)
                fairness.admin_sessions[p.id] += 1

    return results


def compute_duty_stats(
    results: list[DutyResult],
    mo_pool: list[PersonInfo],
    mo1_by_date: dict[date, int] | None = None,
) -> dict[str, dict]:
    """Aggregate duty assignments per person.

    mo1_by_date maps date → staff_id of the MO1 for that day. If a person has
    Ward MO on a day where they are also MO1, the Ward MO is treated as part
    of the MO1 role (not extra work) and is not counted.
    """
    stats: dict[str, dict] = {}
    pid_to_name = {p.id: p.name for p in mo_pool}
    mo1_by_date = mo1_by_date or {}

    for p in mo_pool:
        stats[p.name] = {
            "ot_days": 0,
            "eot_days": 0,
            "supervised_sessions": 0,
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
        elif r.duty_type == DutyType.CLINIC:
            stats[name]["supervised_sessions"] += 1
        elif r.duty_type == DutyType.ADMIN:
            stats[name]["admin_sessions"] += 1
        elif r.duty_type == DutyType.WARD_MO:
            # Skip if this person is also MO1 on this date — Ward MO is implied
            # by the MO1 role, so it's not "extra" duty work for them.
            if mo1_by_date.get(r.date) == r.staff_id:
                continue
            stats[name]["ward_mo_sessions"] += 1
        elif r.duty_type == DutyType.EOT_MO:
            stats[name]["eot_mo_sessions"] += 1

    return stats
