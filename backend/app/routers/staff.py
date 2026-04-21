from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Staff, Leave, CallPreference, TeamAssignment, Team
from ..schemas import (
    StaffCreate, StaffOut,
    LeaveCreate, LeaveOut,
    CallPreferenceCreate, CallPreferenceOut,
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
        result.append(
            StaffOut(
                id=s.id,
                name=s.name,
                grade=s.grade,
                active=s.active,
                has_admin_role=s.has_admin_role,
                team_name=team_name,
            )
        )
    return result


@router.post("", response_model=StaffOut)
def create_staff(payload: StaffCreate, db: Session = Depends(get_db)):
    s = Staff(**payload.model_dump())
    db.add(s)
    db.commit()
    db.refresh(s)
    return StaffOut(
        id=s.id, name=s.name, grade=s.grade,
        active=s.active, has_admin_role=s.has_admin_role,
    )


@router.put("/{staff_id}", response_model=StaffOut)
def update_staff(staff_id: int, payload: StaffCreate, db: Session = Depends(get_db)):
    s = db.query(Staff).get(staff_id)
    if not s:
        raise HTTPException(404, "Staff not found")
    for k, v in payload.model_dump().items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return StaffOut(
        id=s.id, name=s.name, grade=s.grade,
        active=s.active, has_admin_role=s.has_admin_role,
    )


# ── Leave ────────────────────────────────────────────────────────────────

@router.get("/{staff_id}/leave", response_model=list[LeaveOut])
def list_leave(staff_id: int, db: Session = Depends(get_db)):
    rows = db.query(Leave).filter(Leave.staff_id == staff_id).order_by(Leave.date).all()
    return [
        LeaveOut(
            id=r.id, staff_id=r.staff_id, staff_name=r.staff.name,
            date=r.date, leave_type=r.leave_type,
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
        id=lv.id, staff_id=lv.staff_id, staff_name=s.name,
        date=lv.date, leave_type=lv.leave_type,
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
            id=r.id, staff_id=r.staff_id, staff_name=r.staff.name,
            date=r.date, preference_type=r.preference_type, reason=r.reason,
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
        id=cp.id, staff_id=cp.staff_id, staff_name=s.name,
        date=cp.date, preference_type=cp.preference_type, reason=cp.reason,
    )


@router.delete("/preferences/{pref_id}")
def delete_preference(pref_id: int, db: Session = Depends(get_db)):
    cp = db.query(CallPreference).get(pref_id)
    if not cp:
        raise HTTPException(404, "Preference not found")
    db.delete(cp)
    db.commit()
    return {"ok": True}
