import calendar
from datetime import date, timedelta
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    MonthlyConfig, ConsultantOnCall, ACOnCall, StepdownDay, EveningOTDate,
    Staff, TeamAssignment, Team, Leave, CallPreference, CallAssignment,
    PublicHoliday, MO_GRADES, PreferenceType, Grade,
)
from ..schemas import RosterResponse, DayRoster, CallAssignmentOut
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

    return SolverInput(
        year=year,
        month=month,
        days=days,
        mo_pool=mo_pool,
        leave_dates=dict(leave_dates),
        block_dates=dict(block_dates),
        request_dates=dict(request_dates),
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

    consultant_names = {s.id: s.name for s in db.query(Staff).filter(
        Staff.grade.in_([Grade.CONSULTANT.value, Grade.SENIOR_CONSULTANT.value])
    ).all()}
    ac_names = {s.id: s.name for s in db.query(Staff).filter(
        Staff.grade == Grade.ASSOCIATE_CONSULTANT.value
    ).all()}

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

        day_rosters.append(DayRoster(
            date=d,
            day_name=d.strftime("%a"),
            is_weekend=day_cfg.is_weekend,
            is_ph=d in ph_dates,
            is_stepdown=day_cfg.is_stepdown,
            consultant_oncall=consultant_names.get(cons_id) if cons_id else None,
            ac_oncall=ac_names.get(ac_id) if ac_id else None,
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
