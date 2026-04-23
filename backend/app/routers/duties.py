import calendar
from datetime import date, timedelta
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession

from ..database import get_db
from ..models import (
    MonthlyConfig, CallAssignment, DutyAssignment, Staff, TeamAssignment,
    OTTemplate, ClinicTemplate, Leave, PublicHoliday,
    ConsultantOnCall, ACOnCall,
    DutyType, Session, CallTypeConfig, RankConfig,
)
from ..schemas import (
    DutyRosterResponse, DayDutyRoster, DutyAssignmentOut,
    OTTemplateCreate, OTTemplateOut, ClinicTemplateCreate, ClinicTemplateOut,
    DutyOverrideCreate,
)
from ..services.duty_solver import (
    DutySolverInput, DayDutyConfig, OTSlot, ClinicSlot,
    PersonInfo, solve_duties, compute_duty_stats,
)
from ..services.validators import is_overnight, get_post_call_type

router = APIRouter(prefix="/api", tags=["duties"])


# ── OT Templates ────────────────────────────────────────────────────────

def _ot_out(r: OTTemplate) -> OTTemplateOut:
    return OTTemplateOut(
        id=r.id, day_of_week=r.day_of_week, room=r.room,
        consultant_id=r.consultant_id,
        consultant_name=r.consultant.name if r.consultant else None,
        assistants_needed=r.assistants_needed,
        registrar_needed=r.registrar_needed or 0,
        is_emergency=r.is_emergency or False,
        linked_call_slot=r.linked_call_slot,
        color=r.color,
        is_active=r.is_active if r.is_active is not None else True,
        week_of_month=r.week_of_month,
    )


@router.get("/templates/ot", response_model=list[OTTemplateOut])
def list_ot_templates(db: DBSession = Depends(get_db)):
    rows = db.query(OTTemplate).order_by(OTTemplate.day_of_week, OTTemplate.room).all()
    return [_ot_out(r) for r in rows]


@router.post("/templates/ot", response_model=OTTemplateOut)
def create_ot_template(payload: OTTemplateCreate, db: DBSession = Depends(get_db)):
    t = OTTemplate(**payload.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return _ot_out(t)


@router.put("/templates/ot/{template_id}", response_model=OTTemplateOut)
def update_ot_template(template_id: int, payload: OTTemplateCreate, db: DBSession = Depends(get_db)):
    t = db.query(OTTemplate).get(template_id)
    if not t:
        raise HTTPException(404)
    for k, v in payload.model_dump().items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return _ot_out(t)


@router.delete("/templates/ot/{template_id}")
def delete_ot_template(template_id: int, db: DBSession = Depends(get_db)):
    t = db.query(OTTemplate).get(template_id)
    if not t:
        raise HTTPException(404)
    db.delete(t)
    db.commit()
    return {"ok": True}


# ── Clinic Templates ────────────────────────────────────────────────────

@router.get("/templates/clinics", response_model=list[ClinicTemplateOut])
def list_clinic_templates(db: DBSession = Depends(get_db)):
    rows = db.query(ClinicTemplate).order_by(
        ClinicTemplate.day_of_week, ClinicTemplate.session, ClinicTemplate.room,
    ).all()
    return [
        ClinicTemplateOut(
            id=r.id, day_of_week=r.day_of_week, session=r.session,
            room=r.room, clinic_type=r.clinic_type, mos_required=r.mos_required,
            consultant_id=r.consultant_id,
            consultant_name=r.consultant.name if r.consultant else None,
            color=r.color,
            is_active=r.is_active if r.is_active is not None else True,
        )
        for r in rows
    ]


@router.post("/templates/clinics", response_model=ClinicTemplateOut)
def create_clinic_template(payload: ClinicTemplateCreate, db: DBSession = Depends(get_db)):
    t = ClinicTemplate(**payload.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return ClinicTemplateOut(
        id=t.id, day_of_week=t.day_of_week, session=t.session,
        room=t.room, clinic_type=t.clinic_type, mos_required=t.mos_required,
        consultant_id=t.consultant_id,
        consultant_name=t.consultant.name if t.consultant else None,
        color=t.color,
        is_active=t.is_active if t.is_active is not None else True,
    )


@router.put("/templates/clinics/{template_id}", response_model=ClinicTemplateOut)
def update_clinic_template(template_id: int, payload: ClinicTemplateCreate, db: DBSession = Depends(get_db)):
    t = db.query(ClinicTemplate).get(template_id)
    if not t:
        raise HTTPException(404)
    for k, v in payload.model_dump().items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return ClinicTemplateOut(
        id=t.id, day_of_week=t.day_of_week, session=t.session,
        room=t.room, clinic_type=t.clinic_type, mos_required=t.mos_required,
        consultant_id=t.consultant_id,
        consultant_name=t.consultant.name if t.consultant else None,
        color=t.color,
        is_active=t.is_active if t.is_active is not None else True,
    )


@router.delete("/templates/clinics/{template_id}")
def delete_clinic_template(template_id: int, db: DBSession = Depends(get_db)):
    t = db.query(ClinicTemplate).get(template_id)
    if not t:
        raise HTTPException(404)
    db.delete(t)
    db.commit()
    return {"ok": True}


# ── Helpers ─────────────────────────────────────────────────────────────

def _get_duty_eligible_ranks(db: DBSession) -> set[str]:
    ranks = db.query(RankConfig).filter(RankConfig.is_duty_eligible.is_(True)).all()
    return {r.name for r in ranks}


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
        r.date for r in db.query(PublicHoliday).all()
        if r.date.year == year and r.date.month == month
    }

    consultant_team: dict[int, int] = {}
    for ta in db.query(TeamAssignment).filter(TeamAssignment.role == "consultant").all():
        consultant_team[ta.staff_id] = ta.team_id

    ot_templates = db.query(OTTemplate).filter(OTTemplate.is_active.is_(True)).all()
    clinic_templates = db.query(ClinicTemplate).filter(ClinicTemplate.is_active.is_(True)).all()

    ot_by_dow_week: dict[tuple[int, int | None], list[OTTemplate]] = defaultdict(list)
    for t in ot_templates:
        ot_by_dow_week[(t.day_of_week, t.week_of_month)].append(t)

    clinic_by_dow_session: dict[tuple[int, str], list[ClinicTemplate]] = defaultdict(list)
    for t in clinic_templates:
        clinic_by_dow_session[(t.day_of_week, t.session.value)].append(t)

    call_rows = db.query(CallAssignment).filter(
        CallAssignment.config_id == config.id,
    ).all()

    call_assigned: dict[date, set[int]] = defaultdict(set)
    for r in call_rows:
        call_assigned[r.date].add(r.staff_id)

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
        if pct == "none" and not is_overnight(r.call_type, r.date, stepdown_dates, ct_config_dict):
            # Daytime call-only duties (like MO3 referral) — exclude from daytime pool
            cfg = ct_config_dict.get(r.call_type, {})
            if not cfg.get("is_overnight", False):
                call_assigned[r.date].add(r.staff_id)

    days: list[DayDutyConfig] = []
    for day_num in range(1, num_days + 1):
        d = date(year, month, day_num)
        dow = d.weekday()
        is_wknd = dow >= 5
        is_ph = d in ph_dates

        week_num = (d.day - 1) // 7 + 1

        day_ot_templates = []
        for t in ot_by_dow_week.get((dow, None), []):
            day_ot_templates.append(t)
        for t in ot_by_dow_week.get((dow, week_num), []):
            day_ot_templates.append(t)

        ot_slots = []
        for t in day_ot_templates:
            if t.is_emergency:
                ot_slots.append(OTSlot(
                    room=t.room,
                    consultant_id=t.consultant_id,
                    consultant_team_id=consultant_team.get(t.consultant_id) if t.consultant_id else None,
                    assistants_needed=t.assistants_needed,
                    registrar_needed=t.registrar_needed or 0,
                    is_emergency=True,
                    linked_call_slot=t.linked_call_slot,
                ))
            elif not is_wknd and not is_ph:
                ot_slots.append(OTSlot(
                    room=t.room,
                    consultant_id=t.consultant_id,
                    consultant_team_id=consultant_team.get(t.consultant_id) if t.consultant_id else None,
                    assistants_needed=t.assistants_needed,
                    registrar_needed=t.registrar_needed or 0,
                ))

        am_clinics = []
        pm_clinics = []
        if not is_wknd and not is_ph:
            for t in clinic_by_dow_session.get((dow, Session.AM.value), []):
                am_clinics.append(ClinicSlot(
                    room=t.room, session=Session.AM,
                    clinic_type=t.clinic_type or "Sup",
                    mos_required=t.mos_required if t.mos_required is not None else 1,
                    consultant_id=t.consultant_id,
                    consultant_team_id=consultant_team.get(t.consultant_id) if t.consultant_id else None,
                ))
            for t in clinic_by_dow_session.get((dow, Session.PM.value), []):
                pm_clinics.append(ClinicSlot(
                    room=t.room, session=Session.PM,
                    clinic_type=t.clinic_type or "Sup",
                    mos_required=t.mos_required if t.mos_required is not None else 1,
                    consultant_id=t.consultant_id,
                    consultant_team_id=consultant_team.get(t.consultant_id) if t.consultant_id else None,
                ))

        days.append(DayDutyConfig(
            d=d, is_weekend=is_wknd, is_ph=is_ph,
            ot_slots=ot_slots,
            am_clinics=am_clinics,
            pm_clinics=pm_clinics,
        ))

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
        mo_pool.append(PersonInfo(
            id=s.id, name=s.name, rank=s.rank,
            team_id=ta.team_id if ta else None,
            supervisor_id=ta.supervisor_id if ta else None,
        ))

    leave_dates: dict[int, set[date]] = defaultdict(set)
    for lv in db.query(Leave).filter(
        Leave.date >= date(year, month, 1),
        Leave.date <= date(year, month, num_days),
    ).all():
        leave_dates[lv.staff_id].add(lv.date)

    # Build call_by_type: {date: {call_type: staff_id}}
    call_by_type: dict[date, dict[str, int]] = defaultdict(dict)
    for r in call_rows:
        call_by_type[r.date][r.call_type] = r.staff_id

    # Build default_duty_by_call_type from CallTypeConfig.default_duty_type
    default_duty_by_call_type: dict[str, str] = {}
    for ct in db.query(CallTypeConfig).filter(CallTypeConfig.is_active.is_(True)).all():
        if ct.default_duty_type:
            default_duty_by_call_type[ct.name] = ct.default_duty_type

    return DutySolverInput(
        year=year, month=month, days=days,
        mo_pool=mo_pool, leave_dates=dict(leave_dates),
        call_assigned=dict(call_assigned),
        postcall_dates=dict(postcall_dates),
        postcall_12pm_dates=dict(postcall_12pm_dates),
        postcall_5pm_dates=dict(postcall_5pm_dates),
        call_only_dates=dict(call_only_dates),
        call_by_type=dict(call_by_type),
        default_duty_by_call_type=default_duty_by_call_type,
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
        r.date for r in db.query(PublicHoliday).all()
        if r.date.year == config.year and r.date.month == config.month
    }

    results_by_date: dict[date, list] = defaultdict(list)
    for r in duty_results:
        r_date = r.date if isinstance(r, DR) else r.date
        results_by_date[r_date].append(r)

    all_staff_names = {s.id: s.name for s in db.query(Staff).all()}

    call_rows = db.query(CallAssignment).filter(
        CallAssignment.config_id == config.id,
    ).all()
    call_by_date: dict[date, dict[str, str]] = defaultdict(dict)
    for r in call_rows:
        call_by_date[r.date][r.call_type] = all_staff_names.get(r.staff_id, f"ID:{r.staff_id}")

    cons_oncall_by_date: dict[date, str] = {}
    for r in db.query(ConsultantOnCall).filter(ConsultantOnCall.config_id == config.id).all():
        cons_oncall_by_date[r.date] = all_staff_names.get(r.consultant_id, f"ID:{r.consultant_id}")
    ac_oncall_by_date: dict[date, str] = {}
    for r in db.query(ACOnCall).filter(ACOnCall.config_id == config.id).all():
        ac_oncall_by_date[r.date] = all_staff_names.get(r.ac_id, f"ID:{r.ac_id}")

    clinic_type_lookup: dict[tuple[str, str], str] = {}
    for ct in db.query(ClinicTemplate).all():
        clinic_type_lookup[(ct.room, ct.session.value)] = ct.clinic_type or "Sup"

    ct_configs = db.query(CallTypeConfig).filter(CallTypeConfig.is_active.is_(True)).order_by(CallTypeConfig.display_order).all()
    ct_columns = [ct.name for ct in ct_configs]

    day_rosters: list[DayDutyRoster] = []
    num_days = calendar.monthrange(config.year, config.month)[1]
    for day_num in range(1, num_days + 1):
        d = date(config.year, config.month, day_num)
        is_wknd = d.weekday() >= 5
        is_ph = d in ph_dates

        pc_ids = postcall_dates.get(d, set())
        post_call_names = sorted([all_staff_names.get(pid, f"ID:{pid}") for pid in pc_ids])

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
            session_val = r.session.value if hasattr(r.session, 'value') else r.session
            loc = r.location or ""
            ct = clinic_type_lookup.get((loc, session_val), None)
            if r.duty_type in (DutyType.CLINIC, DutyType.CAT_A, DutyType.MOPD):
                ct = ct or (r.duty_type.value if hasattr(r.duty_type, 'value') else r.duty_type)

            out = DutyAssignmentOut(
                id=getattr(r, 'id', 0) or 0,
                date=r.date, staff_id=staff_id,
                staff_name=pid_to_name.get(staff_id, all_staff_names.get(staff_id, f"ID:{staff_id}")),
                session=r.session, duty_type=r.duty_type,
                location=r.location, consultant_id=r.consultant_id,
                consultant_name=cons_names.get(r.consultant_id) if r.consultant_id else None,
                clinic_type=ct,
                is_manual_override=getattr(r, 'is_manual_override', False),
            )
            if r.duty_type in (DutyType.EOT, DutyType.EOT_MO):
                eot_out.append(out)
            elif r.duty_type == DutyType.OT:
                ot_out.append(out)
            elif r.session == Session.AM:
                if r.duty_type == DutyType.ADMIN:
                    am_admin.append(out.staff_name)
                else:
                    am_clinics_out.append(out)
            elif r.session == Session.PM:
                if r.duty_type == DutyType.ADMIN:
                    pm_admin.append(out.staff_name)
                else:
                    pm_clinics_out.append(out)

        day_rosters.append(DayDutyRoster(
            date=d, day_name=d.strftime("%a"),
            is_weekend=is_wknd, is_ph=is_ph,
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
        ))

    return day_rosters, ct_columns


@router.post("/roster/{config_id}/generate-duties", response_model=DutyRosterResponse)
def generate_duties(config_id: int, db: DBSession = Depends(get_db)):
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404, "Config not found")

    existing_calls = db.query(CallAssignment).filter(
        CallAssignment.config_id == config_id,
    ).count()
    if existing_calls == 0:
        raise HTTPException(400, "Generate call roster first (POST /api/roster/{id}/generate)")

    inp = _build_duty_input(config, db)
    duty_results = solve_duties(inp)

    db.query(DutyAssignment).filter(
        DutyAssignment.config_id == config_id,
        DutyAssignment.is_manual_override.is_(False),
    ).delete()

    pid_to_name = {p.id: p.name for p in inp.mo_pool}
    cons_names = {s.id: s.name for s in db.query(Staff).all()}

    for r in duty_results:
        db.add(DutyAssignment(
            config_id=config_id,
            date=r.date,
            staff_id=r.staff_id,
            session=r.session,
            duty_type=r.duty_type,
            location=r.location,
            consultant_id=r.consultant_id,
            is_manual_override=False,
        ))
    db.commit()

    day_rosters, ct_columns = _build_day_rosters(config, db, duty_results, pid_to_name, cons_names, inp.postcall_dates)
    duty_stats = compute_duty_stats(duty_results, inp.mo_pool)

    return DutyRosterResponse(
        year=config.year, month=config.month,
        days=day_rosters, duty_stats=duty_stats,
        call_type_columns=ct_columns,
    )


# ── Duty Overrides (manual drag-and-drop) ───────────────────────────────

@router.post("/roster/{config_id}/duty-override", response_model=DutyAssignmentOut)
def create_duty_override(config_id: int, payload: DutyOverrideCreate, db: DBSession = Depends(get_db)):
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
        id=new_da.id, date=new_da.date, staff_id=new_da.staff_id,
        staff_name=staff.name, session=new_da.session,
        duty_type=new_da.duty_type, location=new_da.location,
        consultant_id=new_da.consultant_id,
        consultant_name=cons_names.get(new_da.consultant_id) if new_da.consultant_id else None,
        is_manual_override=True,
    )


@router.delete("/roster/{config_id}/duty-override/{assignment_id}")
def delete_duty_override(config_id: int, assignment_id: int, db: DBSession = Depends(get_db)):
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
            id=r.id, date=r.date, staff_id=r.staff_id,
            staff_name=r.staff.name, session=r.session,
            duty_type=r.duty_type, location=r.location,
            consultant_id=r.consultant_id,
            consultant_name=cons_names.get(r.consultant_id) if r.consultant_id else None,
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
    call_rows = db.query(CallAssignment).filter(CallAssignment.config_id == config_id).all()
    postcall_dates: dict[date, set[int]] = defaultdict(set)
    for r in call_rows:
        pct = get_post_call_type(r.call_type, ct_config_dict)
        if pct in ("8am", "12pm", "5pm"):
            next_day = r.date + timedelta(days=1)
            postcall_dates[next_day].add(r.staff_id)

    day_rosters, ct_columns = _build_day_rosters(config, db, rows, pid_to_name, cons_names, dict(postcall_dates))

    duty_eligible_ranks = _get_duty_eligible_ranks(db)
    duty_staff = (
        db.query(Staff)
        .filter(Staff.active.is_(True), Staff.rank.in_(list(duty_eligible_ranks)))
        .all()
    )
    mo_pool = [PersonInfo(id=s.id, name=s.name, rank=s.rank) for s in duty_staff]
    from ..services.duty_solver import DutyResult
    duty_results = [
        DutyResult(date=r.date, staff_id=r.staff_id, session=r.session,
                   duty_type=r.duty_type, location=r.location, consultant_id=r.consultant_id)
        for r in rows
    ]
    duty_stats = compute_duty_stats(duty_results, mo_pool)

    return DutyRosterResponse(
        year=config.year, month=config.month,
        days=day_rosters, duty_stats=duty_stats,
        call_type_columns=ct_columns,
    )
