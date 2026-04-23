import calendar
from datetime import date, timedelta
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    MonthlyConfig, Staff, TeamAssignment, Leave, CallPreference, CallAssignment,
    PublicHoliday, MO_GRADES, PreferenceType,
    OTTemplate, ClinicTemplate, CallType, DUTY_GRADES,
)
from ..schemas import RosterResponse, DayRoster, CallAssignmentOut, ManualOverrideCreate
from ..services.solver import (
    SolverInput, DayConfig, PersonInfo, solve, compute_fairness_stats,
)
from ..services.exporter import export_original, export_clean

router = APIRouter(prefix="/api/roster", tags=["roster"])


def _build_solver_input(config: MonthlyConfig, db: Session) -> SolverInput:
    year, month = config.year, config.month
    num_days = calendar.monthrange(year, month)[1]

    ph_dates = {
        r.date
        for r in db.query(PublicHoliday).all()
        if r.date.year == year and r.date.month == month
    }

    stepdown = {r.date for r in config.stepdown_days}
    evening_ot = {r.date for r in config.evening_ot_dates}

    consultant_oncall_map: dict[date, int] = {}
    for r in config.consultant_oncalls:
        consultant_oncall_map[r.date] = r.consultant_id

    consultant_team_map: dict[int, int] = {}
    for ta in db.query(TeamAssignment).filter(TeamAssignment.role == "consultant").all():
        consultant_team_map[ta.staff_id] = ta.team_id

    ac_oncall_map: dict[date, int] = {}
    for r in config.ac_oncalls:
        ac_oncall_map[r.date] = r.ac_id

    days: list[DayConfig] = []
    for day_num in range(1, num_days + 1):
        d = date(year, month, day_num)
        is_wknd = d.weekday() >= 5
        is_ph = d in ph_dates
        cons_id = consultant_oncall_map.get(d)
        days.append(DayConfig(
            d=d,
            is_weekend=is_wknd,
            is_ph=is_ph,
            is_stepdown=d in stepdown,
            has_evening_ot=d in evening_ot,
            consultant_oncall_id=cons_id,
            consultant_oncall_team_id=consultant_team_map.get(cons_id) if cons_id else None,
            ac_oncall_id=ac_oncall_map.get(d),
        ))

    mo_staff = (
        db.query(Staff)
        .filter(Staff.active.is_(True), Staff.grade.in_([g.value for g in MO_GRADES]))
        .all()
    )

    mo_pool: list[PersonInfo] = []
    for s in mo_staff:
        ta = (
            db.query(TeamAssignment)
            .filter(
                TeamAssignment.staff_id == s.id,
                TeamAssignment.role == "mo",
                TeamAssignment.effective_from <= date(year, month, num_days),
            )
            .order_by(TeamAssignment.effective_from.desc())
            .first()
        )
        mo_pool.append(PersonInfo(
            id=s.id,
            name=s.name,
            grade=s.grade,
            team_id=ta.team_id if ta else None,
            supervisor_id=ta.supervisor_id if ta else None,
        ))

    leave_dates: dict[int, set[date]] = defaultdict(set)
    for lv in db.query(Leave).filter(
        Leave.date >= date(year, month, 1),
        Leave.date <= date(year, month, num_days),
    ).all():
        leave_dates[lv.staff_id].add(lv.date)

    block_dates: dict[int, set[date]] = defaultdict(set)
    request_dates: dict[int, set[date]] = defaultdict(set)
    for cp in db.query(CallPreference).filter(
        CallPreference.date >= date(year, month, 1),
        CallPreference.date <= date(year, month, num_days),
    ).all():
        if cp.preference_type == PreferenceType.BLOCK:
            block_dates[cp.staff_id].add(cp.date)
        else:
            request_dates[cp.staff_id].add(cp.date)

    prior_assignments: dict[date, dict[int, CallType]] = {}
    prev_month = month - 1
    prev_year = year
    if prev_month == 0:
        prev_month = 12
        prev_year = year - 1
    prev_config = (
        db.query(MonthlyConfig)
        .filter(MonthlyConfig.year == prev_year, MonthlyConfig.month == prev_month)
        .first()
    )
    if prev_config:
        prev_num_days = calendar.monthrange(prev_year, prev_month)[1]
        lookback_start = date(prev_year, prev_month, max(1, prev_num_days - 6))
        prev_calls = (
            db.query(CallAssignment)
            .filter(
                CallAssignment.config_id == prev_config.id,
                CallAssignment.date >= lookback_start,
            )
            .all()
        )
        for c in prev_calls:
            if c.date not in prior_assignments:
                prior_assignments[c.date] = {}
            prior_assignments[c.date][c.staff_id] = c.call_type

    return SolverInput(
        year=year,
        month=month,
        days=days,
        mo_pool=mo_pool,
        leave_dates=dict(leave_dates),
        block_dates=dict(block_dates),
        request_dates=dict(request_dates),
        prior_assignments=prior_assignments,
    )


@router.post("/{config_id}/generate", response_model=RosterResponse)
def generate_roster(config_id: int, db: Session = Depends(get_db)):
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404, "Config not found")

    inp = _build_solver_input(config, db)
    assignments, violations = solve(inp)

    db.query(CallAssignment).filter(
        CallAssignment.config_id == config_id,
        CallAssignment.is_manual_override.is_(False),
    ).delete()

    pid_to_name = {p.id: p.name for p in inp.mo_pool}

    for d in sorted(assignments.keys()):
        for pid, ctype in assignments[d].items():
            if pid == -1:
                continue
            db.add(CallAssignment(
                config_id=config_id,
                date=d,
                staff_id=pid,
                call_type=ctype,
                is_manual_override=False,
            ))
    db.commit()

    ph_dates = {
        r.date
        for r in db.query(PublicHoliday).all()
        if r.date.year == config.year and r.date.month == config.month
    }

    all_staff_names = {s.id: s.name for s in db.query(Staff).all()}
    cons_oncall_rows = {r.date: r for r in config.consultant_oncalls}

    stepdown_dates = {r.date for r in config.stepdown_days}

    day_rosters: list[DayRoster] = []
    for day_cfg in inp.days:
        d = day_cfg.d
        day_map = assignments.get(d, {})

        inv_map: dict[str, str | None] = {}
        for pid, ctype in day_map.items():
            if pid != -1:
                inv_map[ctype.value] = pid_to_name.get(pid, f"ID:{pid}")

        cons_id = day_cfg.consultant_oncall_id
        ac_id = day_cfg.ac_oncall_id

        cons_row = cons_oncall_rows.get(d)
        if cons_row and cons_row.supervising_consultant_id:
            cons_display = f"{all_staff_names.get(cons_id, '')} / {all_staff_names.get(cons_row.supervising_consultant_id, '')}"
            ac_display = None
        else:
            cons_display = all_staff_names.get(cons_id) if cons_id else None
            ac_display = all_staff_names.get(ac_id) if ac_id else None

        day_rosters.append(DayRoster(
            date=d,
            day_name=d.strftime("%a"),
            is_weekend=day_cfg.is_weekend,
            is_ph=d in ph_dates,
            is_stepdown=day_cfg.is_stepdown,
            consultant_oncall=cons_display,
            ac_oncall=ac_display,
            mo1=inv_map.get("MO1"),
            mo2=inv_map.get("MO2"),
            mo3=inv_map.get("MO3"),
            mo4=inv_map.get("MO4"),
            mo5=inv_map.get("MO5"),
        ))

    fairness = compute_fairness_stats(assignments, inp.mo_pool, stepdown_dates)

    return RosterResponse(
        year=config.year,
        month=config.month,
        days=day_rosters,
        violations=violations,
        fairness=fairness,
    )


@router.get("/{config_id}/view", response_model=RosterResponse)
def view_roster(config_id: int, db: Session = Depends(get_db)):
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404, "Config not found")

    call_rows = (
        db.query(CallAssignment)
        .filter(CallAssignment.config_id == config_id)
        .all()
    )
    if not call_rows:
        raise HTTPException(404, "No roster generated yet")

    year, month = config.year, config.month
    num_days = calendar.monthrange(year, month)[1]

    all_staff_names = {s.id: s.name for s in db.query(Staff).all()}
    ph_dates = {
        r.date for r in db.query(PublicHoliday).all()
        if r.date.year == year and r.date.month == month
    }
    cons_oncall_rows = {r.date: r for r in config.consultant_oncalls}
    stepdown_dates = {r.date for r in config.stepdown_days}

    consultant_oncall_map: dict[date, int] = {}
    for r in config.consultant_oncalls:
        consultant_oncall_map[r.date] = r.consultant_id
    ac_oncall_map: dict[date, int] = {}
    for r in config.ac_oncalls:
        ac_oncall_map[r.date] = r.ac_id

    assignments_by_date: dict[date, dict[str, str]] = defaultdict(dict)
    for r in call_rows:
        assignments_by_date[r.date][r.call_type.value] = all_staff_names.get(r.staff_id, f"ID:{r.staff_id}")

    day_rosters: list[DayRoster] = []
    for day_num in range(1, num_days + 1):
        d = date(year, month, day_num)
        is_wknd = d.weekday() >= 5
        is_ph = d in ph_dates

        inv_map = assignments_by_date.get(d, {})
        cons_id = consultant_oncall_map.get(d)
        ac_id = ac_oncall_map.get(d)

        cons_row = cons_oncall_rows.get(d)
        if cons_row and cons_row.supervising_consultant_id:
            cons_display = f"{all_staff_names.get(cons_id, '')} / {all_staff_names.get(cons_row.supervising_consultant_id, '')}"
            ac_display = None
        else:
            cons_display = all_staff_names.get(cons_id) if cons_id else None
            ac_display = all_staff_names.get(ac_id) if ac_id else None

        day_rosters.append(DayRoster(
            date=d,
            day_name=d.strftime("%a"),
            is_weekend=is_wknd,
            is_ph=is_ph,
            is_stepdown=d in stepdown_dates,
            consultant_oncall=cons_display,
            ac_oncall=ac_display,
            mo1=inv_map.get("MO1"),
            mo2=inv_map.get("MO2"),
            mo3=inv_map.get("MO3"),
            mo4=inv_map.get("MO4"),
            mo5=inv_map.get("MO5"),
        ))

    mo_pool_staff = (
        db.query(Staff)
        .filter(Staff.active.is_(True), Staff.grade.in_([g.value for g in MO_GRADES]))
        .all()
    )
    from ..services.solver import PersonInfo as SolverPersonInfo
    mo_pool_persons = [SolverPersonInfo(id=s.id, name=s.name, grade=s.grade) for s in mo_pool_staff]

    call_map: dict[date, dict[int, CallType]] = defaultdict(dict)
    for r in call_rows:
        call_map[r.date][r.staff_id] = r.call_type

    fairness = compute_fairness_stats(dict(call_map), mo_pool_persons, stepdown_dates)

    return RosterResponse(
        year=year, month=month, days=day_rosters,
        violations=[], fairness=fairness,
    )


@router.get("/{config_id}/export")
def export_roster(
    config_id: int,
    format: str = Query("original", pattern="^(original|clean)$"),
    db: Session = Depends(get_db),
):
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404, "Config not found")

    month_name = calendar.month_name[config.month]
    if format == "clean":
        buf = export_clean(config, db)
        filename = f"Roster_Clean_{month_name}_{config.year}.xlsx"
    else:
        buf = export_original(config, db)
        filename = f"Roster_Original_{month_name}_{config.year}.xlsx"

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{config_id}/resources")
def get_resources(config_id: int, db: Session = Depends(get_db)):
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404, "Config not found")

    year, month = config.year, config.month
    num_days = calendar.monthrange(year, month)[1]

    ot_templates = db.query(OTTemplate).all()
    clinic_templates = db.query(ClinicTemplate).all()

    ph_dates = {
        r.date for r in db.query(PublicHoliday).all()
        if r.date.year == year and r.date.month == month
    }
    stepdown = {r.date for r in config.stepdown_days}
    evening_ot = {r.date for r in config.evening_ot_dates}

    duty_staff = (
        db.query(Staff)
        .filter(Staff.active.is_(True), Staff.grade.in_([g.value for g in DUTY_GRADES]))
        .all()
    )
    total_mos = len(duty_staff)
    duty_staff_ids = {s.id for s in duty_staff}

    leave_counts: dict[str, int] = defaultdict(int)
    for lv in db.query(Leave).filter(
        Leave.date >= date(year, month, 1),
        Leave.date <= date(year, month, num_days),
    ).all():
        if lv.staff_id in duty_staff_ids:
            leave_counts[lv.date.isoformat()] += 1

    call_assignments = (
        db.query(CallAssignment)
        .filter(CallAssignment.config_id == config_id)
        .all()
    )
    oncall_counts: dict[str, int] = defaultdict(int)
    postcall_dates: set[str] = set()
    for ca in call_assignments:
        oncall_counts[ca.date.isoformat()] += 1
        if ca.call_type in {CallType.MO1, CallType.MO2}:
            next_day = ca.date + timedelta(days=1)
            postcall_dates.add(next_day.isoformat())
        if ca.call_type == CallType.MO3 and ca.date in stepdown:
            next_day = ca.date + timedelta(days=1)
            postcall_dates.add(next_day.isoformat())

    days = []
    for day_num in range(1, num_days + 1):
        d = date(year, month, day_num)
        ds = d.isoformat()
        dow = d.weekday()
        is_wknd = dow >= 5
        is_ph = d in ph_dates

        ot_rooms = 0
        ot_assistants = 0
        clinic_sup = 0
        clinic_mopd = 0
        if not is_wknd and not is_ph:
            for ot in ot_templates:
                if ot.day_of_week == dow:
                    ot_rooms += 1
                    ot_assistants += ot.assistants_needed
            for cl in clinic_templates:
                if cl.day_of_week == dow:
                    ct = cl.clinic_type or "Sup"
                    if ct == "MOPD":
                        clinic_mopd += 1
                    elif (cl.mos_required or 0) > 0:
                        clinic_sup += 1

        call_slots = 2
        if not is_wknd and not is_ph:
            call_slots = 3
            if d in evening_ot:
                call_slots = 5
        elif d in stepdown:
            call_slots = 3

        on_leave = leave_counts.get(ds, 0)
        on_call = oncall_counts.get(ds, 0)
        post_call = 1 if ds in postcall_dates else 0
        available = total_mos - on_leave - on_call - post_call
        needed = ot_assistants + clinic_sup + 3 if not is_wknd and not is_ph else 0
        surplus = available - needed if not is_wknd and not is_ph else available

        days.append({
            "date": ds,
            "day_name": d.strftime("%a"),
            "is_weekend": is_wknd,
            "is_ph": is_ph,
            "ot_rooms": ot_rooms,
            "ot_assistants_needed": ot_assistants,
            "supervised_clinics": clinic_sup,
            "mopd_clinics": clinic_mopd,
            "call_slots": call_slots,
            "total_mos": total_mos,
            "on_leave": on_leave,
            "on_call": on_call,
            "post_call": post_call,
            "available": max(available, 0),
            "needed_for_duties": needed,
            "surplus": surplus,
        })

    return {"year": year, "month": month, "days": days}


@router.put("/{config_id}/override", response_model=CallAssignmentOut)
def set_override(config_id: int, payload: ManualOverrideCreate, db: Session = Depends(get_db)):
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404, "Config not found")
    staff = db.query(Staff).get(payload.staff_id)
    if not staff:
        raise HTTPException(404, "Staff not found")

    existing = (
        db.query(CallAssignment)
        .filter(
            CallAssignment.config_id == config_id,
            CallAssignment.date == payload.date,
            CallAssignment.call_type == payload.call_type,
        )
        .first()
    )
    if existing:
        existing.staff_id = payload.staff_id
        existing.is_manual_override = True
    else:
        existing = CallAssignment(
            config_id=config_id,
            date=payload.date,
            staff_id=payload.staff_id,
            call_type=payload.call_type,
            is_manual_override=True,
        )
        db.add(existing)
    db.commit()
    db.refresh(existing)
    return CallAssignmentOut(
        id=existing.id,
        date=existing.date,
        staff_id=existing.staff_id,
        staff_name=staff.name,
        call_type=existing.call_type,
        is_manual_override=True,
    )


@router.delete("/{config_id}/override")
def remove_override(
    config_id: int,
    date_str: str = Query(..., alias="date"),
    call_type: str = Query(...),
    db: Session = Depends(get_db),
):
    from datetime import datetime as dt
    d = dt.strptime(date_str, "%Y-%m-%d").date()
    existing = (
        db.query(CallAssignment)
        .filter(
            CallAssignment.config_id == config_id,
            CallAssignment.date == d,
            CallAssignment.call_type == call_type,
        )
        .first()
    )
    if not existing:
        raise HTTPException(404, "Assignment not found")
    db.delete(existing)
    db.commit()
    return {"ok": True}


@router.get("/{config_id}/assignments", response_model=list[CallAssignmentOut])
def get_assignments(config_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(CallAssignment)
        .filter(CallAssignment.config_id == config_id)
        .order_by(CallAssignment.date, CallAssignment.call_type)
        .all()
    )
    return [
        CallAssignmentOut(
            id=r.id, date=r.date, staff_id=r.staff_id,
            staff_name=r.staff.name, call_type=r.call_type,
            is_manual_override=r.is_manual_override,
        )
        for r in rows
    ]
