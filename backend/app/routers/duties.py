import calendar
from datetime import date, timedelta
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession

from ..database import get_db
from ..models import (
    MonthlyConfig,
    CallAssignment,
    DutyAssignment,
    Staff,
    TeamAssignment,
    ResourceTemplate,
    Leave,
    PublicHoliday,
    ConsultantOnCall,
    ACOnCall,
    DutyType,
    Session,
    CallTypeConfig,
    RankConfig,
)
from ..schemas import (
    DutyRosterResponse,
    DayDutyRoster,
    DutyAssignmentOut,
    ResourceTemplateCreate,
    ResourceTemplateOut,
    DutyOverrideCreate,
    DutyAssignmentRestore,
    DutySwapRequest,
    DutySwapResponse,
)
from ..services.duty_solver import (
    DutySolverInput,
    DayDutyConfig,
    OTSlot,
    ClinicSlot,
    PersonInfo,
    solve_duties,
    compute_duty_stats,
)
from ..services.validators import is_overnight, get_post_call_type

router = APIRouter(prefix="/api", tags=["duties"])


# ── Resource Templates ──────────────────────────────────────────────────


def _resource_out(r: ResourceTemplate) -> ResourceTemplateOut:
    return ResourceTemplateOut(
        id=r.id,
        resource_type=r.resource_type,
        day_of_week=r.day_of_week,
        session=r.session,
        room=r.room,
        label=r.label or "",
        consultant_id=r.consultant_id,
        consultant_name=r.consultant.name if r.consultant else None,
        staff_required=r.staff_required if r.staff_required is not None else 1,
        is_emergency=r.is_emergency or False,
        linked_manpower=r.linked_manpower,
        weeks=r.weeks,
        color=r.color,
        is_active=r.is_active if r.is_active is not None else True,
        sort_order=r.sort_order or 0,
        priority=r.priority if r.priority is not None else 5,
        max_registrars=r.max_registrars if r.max_registrars is not None else 1,
        eligible_rank_ids=r.eligible_rank_ids,
        effective_date=r.effective_date,
    )


@router.get("/templates/resources", response_model=list[ResourceTemplateOut])
def list_resource_templates(db: DBSession = Depends(get_db)):
    """Weekly templates only — per-day overrides (effective_date set) are listed
    separately via GET /templates/resources/day."""
    rows = (
        db.query(ResourceTemplate)
        .filter(ResourceTemplate.effective_date.is_(None))
        .order_by(
            ResourceTemplate.day_of_week,
            ResourceTemplate.session,
            ResourceTemplate.sort_order,
            ResourceTemplate.room,
        )
        .all()
    )
    return [_resource_out(r) for r in rows]


@router.post("/templates/resources", response_model=ResourceTemplateOut)
def create_resource_template(
    payload: ResourceTemplateCreate, db: DBSession = Depends(get_db)
):
    t = ResourceTemplate(**payload.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return _resource_out(t)


@router.put("/templates/resources/{template_id}", response_model=ResourceTemplateOut)
def update_resource_template(
    template_id: int, payload: ResourceTemplateCreate, db: DBSession = Depends(get_db)
):
    t = db.query(ResourceTemplate).get(template_id)
    if not t:
        raise HTTPException(404)
    for k, v in payload.model_dump().items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return _resource_out(t)


@router.delete("/templates/resources/{template_id}")
def delete_resource_template(template_id: int, db: DBSession = Depends(get_db)):
    t = db.query(ResourceTemplate).get(template_id)
    if not t:
        raise HTTPException(404)
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.post(
    "/templates/resources/{template_id}/duplicate", response_model=ResourceTemplateOut
)
def duplicate_resource_template(template_id: int, db: DBSession = Depends(get_db)):
    src = db.query(ResourceTemplate).get(template_id)
    if not src:
        raise HTTPException(404)
    dup = ResourceTemplate(
        resource_type=src.resource_type,
        day_of_week=src.day_of_week,
        session=src.session,
        room=src.room,
        label=src.label,
        consultant_id=src.consultant_id,
        staff_required=src.staff_required,
        is_emergency=src.is_emergency,
        linked_manpower=src.linked_manpower,
        weeks=src.weeks,
        color=src.color,
        is_active=src.is_active,
        sort_order=(src.sort_order or 0) + 1,
        priority=src.priority,
        max_registrars=src.max_registrars,
        eligible_rank_ids=src.eligible_rank_ids,
    )
    db.add(dup)
    db.commit()
    db.refresh(dup)
    return _resource_out(dup)


@router.put("/templates/resources/reorder")
def reorder_resource_templates(updates: list[dict], db: DBSession = Depends(get_db)):
    for u in updates:
        t = db.query(ResourceTemplate).get(u["id"])
        if t:
            t.sort_order = u["sort_order"]
            if "day_of_week" in u:
                t.day_of_week = u["day_of_week"]
            if "session" in u:
                t.session = u["session"]
    db.commit()
    return {"ok": True}


# ── Helpers ─────────────────────────────────────────────────────────────


def _get_duty_eligible_ranks(db: DBSession) -> set[str]:
    ranks = db.query(RankConfig).filter(RankConfig.is_duty_eligible.is_(True)).all()
    return {r.name for r in ranks}


def _resolve_eligible_ranks(csv_ids: str | None, rank_name_by_id: dict[int, str]) -> set[str]:
    """CSV of RankConfig ids → set of rank names. Empty/None → empty set (no restriction)."""
    if not csv_ids:
        return set()
    out: set[str] = set()
    for tok in csv_ids.split(","):
        tok = tok.strip()
        if tok.isdigit():
            name = rank_name_by_id.get(int(tok))
            if name:
                out.add(name)
    return out


def _load_ct_config_dict(db: DBSession) -> dict:
    configs = db.query(CallTypeConfig).filter(CallTypeConfig.is_active.is_(True)).all()
    return {
        ct.name: {
            "is_overnight": ct.is_overnight,
            "post_call_type": ct.post_call_type,
            "min_gap_days": ct.min_gap_days,
        }
        for ct in configs
    }


# ── Duty Generation ─────────────────────────────────────────────────────


def _build_duty_input(config: MonthlyConfig, db: DBSession) -> DutySolverInput:
    year, month = config.year, config.month
    num_days = calendar.monthrange(year, month)[1]

    ph_dates = {
        r.date
        for r in db.query(PublicHoliday).all()
        if r.date.year == year and r.date.month == month
    }

    consultant_team: dict[int, int] = {}
    for ta in (
        db.query(TeamAssignment).filter(TeamAssignment.role == "consultant").all()
    ):
        consultant_team[ta.staff_id] = ta.team_id

    rank_name_by_id = {r.id: r.name for r in db.query(RankConfig).all()}

    all_templates = (
        db.query(ResourceTemplate).filter(ResourceTemplate.is_active.is_(True)).all()
    )

    ot_by_dow_week: dict[tuple[int, int | None], list[ResourceTemplate]] = defaultdict(
        list
    )
    clinic_by_dow_session: dict[tuple[int, str], list[ResourceTemplate]] = defaultdict(
        list
    )
    # Per-date override sets — when a date has any override row, the day uses
    # ONLY those rows for resource derivation (weekly templates suppressed).
    ot_by_date: dict[date, list[ResourceTemplate]] = defaultdict(list)
    clinic_by_date_session: dict[tuple[date, str], list[ResourceTemplate]] = defaultdict(list)
    overridden_dates: set[date] = set()
    for t in all_templates:
        if t.effective_date:
            overridden_dates.add(t.effective_date)
            if t.resource_type == "ot":
                ot_by_date[t.effective_date].append(t)
            else:
                clinic_by_date_session[(t.effective_date, t.session.value)].append(t)
            continue
        if t.resource_type == "ot":
            if t.weeks:
                for w in t.weeks.split(","):
                    ot_by_dow_week[(t.day_of_week, int(w.strip()))].append(t)
            else:
                ot_by_dow_week[(t.day_of_week, None)].append(t)
        else:
            clinic_by_dow_session[(t.day_of_week, t.session.value)].append(t)

    call_rows = (
        db.query(CallAssignment)
        .filter(
            CallAssignment.config_id == config.id,
        )
        .all()
    )

    call_assigned: dict[date, set[int]] = defaultdict(set)
    for r in call_rows:
        call_assigned[r.date].add(r.staff_id)

    # Build call_by_type early so OT slot construction can resolve linked_manpower
    call_by_type_early: dict[date, dict[str, int]] = defaultdict(dict)
    for r in call_rows:
        call_by_type_early[r.date][r.call_type] = r.staff_id

    # Call-type lookups for resolving duty-only types (EOT MO → MO2)
    _active_cts_for_linking = (
        db.query(CallTypeConfig).filter(CallTypeConfig.is_active.is_(True)).all()
    )
    _ct_by_name_for_linking = {ct.name: ct for ct in _active_cts_for_linking}
    _ct_name_by_id_for_linking = {ct.id: ct.name for ct in _active_cts_for_linking}

    ct_config_dict = _load_ct_config_dict(db)
    stepdown_dates = {sd.date for sd in config.stepdown_days}

    postcall_dates: dict[date, set[int]] = defaultdict(set)
    postcall_12pm_dates: dict[date, set[int]] = defaultdict(set)
    postcall_5pm_dates: dict[date, set[int]] = defaultdict(set)
    call_only_dates: dict[date, set[int]] = defaultdict(set)

    for r in call_rows:
        pct = get_post_call_type(r.call_type, ct_config_dict)
        next_day = r.date + timedelta(days=1)
        if pct == "8am":
            postcall_dates[next_day].add(r.staff_id)
        elif pct == "12pm":
            postcall_12pm_dates[next_day].add(r.staff_id)
        elif pct == "5pm":
            postcall_5pm_dates[next_day].add(r.staff_id)
        elif pct == "call_only":
            call_only_dates[next_day].add(r.staff_id)

    # Call-only types (e.g. MO3 weekday referral) exclude from daytime pool
    for r in call_rows:
        pct = get_post_call_type(r.call_type, ct_config_dict)
        if pct == "none" and not is_overnight(
            r.call_type, r.date, stepdown_dates, ct_config_dict
        ):
            # Daytime call-only duties (like MO3 referral) — exclude from daytime pool
            cfg = ct_config_dict.get(r.call_type, {})
            if not cfg.get("is_overnight", False):
                call_assigned[r.date].add(r.staff_id)

    # Existing manual overrides — the solver must respect these (don't reassign
    # those staff, and don't refill those slots).
    manual_overrides = (
        db.query(DutyAssignment)
        .filter(
            DutyAssignment.config_id == config.id,
            DutyAssignment.is_manual_override.is_(True),
        )
        .all()
    )
    overrides_by_date: dict[date, list[DutyAssignment]] = defaultdict(list)
    for ov in manual_overrides:
        overrides_by_date[ov.date].append(ov)

    days: list[DayDutyConfig] = []
    for day_num in range(1, num_days + 1):
        d = date(year, month, day_num)
        dow = d.weekday()
        is_wknd = dow >= 5
        is_ph = d in ph_dates

        week_num = (d.day - 1) // 7 + 1

        # Bucket today's manual overrides:
        # - per-(kind, location) fill counts so we can decrement slot capacity
        # - per-session staff_id sets so we can pre-mark them as assigned
        ov_filled_ot: dict[str, int] = defaultdict(int)
        ov_filled_clinic: dict[tuple[str, str], int] = defaultdict(int)  # (session, room)
        pre_am: set[int] = set()
        pre_pm: set[int] = set()
        for ov in overrides_by_date.get(d, []):
            ov_session = ov.session.value if hasattr(ov.session, "value") else ov.session
            if ov.duty_type in (DutyType.OT, DutyType.EOT, DutyType.WARD_MO, DutyType.EOT_MO):
                ov_filled_ot[ov.location or ""] += 1
                pre_am.add(ov.staff_id)
                pre_pm.add(ov.staff_id)
            elif ov.duty_type == DutyType.ADMIN:
                # Admin overrides don't compete for resource capacity but still
                # mark staff as occupied for that session.
                if ov_session == "AM":
                    pre_am.add(ov.staff_id)
                elif ov_session == "PM":
                    pre_pm.add(ov.staff_id)
                else:
                    pre_am.add(ov.staff_id); pre_pm.add(ov.staff_id)
            else:  # CLINIC / SPECIAL
                ov_filled_clinic[(ov_session, ov.location or "")] += 1
                if ov_session == "AM":
                    pre_am.add(ov.staff_id)
                elif ov_session == "PM":
                    pre_pm.add(ov.staff_id)
                else:
                    pre_am.add(ov.staff_id); pre_pm.add(ov.staff_id)

        day_ot_templates = []
        if d in overridden_dates:
            day_ot_templates.extend(ot_by_date.get(d, []))
        else:
            for t in ot_by_dow_week.get((dow, None), []):
                day_ot_templates.append(t)
            for t in ot_by_dow_week.get((dow, week_num), []):
                day_ot_templates.append(t)

        def _resolve_preferred_ids(linked_manpower: str | None) -> list[int]:
            """Map linked_manpower ("R1,MO2,EOT MO") to staff IDs of today's
            call holders. For duty-only types like "EOT MO" (linked to MO2),
            resolve through linked_to to find the source call holder. Dedup,
            preserve order."""
            if not linked_manpower:
                return []
            call_today = call_by_type_early.get(d, {})
            seen = set()
            ids: list[int] = []
            for token in linked_manpower.split(","):
                ct_name = token.strip()
                if not ct_name:
                    continue
                pid = call_today.get(ct_name)
                if pid is None:
                    # Duty-only fallback: find source call type via linked_to
                    target_ct = _ct_by_name_for_linking.get(ct_name)
                    if target_ct and target_ct.is_duty_only and target_ct.linked_to:
                        for src_id_tok in target_ct.linked_to.split(","):
                            src_id_tok = src_id_tok.strip()
                            if not src_id_tok.isdigit():
                                continue
                            src_name = _ct_name_by_id_for_linking.get(int(src_id_tok))
                            if src_name:
                                pid = call_today.get(src_name)
                                if pid is not None:
                                    break
                if pid is not None and pid not in seen:
                    seen.add(pid)
                    ids.append(pid)
            return ids

        ot_slots = []
        for t in day_ot_templates:
            preferred_ids = _resolve_preferred_ids(t.linked_manpower)
            if t.is_emergency:
                ot_slots.append(
                    OTSlot(
                        room=t.room,
                        consultant_id=t.consultant_id,
                        consultant_team_id=consultant_team.get(t.consultant_id)
                        if t.consultant_id
                        else None,
                        assistants_needed=max(0, (t.staff_required or 0) - ov_filled_ot.get(t.room or "", 0)),
                        registrar_needed=0,
                        is_emergency=True,
                        linked_call_slot=t.linked_manpower,
                        session=t.session,
                        priority=t.priority if t.priority is not None else 5,
                        preferred_staff_ids=preferred_ids,
                        max_registrars=t.max_registrars if t.max_registrars is not None else 1,
                        eligible_ranks=_resolve_eligible_ranks(t.eligible_rank_ids, rank_name_by_id),
                    )
                )
            elif not is_wknd and not is_ph:
                ot_slots.append(
                    OTSlot(
                        room=t.room,
                        consultant_id=t.consultant_id,
                        consultant_team_id=consultant_team.get(t.consultant_id)
                        if t.consultant_id
                        else None,
                        assistants_needed=max(0, (t.staff_required or 0) - ov_filled_ot.get(t.room or "", 0)),
                        registrar_needed=0,
                        session=t.session,
                        priority=t.priority if t.priority is not None else 5,
                        preferred_staff_ids=preferred_ids,
                        max_registrars=t.max_registrars if t.max_registrars is not None else 1,
                        linked_call_slot=t.linked_manpower,
                        eligible_ranks=_resolve_eligible_ranks(t.eligible_rank_ids, rank_name_by_id),
                    )
                )

        am_clinics = []
        pm_clinics = []
        if d in overridden_dates:
            am_src = clinic_by_date_session.get((d, Session.AM.value), [])
            pm_src = clinic_by_date_session.get((d, Session.PM.value), [])
        elif not is_wknd and not is_ph:
            am_src = clinic_by_dow_session.get((dow, Session.AM.value), [])
            pm_src = clinic_by_dow_session.get((dow, Session.PM.value), [])
        else:
            am_src = []
            pm_src = []
        if am_src or pm_src:
            for t in am_src:
                am_clinics.append(
                    ClinicSlot(
                        room=t.room,
                        session=Session.AM,
                        clinic_type=t.label or "Sup",
                        mos_required=max(0, (t.staff_required if t.staff_required is not None else 1)
                                          - ov_filled_clinic.get(("AM", t.room or ""), 0)),
                        consultant_id=t.consultant_id,
                        consultant_team_id=consultant_team.get(t.consultant_id)
                        if t.consultant_id
                        else None,
                        priority=t.priority if t.priority is not None else 5,
                        eligible_ranks=_resolve_eligible_ranks(t.eligible_rank_ids, rank_name_by_id),
                    )
                )
            for t in pm_src:
                pm_clinics.append(
                    ClinicSlot(
                        room=t.room,
                        session=Session.PM,
                        clinic_type=t.label or "Sup",
                        mos_required=max(0, (t.staff_required if t.staff_required is not None else 1)
                                          - ov_filled_clinic.get(("PM", t.room or ""), 0)),
                        consultant_id=t.consultant_id,
                        consultant_team_id=consultant_team.get(t.consultant_id)
                        if t.consultant_id
                        else None,
                        priority=t.priority if t.priority is not None else 5,
                        eligible_ranks=_resolve_eligible_ranks(t.eligible_rank_ids, rank_name_by_id),
                    )
                )

        days.append(
            DayDutyConfig(
                d=d,
                is_weekend=is_wknd,
                is_ph=is_ph,
                ot_slots=ot_slots,
                am_clinics=am_clinics,
                pm_clinics=pm_clinics,
                pre_assigned_am=pre_am,
                pre_assigned_pm=pre_pm,
            )
        )

    duty_eligible_ranks = _get_duty_eligible_ranks(db)
    duty_staff = (
        db.query(Staff)
        .filter(Staff.active.is_(True), Staff.rank.in_(list(duty_eligible_ranks)))
        .all()
    )
    mo_pool: list[PersonInfo] = []
    for s in duty_staff:
        ta = (
            db.query(TeamAssignment)
            .filter(
                TeamAssignment.staff_id == s.id,
                TeamAssignment.role.in_(["mo", "consultant"]),
                TeamAssignment.effective_from <= date(year, month, num_days),
            )
            .order_by(TeamAssignment.effective_from.desc())
            .first()
        )
        mo_pool.append(
            PersonInfo(
                id=s.id,
                name=s.name,
                rank=s.rank,
                team_id=ta.team_id if ta else None,
                supervisor_id=ta.supervisor_id if ta else None,
                duty_preference=s.duty_preference,
                has_admin_role=s.has_admin_role or False,
                can_do_clinic=s.can_do_clinic if s.can_do_clinic is not None else True,
                can_do_ot=s.can_do_ot if s.can_do_ot is not None else True,
            )
        )

    leave_dates: dict[int, set[date]] = defaultdict(set)
    for lv in (
        db.query(Leave)
        .filter(
            Leave.date >= date(year, month, 1),
            Leave.date <= date(year, month, num_days),
        )
        .all()
    ):
        leave_dates[lv.staff_id].add(lv.date)

    # Build call_by_type: {date: {call_type: staff_id}}
    call_by_type: dict[date, dict[str, int]] = defaultdict(dict)
    for r in call_rows:
        call_by_type[r.date][r.call_type] = r.staff_id

    # Build default_duty_by_call_type: maps source call type → duty type that
    # should auto-fill for that person. Two sources:
    #   1. Source call type's default_duty_type ("MO1 → Ward MO")
    #   2. Target call type's linked_to (Ward MO.linked_to = [MO1] → MO1 → Ward MO)
    default_duty_by_call_type: dict[str, str] = {}
    active_cts = (
        db.query(CallTypeConfig).filter(CallTypeConfig.is_active.is_(True)).all()
    )
    ct_name_by_id = {ct.id: ct.name for ct in active_cts}
    for ct in active_cts:
        if ct.default_duty_type:
            default_duty_by_call_type[ct.name] = ct.default_duty_type
    # Apply linked_to: only duty-only call types auto-fill from a source call
    # type. The reverse link (set automatically by the bidirectional sync) is
    # for UI visibility only and must NOT drive duty assignments — otherwise a
    # non-duty call type's rank eligibility gets bypassed.
    ct_by_name = {ct.name: ct for ct in active_cts}
    # Build rank name lookup so the duty solver can filter backfill candidates
    from ..models import RankConfig as _RankConfig
    rank_name_by_id = {r.id: r.name for r in db.query(_RankConfig).all()}
    anchor_duty_eligible_ranks: dict[str, set[str]] = {}
    for ct in active_cts:
        if not ct.is_duty_only:
            continue
        anchor_duty_eligible_ranks[ct.name] = {
            rank_name_by_id[er.rank_id]
            for er in ct.eligible_ranks
            if er.rank_id in rank_name_by_id
        }
    for ct in active_cts:
        if not ct.is_duty_only or not ct.linked_to:
            continue
        target_eligible_ranks = {
            er.rank_id for er in ct.eligible_ranks
        }
        for token in ct.linked_to.split(","):
            token = token.strip()
            if not token.isdigit():
                continue
            source_name = ct_name_by_id.get(int(token))
            if not source_name or source_name in default_duty_by_call_type:
                continue
            # Only link if source's rank pool overlaps with target's.
            # Prevents Ward MO (MO-only) from being auto-filled by R2 (SSR).
            source_ct = ct_by_name.get(source_name)
            if source_ct and target_eligible_ranks:
                source_rank_ids = {er.rank_id for er in source_ct.eligible_ranks}
                if source_rank_ids and not (source_rank_ids & target_eligible_ranks):
                    continue
            default_duty_by_call_type[source_name] = ct.name

    return DutySolverInput(
        year=year,
        month=month,
        days=days,
        mo_pool=mo_pool,
        leave_dates=dict(leave_dates),
        call_assigned=dict(call_assigned),
        postcall_dates=dict(postcall_dates),
        postcall_12pm_dates=dict(postcall_12pm_dates),
        postcall_5pm_dates=dict(postcall_5pm_dates),
        call_only_dates=dict(call_only_dates),
        call_by_type=dict(call_by_type),
        default_duty_by_call_type=default_duty_by_call_type,
        anchor_duty_eligible_ranks=anchor_duty_eligible_ranks,
        registrar_rank_names={
            r.name for r in db.query(RankConfig).filter(
                RankConfig.is_registrar_tier.is_(True),
                RankConfig.is_active.is_(True),
            ).all()
        },
    )


def _build_day_rosters(
    config: MonthlyConfig,
    db: DBSession,
    duty_results,
    pid_to_name: dict[int, str],
    cons_names: dict[int, str],
    postcall_dates: dict[date, set[int]],
) -> tuple[list[DayDutyRoster], list[str]]:
    from ..services.duty_solver import DutyResult as DR

    ph_dates = {
        r.date
        for r in db.query(PublicHoliday).all()
        if r.date.year == config.year and r.date.month == config.month
    }

    results_by_date: dict[date, list] = defaultdict(list)
    for r in duty_results:
        r_date = r.date if isinstance(r, DR) else r.date
        results_by_date[r_date].append(r)

    all_staff_names = {s.id: s.name for s in db.query(Staff).all()}

    # Expected resource templates per (day_of_week, week_in_month) so the UI can
    # render empty drop targets even when no one is currently assigned.
    all_templates = (
        db.query(ResourceTemplate).filter(ResourceTemplate.is_active.is_(True)).all()
    )
    templates_by_dow: dict[int, list[ResourceTemplate]] = defaultdict(list)
    templates_by_date: dict[date, list[ResourceTemplate]] = defaultdict(list)
    overridden_dates: set[date] = set()
    for t in all_templates:
        if t.effective_date:
            templates_by_date[t.effective_date].append(t)
            overridden_dates.add(t.effective_date)
        else:
            templates_by_dow[t.day_of_week].append(t)
    cons_name_by_id = {s.id: s.name for s in db.query(Staff).all()}

    call_rows = (
        db.query(CallAssignment)
        .filter(
            CallAssignment.config_id == config.id,
        )
        .all()
    )
    call_by_date: dict[date, dict[str, str]] = defaultdict(dict)
    for r in call_rows:
        call_by_date[r.date][r.call_type] = all_staff_names.get(
            r.staff_id, f"ID:{r.staff_id}"
        )

    cons_oncall_by_date: dict[date, str] = {}
    for r in (
        db.query(ConsultantOnCall).filter(ConsultantOnCall.config_id == config.id).all()
    ):
        cons_oncall_by_date[r.date] = all_staff_names.get(
            r.consultant_id, f"ID:{r.consultant_id}"
        )
    ac_oncall_by_date: dict[date, str] = {}
    for r in db.query(ACOnCall).filter(ACOnCall.config_id == config.id).all():
        ac_oncall_by_date[r.date] = all_staff_names.get(r.ac_id, f"ID:{r.ac_id}")

    # Lookup keyed by (room, session, consultant_id) so multiple unsited templates
    # (e.g. two SUP rooms with different consultants) don't collide. We always store a
    # consultant-less fallback as well.
    clinic_template_lookup: dict[
        tuple[str, str, int | None], tuple[str, int | None]
    ] = {}
    for ct in (
        db.query(ResourceTemplate)
        .filter(ResourceTemplate.resource_type == "clinic")
        .all()
    ):
        sess_v = ct.session.value if hasattr(ct.session, "value") else ct.session
        room_norm = ct.room or ""
        label_v = ct.label or "Sup"
        clinic_template_lookup[(room_norm, sess_v, ct.consultant_id)] = (
            label_v,
            ct.consultant_id,
        )
        clinic_template_lookup.setdefault(
            (room_norm, sess_v, None), (label_v, ct.consultant_id)
        )

    # Pool of duty-eligible MOs for auto-deriving the "free → Admin" column.
    duty_eligible_ranks = _get_duty_eligible_ranks(db)
    duty_eligible_staff = (
        db.query(Staff)
        .filter(Staff.active.is_(True), Staff.rank.in_(list(duty_eligible_ranks)))
        .all()
    ) if duty_eligible_ranks else []
    can_do_clinic_by_id = {s.id: bool(s.can_do_clinic) for s in db.query(Staff).all()}
    can_do_ot_by_id = {s.id: bool(s.can_do_ot) for s in db.query(Staff).all()}

    # Map (room, session_str) → set of call type names that resource pulls in via
    # linked_manpower. Used to silence "on-call and also assigned to X" comments when
    # the resource was designed to draft on-call holders.
    linked_by_resource: dict[tuple[str, str], set[str]] = {}
    for t in all_templates:
        if t.linked_manpower:
            sess_val = t.session.value if hasattr(t.session, "value") else t.session
            linked_by_resource[(t.room or "", sess_val)] = {
                x.strip() for x in t.linked_manpower.split(",") if x.strip()
            }

    ct_configs = (
        db.query(CallTypeConfig)
        .filter(CallTypeConfig.is_active.is_(True))
        .order_by(CallTypeConfig.display_order)
        .all()
    )
    ct_columns = [ct.name for ct in ct_configs]

    day_rosters: list[DayDutyRoster] = []
    num_days = calendar.monthrange(config.year, config.month)[1]
    for day_num in range(1, num_days + 1):
        d = date(config.year, config.month, day_num)
        is_wknd = d.weekday() >= 5
        is_ph = d in ph_dates

        pc_ids = postcall_dates.get(d, set())
        post_call_names = sorted(
            [all_staff_names.get(pid, f"ID:{pid}") for pid in pc_ids]
        )

        # Build unavailable pool (post-call + on-leave)
        unavailable = []
        for pid in pc_ids:
            unavailable.append(
                {
                    "staff_id": pid,
                    "staff_name": all_staff_names.get(pid, f"ID:{pid}"),
                    "reason": "Post-call",
                }
            )
        leave_rows = db.query(Leave).filter(Leave.date == d).all()
        for lv in leave_rows:
            unavailable.append(
                {
                    "staff_id": lv.staff_id,
                    "staff_name": all_staff_names.get(lv.staff_id, f"ID:{lv.staff_id}"),
                    "reason": lv.leave_type or "Leave",
                }
            )

        call_team = call_by_date.get(d, {})
        call_slots: dict[str, str | None] = {}
        for ctype, name in call_team.items():
            call_slots[ctype] = name

        day_results = results_by_date.get(d, [])
        ot_out = []
        eot_out = []
        am_clinics_out = []
        pm_clinics_out = []
        am_admin = []
        pm_admin = []

        for r in day_results:
            staff_id = r.staff_id
            session_val = r.session.value if hasattr(r.session, "value") else r.session
            loc = r.location or ""
            tpl = (
                clinic_template_lookup.get((loc, session_val, r.consultant_id))
                or clinic_template_lookup.get((loc, session_val, None))
            )
            tpl_label = tpl[0] if tpl else None
            tpl_consultant_id = tpl[1] if tpl else None
            # Prefer the stored clinic_type on the assignment row (set when the
            # assignment was written) over the template lookup, so distinct
            # templates that share (room, consultant_id) — e.g. MOPD vs Hand VC
            # both at room="-" with no consultant — render with the right label.
            ct = getattr(r, "clinic_type", None) or tpl_label

            # If the assignment was written without a consultant_id, back-fill from
            # the matched template so the duty card shows the consultant correctly.
            eff_cons_id = r.consultant_id or tpl_consultant_id
            eff_cons_name = (
                cons_names.get(eff_cons_id) if eff_cons_id else None
            )

            out = DutyAssignmentOut(
                id=getattr(r, "id", 0) or 0,
                date=r.date,
                staff_id=staff_id,
                staff_name=pid_to_name.get(
                    staff_id, all_staff_names.get(staff_id, f"ID:{staff_id}")
                ),
                session=r.session,
                duty_type=r.duty_type,
                location=r.location,
                consultant_id=eff_cons_id,
                consultant_name=eff_cons_name,
                clinic_type=ct,
                is_manual_override=getattr(r, "is_manual_override", False),
            )
            if r.duty_type in (DutyType.EOT, DutyType.EOT_MO, DutyType.WARD_MO):
                eot_out.append(out)
            elif r.duty_type == DutyType.OT:
                ot_out.append(out)
            elif r.session == Session.AM:
                if r.duty_type == DutyType.ADMIN:
                    am_admin.append(out)
                else:
                    am_clinics_out.append(out)
            elif r.session == Session.PM:
                if r.duty_type == DutyType.ADMIN:
                    pm_admin.append(out)
                else:
                    pm_clinics_out.append(out)
            elif r.session == Session.FULL_DAY:
                # Full-Day non-Admin/non-OT/non-EOT (rare); treat as both AM and PM clinic.
                if r.duty_type == DutyType.ADMIN:
                    am_admin.append(out)
                    pm_admin.append(out)
                else:
                    am_clinics_out.append(out)
                    pm_clinics_out.append(out)

        # Auto-fill Admin column with free duty-eligible staff (no other duty + available).
        unavail_ids = {u["staff_id"] for u in unavailable}
        # Resolve "on call today" set from call_team (names → ids)
        name_to_id = {n: i for i, n in all_staff_names.items()}
        on_call_ids = {name_to_id[n] for n in call_team.values() if n in name_to_id}
        # Per-staff call type today (so we can check linked_manpower legitimacy)
        call_type_by_staff: dict[int, str] = {}
        for ctype, name in call_team.items():
            sid = name_to_id.get(name)
            if sid is not None:
                call_type_by_staff[sid] = ctype

        # First: drop any explicit Admin rows for staff who already have a real
        # duty this session (e.g. legacy data where a solver-Admin row wasn't
        # cleared when the staff was later assigned to OT/EOT/Clinic).
        am_real_duty_ids = {a.staff_id for a in am_clinics_out + ot_out + eot_out}
        pm_real_duty_ids = {a.staff_id for a in pm_clinics_out + ot_out + eot_out}
        am_admin = [a for a in am_admin if a.staff_id not in am_real_duty_ids]
        pm_admin = [a for a in pm_admin if a.staff_id not in pm_real_duty_ids]

        am_assigned_ids = am_real_duty_ids | {a.staff_id for a in am_admin}
        pm_assigned_ids = pm_real_duty_ids | {a.staff_id for a in pm_admin}

        for s in duty_eligible_staff:
            if s.id in unavail_ids or s.id in on_call_ids:
                continue
            if s.id not in am_assigned_ids:
                am_admin.append(DutyAssignmentOut(
                    id=0,
                    date=d,
                    staff_id=s.id,
                    staff_name=s.name,
                    session=Session.AM,
                    duty_type=DutyType.ADMIN,
                    location=None,
                    consultant_id=None,
                    consultant_name=None,
                    clinic_type=None,
                    is_manual_override=False,
                ))
            if s.id not in pm_assigned_ids:
                pm_admin.append(DutyAssignmentOut(
                    id=0,
                    date=d,
                    staff_id=s.id,
                    staff_name=s.name,
                    session=Session.PM,
                    duty_type=DutyType.ADMIN,
                    location=None,
                    consultant_id=None,
                    consultant_name=None,
                    clinic_type=None,
                    is_manual_override=False,
                ))

        # Build expected-resources list so the UI can render empty drop zones
        # when a resource's staff count goes to 0 via manual removal.
        dow = d.weekday()
        week_num = (d.day - 1) // 7 + 1
        expected = []
        # Per-day overrides shadow weekly templates entirely for that date.
        if d in overridden_dates:
            day_template_source = templates_by_date.get(d, [])
            day_is_overridden = True
        else:
            day_template_source = templates_by_dow.get(dow, [])
            day_is_overridden = False
        for t in day_template_source:
            # Week filter (only relevant for weekly templates)
            if not day_is_overridden and t.weeks:
                ws = {int(w.strip()) for w in t.weeks.split(",") if w.strip().isdigit()}
                if week_num not in ws:
                    continue
            # Weekend/PH gating only applies to weekly templates; date-overrides
            # explicitly chose to be on this date so render them regardless.
            if not day_is_overridden:
                if t.resource_type == "clinic" and (is_wknd or is_ph):
                    continue
                if t.resource_type == "ot" and (is_wknd or is_ph) and not t.is_emergency:
                    continue
            expected.append({
                "resource_type": t.resource_type,
                "room": t.room,
                "label": t.label or "",
                "session": t.session.value if hasattr(t.session, "value") else t.session,
                "is_emergency": bool(t.is_emergency),
                "consultant_id": t.consultant_id,
                "consultant_name": cons_name_by_id.get(t.consultant_id) if t.consultant_id else None,
                "staff_required": t.staff_required or 0,
                "priority": t.priority if t.priority is not None else 5,
            })

        # Compute constraint warnings for this day (rendered as inline comments).
        warnings: list[str] = []
        leave_ids_today = {lv.staff_id for lv in leave_rows}

        # Linked-duty types: Ward MO / EOT MO are auto-assigned to whoever is on the
        # linked overnight call. They co-occur with on-call status BY DESIGN, so don't
        # flag them. We DO flag them when swapped out (assigned staff isn't on any call).
        LINKED_DUTY_TYPES = (DutyType.WARD_MO, DutyType.EOT_MO)

        # Real duties only — exclude linked duties from double-book detection and
        # general conflict checks.
        # Pretty resource label for warnings — prefer the template label
        # (clinic_type), then location, then "-".
        def _resource_label(a) -> str:
            ct = getattr(a, "clinic_type", None)
            loc = a.location
            if ct and loc and loc not in ("-", ""):
                return f"{ct} {loc}"
            if ct:
                return ct
            return loc or "-"

        real_ot = [a for a in ot_out if a.duty_type not in LINKED_DUTY_TYPES]
        real_eot = [a for a in eot_out if a.duty_type not in LINKED_DUTY_TYPES]
        am_appearances: dict[int, list[str]] = defaultdict(list)
        pm_appearances: dict[int, list[str]] = defaultdict(list)
        for a in real_ot:
            am_appearances[a.staff_id].append(f"OT ({_resource_label(a)})")
            pm_appearances[a.staff_id].append(f"OT ({_resource_label(a)})")
        for a in real_eot:
            pm_appearances[a.staff_id].append(f"EOT ({_resource_label(a)})")
        for a in am_clinics_out:
            am_appearances[a.staff_id].append(f"AM clinic ({_resource_label(a)})")
        for a in pm_clinics_out:
            pm_appearances[a.staff_id].append(f"PM clinic ({_resource_label(a)})")
        non_linked_assignments = real_ot + real_eot + am_clinics_out + pm_clinics_out
        for a in non_linked_assignments:
            sname = a.staff_name
            sess_val = a.session.value if hasattr(a.session, "value") else a.session
            this_call_type = call_type_by_staff.get(a.staff_id)
            linked_for_resource = linked_by_resource.get((a.location or "", sess_val), set())
            is_linked_assignment = (
                this_call_type is not None and this_call_type in linked_for_resource
            )
            res_label = _resource_label(a) if a.location else a.duty_type.value
            if a.staff_id in leave_ids_today:
                warnings.append(f"{sname} is on leave but assigned to {res_label}")
            if a.staff_id in pc_ids:
                warnings.append(f"{sname} is post-call but assigned to {res_label}")
            if a.staff_id in on_call_ids and not is_linked_assignment:
                ct = call_type_by_staff.get(a.staff_id) or "call"
                warnings.append(f"{sname} is on {ct} today and also assigned to {res_label}")
            if a.duty_type == DutyType.CLINIC and not can_do_clinic_by_id.get(a.staff_id, True):
                warnings.append(f"{sname} cannot do clinic but is assigned to {res_label}")
            if a.duty_type in (DutyType.OT, DutyType.EOT) and not can_do_ot_by_id.get(a.staff_id, True):
                warnings.append(f"{sname} cannot do OT but is assigned to {res_label}")

        # Linked duties: flag only when a MANUAL override placed someone who isn't
        # on any call into the role. Solver-emitted backfills (because the linked
        # call holder was pulled to a different OT) are expected — don't flag them.
        for a in [x for x in eot_out if x.duty_type in LINKED_DUTY_TYPES]:
            if a.staff_id not in on_call_ids and a.is_manual_override:
                label = "Ward MO" if a.duty_type == DutyType.WARD_MO else "EOT MO"
                warnings.append(f"{a.staff_name} is doing {label} but is not on the linked call")

        # Double-bookings.
        for sid, slots in am_appearances.items():
            if len(slots) > 1:
                sname = all_staff_names.get(sid, f"ID:{sid}")
                warnings.append(f"{sname} is double-booked AM: {', '.join(slots)}")
        for sid, slots in pm_appearances.items():
            if len(slots) > 1:
                sname = all_staff_names.get(sid, f"ID:{sid}")
                warnings.append(f"{sname} is double-booked PM: {', '.join(slots)}")
        # Consultant double-booking — same consultant running 2+ resources in
        # overlapping sessions (Full Day OT counts toward both AM and PM).
        cons_am: dict[int, list[str]] = defaultdict(list)
        cons_pm: dict[int, list[str]] = defaultdict(list)
        for r in expected:
            cid = r.get("consultant_id")
            if not cid:
                continue
            label = r.get("label") or r.get("room") or "?"
            sess = r.get("session")
            if sess == "AM":
                cons_am[cid].append(label)
            elif sess == "PM":
                cons_pm[cid].append(label)
            else:  # Full Day
                cons_am[cid].append(label)
                cons_pm[cid].append(label)
        for cid, slots in cons_am.items():
            if len(slots) > 1:
                cname = all_staff_names.get(cid, f"ID:{cid}")
                warnings.append(f"Consultant {cname} is double-booked AM: {', '.join(slots)}")
        for cid, slots in cons_pm.items():
            if len(slots) > 1:
                cname = all_staff_names.get(cid, f"ID:{cid}")
                warnings.append(f"Consultant {cname} is double-booked PM: {', '.join(slots)}")

        # Compute staffing shortfall — for each expected resource, count actual
        # assigned staff and sum the deficits. OTs (Full Day) match by location;
        # clinics match by (session, location, consultant_id, label).
        shortfall = 0
        ot_assigned_count: dict[str, int] = defaultdict(int)
        for a in ot_out + eot_out:
            if a.duty_type in (DutyType.OT, DutyType.EOT):
                ot_assigned_count[a.location or ""] += 1
        clinic_assigned_count: dict[tuple, int] = defaultdict(int)
        for a in am_clinics_out:
            ct_label = (a.clinic_type or "")
            clinic_assigned_count[("AM", a.location or "", a.consultant_id, ct_label)] += 1
        for a in pm_clinics_out:
            ct_label = (a.clinic_type or "")
            clinic_assigned_count[("PM", a.location or "", a.consultant_id, ct_label)] += 1
        for r in expected:
            req = r.get("staff_required") or 0
            if req <= 0:
                continue
            if r["resource_type"] == "ot":
                got = ot_assigned_count.get(r["room"] or "", 0)
            else:
                key = (r["session"], r["room"] or "", r["consultant_id"], r["label"] or "")
                got = clinic_assigned_count.get(key, 0)
            if req > got:
                shortfall += (req - got)

        # Dedupe while preserving order.
        seen = set()
        warnings = [w for w in warnings if not (w in seen or seen.add(w))]

        day_rosters.append(
            DayDutyRoster(
                date=d,
                day_name=d.strftime("%a"),
                is_weekend=is_wknd,
                is_ph=is_ph,
                consultant_oncall=cons_oncall_by_date.get(d),
                ac_oncall=ac_oncall_by_date.get(d),
                call_slots=call_slots,
                post_call=post_call_names,
                ot_assignments=ot_out,
                eot_assignments=eot_out,
                am_clinics=am_clinics_out,
                pm_clinics=pm_clinics_out,
                am_admin=am_admin,
                pm_admin=pm_admin,
                expected_resources=expected,
                unavailable=unavailable,
                warnings=warnings,
                shortfall=shortfall,
            )
        )

    return day_rosters, ct_columns


@router.post("/roster/{config_id}/generate-duties", response_model=DutyRosterResponse)
def generate_duties(config_id: int, db: DBSession = Depends(get_db)):
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404, "Config not found")

    existing_calls = (
        db.query(CallAssignment)
        .filter(
            CallAssignment.config_id == config_id,
        )
        .count()
    )
    if existing_calls == 0:
        raise HTTPException(
            400, "Generate call roster first (POST /api/roster/{id}/generate)"
        )

    inp = _build_duty_input(config, db)
    duty_results = solve_duties(inp)

    db.query(DutyAssignment).filter(
        DutyAssignment.config_id == config_id,
        DutyAssignment.is_manual_override.is_(False),
    ).delete()

    pid_to_name = {p.id: p.name for p in inp.mo_pool}
    cons_names = {s.id: s.name for s in db.query(Staff).all()}

    for r in duty_results:
        db.add(
            DutyAssignment(
                config_id=config_id,
                date=r.date,
                staff_id=r.staff_id,
                session=r.session,
                duty_type=r.duty_type,
                location=r.location,
                consultant_id=r.consultant_id,
                is_manual_override=False,
                clinic_type=getattr(r, "clinic_type", None),
            )
        )
    db.commit()

    day_rosters, ct_columns = _build_day_rosters(
        config, db, duty_results, pid_to_name, cons_names, inp.postcall_dates
    )
    mo1_by_date = {d: slots["MO1"] for d, slots in inp.call_by_type.items() if "MO1" in slots}
    duty_stats = compute_duty_stats(duty_results, inp.mo_pool, mo1_by_date)

    return DutyRosterResponse(
        year=config.year,
        month=config.month,
        days=day_rosters,
        duty_stats=duty_stats,
        call_type_columns=ct_columns,
    )


# ── Bulk reset / restore ────────────────────────────────────────────────


@router.delete("/roster/{config_id}/duty-assignments")
def reset_all_duty_assignments(config_id: int, db: DBSession = Depends(get_db)):
    """Wipe every duty assignment (manual + solver) for the month. Caller
    typically chains a /generate-duties to repopulate."""
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404, "Config not found")
    deleted = (
        db.query(DutyAssignment)
        .filter(DutyAssignment.config_id == config_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "deleted": deleted}


@router.post("/roster/{config_id}/duty-assignments/restore")
def restore_duty_assignments(
    config_id: int,
    payload: list[DutyAssignmentRestore],
    db: DBSession = Depends(get_db),
    target_date: date | None = None,
):
    """Bulk-replace duty assignments with the supplied list — used by the
    frontend Undo to restore a prior snapshot.

    - If `target_date` is provided, wipes and restores only that date (per-day
      undo). The payload is filtered to that date.
    - Otherwise wipes the whole month and inserts the payload (global undo)."""
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404, "Config not found")

    q = db.query(DutyAssignment).filter(DutyAssignment.config_id == config_id)
    if target_date is not None:
        q = q.filter(DutyAssignment.date == target_date)
    q.delete(synchronize_session=False)

    from ..models import DutyType as DutyTypeEnum
    inserted = 0
    for r in payload:
        if target_date is not None and r.date != target_date:
            continue
        try:
            dt = DutyTypeEnum(r.duty_type)
        except ValueError:
            continue  # skip retired duty types
        db.add(
            DutyAssignment(
                config_id=config_id,
                date=r.date,
                staff_id=r.staff_id,
                session=r.session,
                duty_type=dt,
                location=r.location,
                consultant_id=r.consultant_id,
                is_manual_override=r.is_manual_override,
            )
        )
        inserted += 1
    db.commit()
    return {"ok": True, "count": inserted}


# ── Per-day resource overrides ──────────────────────────────────────────


@router.get("/templates/day-resources", response_model=list[ResourceTemplateOut])
def list_day_resource_overrides(
    target_date: date, db: DBSession = Depends(get_db)
):
    """All resource templates with effective_date == target_date (per-day overrides only)."""
    rows = (
        db.query(ResourceTemplate)
        .filter(ResourceTemplate.effective_date == target_date)
        .order_by(ResourceTemplate.sort_order)
        .all()
    )
    return [_resource_out(r) for r in rows]


@router.post("/templates/day-resources/initialize", response_model=list[ResourceTemplateOut])
def initialize_day_resource_overrides(
    target_date: date, db: DBSession = Depends(get_db)
):
    """Clone today's effective weekly templates into date-specific overrides so
    the user can edit them without affecting the weekly schedule. Idempotent —
    if overrides already exist for this date, returns them unchanged."""
    existing = (
        db.query(ResourceTemplate)
        .filter(ResourceTemplate.effective_date == target_date)
        .all()
    )
    if existing:
        return [_resource_out(r) for r in existing]

    dow = target_date.weekday()
    week_num = (target_date.day - 1) // 7 + 1
    weekly = (
        db.query(ResourceTemplate)
        .filter(
            ResourceTemplate.is_active.is_(True),
            ResourceTemplate.effective_date.is_(None),
            ResourceTemplate.day_of_week == dow,
        )
        .all()
    )
    cloned: list[ResourceTemplate] = []
    for t in weekly:
        if t.weeks:
            ws = {int(w.strip()) for w in t.weeks.split(",") if w.strip().isdigit()}
            if week_num not in ws:
                continue
        c = ResourceTemplate(
            resource_type=t.resource_type,
            day_of_week=t.day_of_week,
            session=t.session,
            room=t.room,
            label=t.label,
            consultant_id=t.consultant_id,
            staff_required=t.staff_required,
            is_emergency=t.is_emergency,
            linked_manpower=t.linked_manpower,
            weeks=None,
            color=t.color,
            is_active=True,
            sort_order=t.sort_order,
            priority=t.priority,
            max_registrars=t.max_registrars,
            eligible_rank_ids=t.eligible_rank_ids,
            effective_date=target_date,
        )
        db.add(c)
        cloned.append(c)
    db.commit()
    for c in cloned:
        db.refresh(c)
    return [_resource_out(r) for r in cloned]


@router.delete("/templates/day-resources")
def reset_day_resource_overrides(
    target_date: date, db: DBSession = Depends(get_db)
):
    """Delete all per-day overrides for target_date; the day reverts to weekly
    templates."""
    deleted = (
        db.query(ResourceTemplate)
        .filter(ResourceTemplate.effective_date == target_date)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"ok": True, "deleted": deleted}


# ── Single-day regenerate ───────────────────────────────────────────────


@router.post("/roster/{config_id}/regenerate-day", response_model=DutyRosterResponse)
def regenerate_day(
    config_id: int, target_date: date, db: DBSession = Depends(get_db)
):
    """Reset and re-solve a single date — wipes ALL duty rows for the date
    (including manual overrides) and re-runs the duty solver against the
    current resource layout. Use this to discard accidental drag-and-drop
    changes on a day, or after editing per-day resources via Edit Day."""
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404, "Config not found")
    if target_date.year != config.year or target_date.month != config.month:
        raise HTTPException(400, "target_date is outside this monthly config")

    existing_calls = (
        db.query(CallAssignment).filter(CallAssignment.config_id == config_id).count()
    )
    if existing_calls == 0:
        raise HTTPException(400, "Generate call roster first")

    # Wipe BEFORE building solver input — otherwise _build_duty_input reads the
    # day's existing manual overrides, decrements slot capacity, and the solver
    # produces an empty result for slots it thinks are already filled.
    db.query(DutyAssignment).filter(
        DutyAssignment.config_id == config_id,
        DutyAssignment.date == target_date,
    ).delete()
    db.commit()

    inp = _build_duty_input(config, db)
    target_day = next((d for d in inp.days if d.d == target_date), None)
    if target_day is None:
        raise HTTPException(400, "target_date has no day config")
    # Mark all OTHER days as weekend so the solver skips them.
    for day in inp.days:
        if day.d != target_date:
            day.is_weekend = True
    duty_results = solve_duties(inp)
    day_results = [r for r in duty_results if r.date == target_date]

    for r in day_results:
        db.add(
            DutyAssignment(
                config_id=config_id,
                date=r.date,
                staff_id=r.staff_id,
                session=r.session,
                duty_type=r.duty_type,
                location=r.location,
                consultant_id=r.consultant_id,
                is_manual_override=False,
                clinic_type=getattr(r, "clinic_type", None),
            )
        )
    db.commit()

    # Return the full updated roster view so the UI can refresh.
    all_duty_rows = (
        db.query(DutyAssignment).filter(DutyAssignment.config_id == config_id).all()
    )
    pid_to_name = {p.id: p.name for p in inp.mo_pool}
    cons_names = {s.id: s.name for s in db.query(Staff).all()}
    day_rosters, ct_columns = _build_day_rosters(
        config, db, all_duty_rows, pid_to_name, cons_names, inp.postcall_dates
    )
    mo1_by_date = {d: slots["MO1"] for d, slots in inp.call_by_type.items() if "MO1" in slots}
    duty_stats = compute_duty_stats(
        [type("R", (), {"date": r.date, "staff_id": r.staff_id, "session": r.session,
                         "duty_type": r.duty_type, "location": r.location,
                         "consultant_id": r.consultant_id})() for r in all_duty_rows],
        inp.mo_pool, mo1_by_date,
    )
    return DutyRosterResponse(
        year=config.year,
        month=config.month,
        days=day_rosters,
        duty_stats=duty_stats,
        call_type_columns=ct_columns,
    )


# ── Duty Overrides (manual drag-and-drop) ───────────────────────────────


@router.post("/roster/{config_id}/duty-override", response_model=DutyAssignmentOut)
def create_duty_override(
    config_id: int, payload: DutyOverrideCreate, db: DBSession = Depends(get_db)
):
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404, "Config not found")
    staff = db.query(Staff).get(payload.staff_id)
    if not staff:
        raise HTTPException(404, "Staff not found")

    if payload.old_assignment_id is not None:
        old = db.query(DutyAssignment).get(payload.old_assignment_id)
        if old and old.config_id == config_id:
            db.delete(old)

    from ..models import DutyType as DutyTypeEnum

    try:
        duty_type_val = DutyTypeEnum(payload.duty_type)
    except ValueError:
        raise HTTPException(400, f"Invalid duty_type: {payload.duty_type}")

    cons_names = {s.id: s.name for s in db.query(Staff).all()}
    new_da = DutyAssignment(
        config_id=config_id,
        date=payload.date,
        staff_id=payload.staff_id,
        session=payload.session,
        duty_type=duty_type_val,
        location=payload.location,
        consultant_id=payload.consultant_id,
        is_manual_override=True,
    )
    db.add(new_da)
    db.commit()
    db.refresh(new_da)

    return DutyAssignmentOut(
        id=new_da.id,
        date=new_da.date,
        staff_id=new_da.staff_id,
        staff_name=staff.name,
        session=new_da.session,
        duty_type=new_da.duty_type,
        location=new_da.location,
        consultant_id=new_da.consultant_id,
        consultant_name=cons_names.get(new_da.consultant_id)
        if new_da.consultant_id
        else None,
        is_manual_override=True,
    )


@router.delete("/roster/{config_id}/duty-override/{assignment_id}")
def delete_duty_override(
    config_id: int, assignment_id: int, db: DBSession = Depends(get_db)
):
    da = db.query(DutyAssignment).get(assignment_id)
    if not da or da.config_id != config_id:
        raise HTTPException(404, "Assignment not found")
    db.delete(da)
    db.commit()
    return {"ok": True}


@router.get("/roster/{config_id}/duties", response_model=list[DutyAssignmentOut])
def get_duties(config_id: int, db: DBSession = Depends(get_db)):
    rows = (
        db.query(DutyAssignment)
        .filter(DutyAssignment.config_id == config_id)
        .order_by(DutyAssignment.date, DutyAssignment.session)
        .all()
    )
    cons_names = {s.id: s.name for s in db.query(Staff).all()}
    return [
        DutyAssignmentOut(
            id=r.id,
            date=r.date,
            staff_id=r.staff_id,
            staff_name=r.staff.name,
            session=r.session,
            duty_type=r.duty_type,
            location=r.location,
            consultant_id=r.consultant_id,
            consultant_name=cons_names.get(r.consultant_id)
            if r.consultant_id
            else None,
            is_manual_override=r.is_manual_override,
        )
        for r in rows
    ]


@router.get("/roster/{config_id}/duties/view", response_model=DutyRosterResponse)
def view_duties(config_id: int, db: DBSession = Depends(get_db)):
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404, "Config not found")

    rows = (
        db.query(DutyAssignment)
        .filter(DutyAssignment.config_id == config_id)
        .order_by(DutyAssignment.date, DutyAssignment.session)
        .all()
    )
    if not rows:
        raise HTTPException(404, "No duty roster generated yet")

    all_staff_names = {s.id: s.name for s in db.query(Staff).all()}
    cons_names = all_staff_names
    pid_to_name = {r.staff_id: r.staff.name for r in rows}

    ct_config_dict = _load_ct_config_dict(db)
    call_rows = (
        db.query(CallAssignment).filter(CallAssignment.config_id == config_id).all()
    )
    postcall_dates: dict[date, set[int]] = defaultdict(set)
    for r in call_rows:
        pct = get_post_call_type(r.call_type, ct_config_dict)
        if pct in ("8am", "12pm", "5pm"):
            next_day = r.date + timedelta(days=1)
            postcall_dates[next_day].add(r.staff_id)

    day_rosters, ct_columns = _build_day_rosters(
        config, db, rows, pid_to_name, cons_names, dict(postcall_dates)
    )

    duty_eligible_ranks = _get_duty_eligible_ranks(db)
    duty_staff = (
        db.query(Staff)
        .filter(Staff.active.is_(True), Staff.rank.in_(list(duty_eligible_ranks)))
        .all()
    )
    mo_pool = [PersonInfo(id=s.id, name=s.name, rank=s.rank) for s in duty_staff]
    from ..services.duty_solver import DutyResult

    duty_results = [
        DutyResult(
            date=r.date,
            staff_id=r.staff_id,
            session=r.session,
            duty_type=r.duty_type,
            location=r.location,
            consultant_id=r.consultant_id,
        )
        for r in rows
    ]
    mo1_by_date = {
        c.date: c.staff_id
        for c in db.query(CallAssignment).filter(
            CallAssignment.config_id == config_id,
            CallAssignment.call_type == "MO1",
        ).all()
    }
    duty_stats = compute_duty_stats(duty_results, mo_pool, mo1_by_date)

    return DutyRosterResponse(
        year=config.year,
        month=config.month,
        days=day_rosters,
        duty_stats=duty_stats,
        call_type_columns=ct_columns,
    )


# ── Duty Swap (validated drag-and-drop) ─────────────────────────────────


def _validate_duty_swap(
    config_id: int,
    target_date: date,
    duty_type: str,
    session_val: Session,
    location: str | None,
    to_staff: Staff,
    old_assignment_id: int | None,
    duplicate: bool,
    db: DBSession,
) -> list[str]:
    """Server-side constraint check for placing `to_staff` into a duty slot.

    Reuses validators.check_post_call for post-call detection. Returns a list of
    human-readable violation strings (empty on success).
    """
    from ..services.validators import check_post_call

    violations: list[str] = []

    # 1. Leave that day
    leave_hit = (
        db.query(Leave)
        .filter(Leave.staff_id == to_staff.id, Leave.date == target_date)
        .first()
    )
    if leave_hit:
        violations.append(
            f"{to_staff.name} is on leave ({leave_hit.leave_type or 'Leave'}) on {target_date}"
        )

    # 2. Post-call from a 24h call the previous day
    ct_config_dict = _load_ct_config_dict(db)
    call_rows = (
        db.query(CallAssignment)
        .filter(CallAssignment.config_id == config_id)
        .all()
    )
    assignments_by_date: dict[date, dict[int, str]] = defaultdict(dict)
    for r in call_rows:
        assignments_by_date[r.date][r.staff_id] = r.call_type
    config = db.query(MonthlyConfig).get(config_id)
    stepdown_dates = {sd.date for sd in config.stepdown_days} if config else set()
    if not check_post_call(
        to_staff.id, target_date, dict(assignments_by_date), stepdown_dates, ct_config_dict
    ):
        violations.append(
            f"{to_staff.name} is post-call on {target_date} (had a 24h call the previous day)"
        )

    # 3. Already assigned another duty in a conflicting session.
    # Full Day blocks AM and PM; AM/PM block themselves and Full Day.
    if session_val == Session.FULL_DAY:
        blocked_sessions = {Session.AM, Session.PM, Session.FULL_DAY}
    else:
        blocked_sessions = {session_val, Session.FULL_DAY}

    same_day = (
        db.query(DutyAssignment)
        .filter(
            DutyAssignment.config_id == config_id,
            DutyAssignment.date == target_date,
            DutyAssignment.staff_id == to_staff.id,
        )
        .all()
    )
    for d in same_day:
        if old_assignment_id is not None and d.id == old_assignment_id:
            continue  # this row will be removed by the caller
        if d.session in blocked_sessions:
            violations.append(
                f"{to_staff.name} is already assigned {d.duty_type.value} ({d.session.value}) on {target_date}"
            )
            break

    # 4. Eligibility flags on Staff for the duty type
    is_clinic_like = duty_type == "Clinic"
    is_ot_like = duty_type in ("OT", "EOT", "EOT MO", "Ward MO")
    if is_clinic_like and to_staff.can_do_clinic is False:
        violations.append(f"{to_staff.name} is not eligible for clinic duties")
    if is_ot_like and to_staff.can_do_ot is False:
        violations.append(f"{to_staff.name} is not eligible for OT/EOT duties")

    # 5. Duty-eligible rank (for non-Admin assignments)
    if duty_type != "Admin":
        eligible_ranks = _get_duty_eligible_ranks(db)
        if eligible_ranks and to_staff.rank not in eligible_ranks:
            violations.append(
                f"{to_staff.name} ({to_staff.rank}) is not a duty-eligible rank"
            )

    # 6. Per-resource rank eligibility (e.g. SR/SSR not eligible for MOPD).
    if location and duty_type not in ("Admin", "Ward MO", "EOT MO"):
        sess_v = session_val.value if hasattr(session_val, "value") else session_val
        # Match by (room, session) — consultant_id may not be on the request.
        tpls = (
            db.query(ResourceTemplate)
            .filter(
                ResourceTemplate.is_active.is_(True),
                ResourceTemplate.room == location,
                ResourceTemplate.session == sess_v,
            )
            .all()
        )
        if tpls:
            rank_name_by_id = {r.id: r.name for r in db.query(RankConfig).all()}
            allowed: set[str] = set()
            any_restricted = False
            for tpl in tpls:
                ranks = _resolve_eligible_ranks(tpl.eligible_rank_ids, rank_name_by_id)
                if ranks:
                    any_restricted = True
                    allowed |= ranks
            if any_restricted and to_staff.rank not in allowed:
                violations.append(
                    f"{to_staff.name} ({to_staff.rank}) is not eligible for {location}"
                )

    return violations


@router.post("/roster/{config_id}/duty-swap", response_model=DutySwapResponse)
def duty_swap(
    config_id: int, payload: DutySwapRequest, db: DBSession = Depends(get_db)
):
    """Validate then apply a duty-roster drag-and-drop change.

    On constraint violations, returns `{ok: false, violations: [...]}` WITHOUT
    applying. Caller may re-submit with `force=true` to override.
    """
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404, "Config not found")
    to_staff = db.query(Staff).get(payload.to_staff_id)
    if not to_staff:
        raise HTTPException(404, "Target staff not found")

    from ..models import DutyType as DutyTypeEnum

    try:
        duty_type_val = DutyTypeEnum(payload.duty_type)
    except ValueError:
        raise HTTPException(400, f"Invalid duty_type: {payload.duty_type}")

    # If duplicating, the old row stays; pass old_assignment_id=None to validator.
    old_id_for_validation = None if payload.duplicate else payload.old_assignment_id

    violations = _validate_duty_swap(
        config_id,
        payload.date,
        payload.duty_type,
        payload.session,
        payload.location,
        to_staff,
        old_id_for_validation,
        payload.duplicate,
        db,
    )

    if violations and not payload.force:
        return DutySwapResponse(ok=False, violations=violations, assignment=None)

    # Apply (mirror create_duty_override)
    if not payload.duplicate and payload.old_assignment_id is not None:
        old = db.query(DutyAssignment).get(payload.old_assignment_id)
        if old and old.config_id == config_id:
            db.delete(old)

    cons_names = {s.id: s.name for s in db.query(Staff).all()}
    new_da = DutyAssignment(
        config_id=config_id,
        date=payload.date,
        staff_id=payload.to_staff_id,
        session=payload.session,
        duty_type=duty_type_val,
        location=payload.location,
        consultant_id=payload.consultant_id,
        is_manual_override=True,
        clinic_type=payload.clinic_type,
    )
    db.add(new_da)
    db.commit()
    db.refresh(new_da)

    return DutySwapResponse(
        ok=True,
        violations=violations,  # may be non-empty on force
        assignment=DutyAssignmentOut(
            id=new_da.id,
            date=new_da.date,
            staff_id=new_da.staff_id,
            staff_name=to_staff.name,
            session=new_da.session,
            duty_type=new_da.duty_type,
            location=new_da.location,
            consultant_id=new_da.consultant_id,
            consultant_name=cons_names.get(new_da.consultant_id) if new_da.consultant_id else None,
            clinic_type=new_da.clinic_type,
            is_manual_override=True,
        ),
    )
