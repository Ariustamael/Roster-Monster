from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Staff, Leave, CallPreference, TeamAssignment, Team
from ..schemas import (
    StaffCreate,
    StaffOut,
    LeaveCreate,
    LeaveOut,
    CallPreferenceCreate,
    CallPreferenceOut,
)

router = APIRouter(prefix="/api/staff", tags=["staff"])


@router.get("", response_model=list[StaffOut])
def list_staff(active_only: bool = True, db: Session = Depends(get_db)):
    q = db.query(Staff)
    if active_only:
        q = q.filter(Staff.active.is_(True))
    staff = q.order_by(Staff.name).all()

    result = []
    for s in staff:
        team_name = None
        supervisor_name = None
        ta = (
            db.query(TeamAssignment)
            .filter(TeamAssignment.staff_id == s.id)
            .order_by(TeamAssignment.effective_from.desc())
            .first()
        )
        if ta:
            team = db.query(Team).get(ta.team_id)
            if team:
                team_name = team.name
            if ta.supervisor_id:
                sup = db.query(Staff).get(ta.supervisor_id)
                if sup:
                    supervisor_name = sup.name
        result.append(_staff_out(s, team_name, supervisor_name))
    return result


def _staff_out(s: Staff, team_name=None, supervisor_name=None) -> StaffOut:
    return StaffOut(
        id=s.id, name=s.name, rank=s.rank, active=s.active,
        has_admin_role=s.has_admin_role or False,
        extra_call_type_ids=s.extra_call_type_ids,
        duty_preference=s.duty_preference,
        can_do_call=s.can_do_call if s.can_do_call is not None else True,
        can_do_clinic=s.can_do_clinic if s.can_do_clinic is not None else True,
        can_do_ot=s.can_do_ot if s.can_do_ot is not None else True,
        team_name=team_name, supervisor_name=supervisor_name,
    )


@router.post("", response_model=StaffOut)
def create_staff(payload: StaffCreate, db: Session = Depends(get_db)):
    s = Staff(**payload.model_dump())
    db.add(s)
    db.commit()
    db.refresh(s)
    return _staff_out(s)


@router.put("/{staff_id}", response_model=StaffOut)
def update_staff(staff_id: int, payload: StaffCreate, db: Session = Depends(get_db)):
    s = db.query(Staff).get(staff_id)
    if not s:
        raise HTTPException(404, "Staff not found")
    for k, v in payload.model_dump().items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return _staff_out(s)


@router.delete("/{staff_id}")
def delete_staff(staff_id: int, db: Session = Depends(get_db)):
    s = db.query(Staff).get(staff_id)
    if not s:
        raise HTTPException(404, "Staff not found")
    from ..models import (
        ConsultantOnCall,
        ACOnCall,
        RegistrarDuty,
        DutyAssignment,
        ResourceTemplate,
    )

    db.query(ConsultantOnCall).filter(
        ConsultantOnCall.consultant_id == staff_id
    ).delete()
    db.query(ACOnCall).filter(ACOnCall.ac_id == staff_id).delete()
    db.query(RegistrarDuty).filter(RegistrarDuty.registrar_id == staff_id).delete()
    db.query(DutyAssignment).filter(DutyAssignment.staff_id == staff_id).delete()
    db.query(DutyAssignment).filter(DutyAssignment.consultant_id == staff_id).delete()
    db.query(ResourceTemplate).filter(
        ResourceTemplate.consultant_id == staff_id
    ).delete()
    db.query(TeamAssignment).filter(TeamAssignment.supervisor_id == staff_id).update(
        {TeamAssignment.supervisor_id: None}
    )
    db.delete(s)
    db.commit()
    return {"ok": True}


# ── Leave ────────────────────────────────────────────────────────────────


@router.get("/{staff_id}/leave", response_model=list[LeaveOut])
def list_leave(staff_id: int, db: Session = Depends(get_db)):
    rows = db.query(Leave).filter(Leave.staff_id == staff_id).order_by(Leave.date).all()
    return [
        LeaveOut(
            id=r.id,
            staff_id=r.staff_id,
            staff_name=r.staff.name,
            date=r.date,
            leave_type=r.leave_type,
        )
        for r in rows
    ]


@router.post("/leave", response_model=LeaveOut)
def create_leave(payload: LeaveCreate, db: Session = Depends(get_db)):
    s = db.query(Staff).get(payload.staff_id)
    if not s:
        raise HTTPException(404, "Staff not found")
    lv = Leave(**payload.model_dump())
    db.add(lv)
    db.commit()
    db.refresh(lv)
    return LeaveOut(
        id=lv.id,
        staff_id=lv.staff_id,
        staff_name=s.name,
        date=lv.date,
        leave_type=lv.leave_type,
    )


@router.delete("/leave/{leave_id}")
def delete_leave(leave_id: int, db: Session = Depends(get_db)):
    lv = db.query(Leave).get(leave_id)
    if not lv:
        raise HTTPException(404, "Leave not found")
    db.delete(lv)
    db.commit()
    return {"ok": True}


# ── Call Preferences ─────────────────────────────────────────────────────


@router.get("/{staff_id}/preferences", response_model=list[CallPreferenceOut])
def list_preferences(staff_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(CallPreference)
        .filter(CallPreference.staff_id == staff_id)
        .order_by(CallPreference.date)
        .all()
    )
    return [
        CallPreferenceOut(
            id=r.id,
            staff_id=r.staff_id,
            staff_name=r.staff.name,
            date=r.date,
            preference_type=r.preference_type,
            reason=r.reason,
        )
        for r in rows
    ]


@router.post("/preferences", response_model=CallPreferenceOut)
def create_preference(payload: CallPreferenceCreate, db: Session = Depends(get_db)):
    s = db.query(Staff).get(payload.staff_id)
    if not s:
        raise HTTPException(404, "Staff not found")
    cp = CallPreference(**payload.model_dump())
    db.add(cp)
    db.commit()
    db.refresh(cp)
    return CallPreferenceOut(
        id=cp.id,
        staff_id=cp.staff_id,
        staff_name=s.name,
        date=cp.date,
        preference_type=cp.preference_type,
        reason=cp.reason,
    )


@router.delete("/preferences/{pref_id}")
def delete_preference(pref_id: int, db: Session = Depends(get_db)):
    cp = db.query(CallPreference).get(pref_id)
    if not cp:
        raise HTTPException(404, "Preference not found")
    db.delete(cp)
    db.commit()
    return {"ok": True}


# ── Bulk queries for a month ────────────────────────────────────────────


@router.get("/leave/month/{year}/{month}", response_model=list[LeaveOut])
def list_leaves_for_month(year: int, month: int, db: Session = Depends(get_db)):
    from datetime import date as d_type
    import calendar

    start = d_type(year, month, 1)
    end = d_type(year, month, calendar.monthrange(year, month)[1])
    rows = (
        db.query(Leave)
        .filter(Leave.date >= start, Leave.date <= end)
        .order_by(Leave.date)
        .all()
    )
    return [
        LeaveOut(
            id=r.id,
            staff_id=r.staff_id,
            staff_name=r.staff.name,
            date=r.date,
            leave_type=r.leave_type,
        )
        for r in rows
    ]


@router.get("/preferences/month/{year}/{month}", response_model=list[CallPreferenceOut])
def list_preferences_for_month(year: int, month: int, db: Session = Depends(get_db)):
    from datetime import date as d_type
    import calendar

    start = d_type(year, month, 1)
    end = d_type(year, month, calendar.monthrange(year, month)[1])
    rows = (
        db.query(CallPreference)
        .filter(CallPreference.date >= start, CallPreference.date <= end)
        .order_by(CallPreference.date)
        .all()
    )
    return [
        CallPreferenceOut(
            id=r.id,
            staff_id=r.staff_id,
            staff_name=r.staff.name,
            date=r.date,
            preference_type=r.preference_type,
            reason=r.reason,
        )
        for r in rows
    ]
