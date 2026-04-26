from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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


def _staff_out(s: Staff, team_name=None, supervisor_name=None) -> StaffOut:
    return StaffOut(
        id=s.id,
        name=s.name,
        rank=s.rank,
        active=s.active,
        has_admin_role=s.has_admin_role or False,
        extra_call_type_ids=s.extra_call_type_ids,
        duty_preference=s.duty_preference,
        can_do_call=s.can_do_call if s.can_do_call is not None else True,
        can_do_clinic=s.can_do_clinic if s.can_do_clinic is not None else True,
        can_do_ot=s.can_do_ot if s.can_do_ot is not None else True,
        team_name=team_name,
        supervisor_name=supervisor_name,
    )


@router.get("", response_model=list[StaffOut])
async def list_staff(active_only: bool = True, db: AsyncSession = Depends(get_db)):
    q = select(Staff).order_by(Staff.name)
    if active_only:
        q = q.filter(Staff.active.is_(True))
    staff = (await db.execute(q)).scalars().all()
    staff_ids = [s.id for s in staff]

    # Batch-load the most-recent team assignment per staff member.
    all_assignments = (
        (
            await db.execute(
                select(TeamAssignment)
                .filter(TeamAssignment.staff_id.in_(staff_ids))
                .order_by(TeamAssignment.staff_id, TeamAssignment.effective_from.desc())
            )
        )
        .scalars()
        .all()
    )
    # Keep only the latest assignment per staff member.
    latest_assignment: dict[int, TeamAssignment] = {}
    for ta in all_assignments:
        if ta.staff_id not in latest_assignment:
            latest_assignment[ta.staff_id] = ta

    # Batch-load all referenced teams and supervisors in two queries.
    team_ids = {ta.team_id for ta in latest_assignment.values()}
    supervisor_ids = {
        ta.supervisor_id for ta in latest_assignment.values() if ta.supervisor_id
    }

    teams_by_id: dict[int, Team] = {}
    if team_ids:
        teams_by_id = {
            t.id: t
            for t in (await db.execute(select(Team).filter(Team.id.in_(team_ids))))
            .scalars()
            .all()
        }

    supervisors_by_id: dict[int, Staff] = {}
    if supervisor_ids:
        supervisors_by_id = {
            s.id: s
            for s in (
                await db.execute(select(Staff).filter(Staff.id.in_(supervisor_ids)))
            )
            .scalars()
            .all()
        }

    result = []
    for s in staff:
        ta = latest_assignment.get(s.id)
        team_name = (
            teams_by_id[ta.team_id].name if ta and ta.team_id in teams_by_id else None
        )
        supervisor_name = (
            supervisors_by_id[ta.supervisor_id].name
            if ta and ta.supervisor_id and ta.supervisor_id in supervisors_by_id
            else None
        )
        result.append(_staff_out(s, team_name, supervisor_name))
    return result


@router.post("", response_model=StaffOut)
async def create_staff(payload: StaffCreate, db: AsyncSession = Depends(get_db)):
    s = Staff(**payload.model_dump())
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return _staff_out(s)


@router.put("/{staff_id}", response_model=StaffOut)
async def update_staff(
    staff_id: int, payload: StaffCreate, db: AsyncSession = Depends(get_db)
):
    s = await db.get(Staff, staff_id)
    if not s:
        raise HTTPException(404, "Staff not found")
    for k, v in payload.model_dump().items():
        setattr(s, k, v)
    await db.commit()
    await db.refresh(s)
    return _staff_out(s)


@router.delete("/{staff_id}")
async def delete_staff(staff_id: int, db: AsyncSession = Depends(get_db)):
    s = await db.get(Staff, staff_id)
    if not s:
        raise HTTPException(404, "Staff not found")
    from ..models import (
        ConsultantOnCall,
        ACOnCall,
        RegistrarDuty,
        DutyAssignment,
        ResourceTemplate,
    )

    await db.execute(
        delete(ConsultantOnCall).where(ConsultantOnCall.consultant_id == staff_id)
    )
    await db.execute(delete(ACOnCall).where(ACOnCall.ac_id == staff_id))
    await db.execute(
        delete(RegistrarDuty).where(RegistrarDuty.registrar_id == staff_id)
    )
    await db.execute(delete(DutyAssignment).where(DutyAssignment.staff_id == staff_id))
    await db.execute(
        delete(DutyAssignment).where(DutyAssignment.consultant_id == staff_id)
    )
    await db.execute(
        delete(ResourceTemplate).where(ResourceTemplate.consultant_id == staff_id)
    )
    await db.execute(
        update(TeamAssignment)
        .where(TeamAssignment.supervisor_id == staff_id)
        .values(supervisor_id=None)
    )
    await db.delete(s)
    await db.commit()
    return {"ok": True}


# â”€â”€ Leave â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@router.get("/{staff_id}/leave", response_model=list[LeaveOut])
async def list_leave(staff_id: int, db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(Leave)
                .filter(Leave.staff_id == staff_id)
                .options(selectinload(Leave.staff))
                .order_by(Leave.date)
            )
        )
        .scalars()
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


@router.post("/leave", response_model=LeaveOut)
async def create_leave(payload: LeaveCreate, db: AsyncSession = Depends(get_db)):
    s = await db.get(Staff, payload.staff_id)
    if not s:
        raise HTTPException(404, "Staff not found")
    existing = (
        await db.execute(
            select(Leave).filter(
                Leave.staff_id == payload.staff_id, Leave.date == payload.date
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            409, "Leave record already exists for this staff member on this date"
        )
    lv = Leave(**payload.model_dump())
    db.add(lv)
    await db.commit()
    await db.refresh(lv)
    return LeaveOut(
        id=lv.id,
        staff_id=lv.staff_id,
        staff_name=s.name,
        date=lv.date,
        leave_type=lv.leave_type,
    )


@router.delete("/leave/{leave_id}")
async def delete_leave(leave_id: int, db: AsyncSession = Depends(get_db)):
    lv = await db.get(Leave, leave_id)
    if not lv:
        raise HTTPException(404, "Leave not found")
    await db.delete(lv)
    await db.commit()
    return {"ok": True}


# â”€â”€ Call Preferences â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@router.get("/{staff_id}/preferences", response_model=list[CallPreferenceOut])
async def list_preferences(staff_id: int, db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(CallPreference)
                .filter(CallPreference.staff_id == staff_id)
                .options(selectinload(CallPreference.staff))
                .order_by(CallPreference.date)
            )
        )
        .scalars()
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
async def create_preference(
    payload: CallPreferenceCreate, db: AsyncSession = Depends(get_db)
):
    s = await db.get(Staff, payload.staff_id)
    if not s:
        raise HTTPException(404, "Staff not found")
    cp = CallPreference(**payload.model_dump())
    db.add(cp)
    await db.commit()
    await db.refresh(cp)
    return CallPreferenceOut(
        id=cp.id,
        staff_id=cp.staff_id,
        staff_name=s.name,
        date=cp.date,
        preference_type=cp.preference_type,
        reason=cp.reason,
    )


@router.delete("/preferences/{pref_id}")
async def delete_preference(pref_id: int, db: AsyncSession = Depends(get_db)):
    cp = await db.get(CallPreference, pref_id)
    if not cp:
        raise HTTPException(404, "Preference not found")
    await db.delete(cp)
    await db.commit()
    return {"ok": True}


# â”€â”€ Bulk queries for a month â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@router.get("/leave/month/{year}/{month}", response_model=list[LeaveOut])
async def list_leaves_for_month(
    year: int, month: int, db: AsyncSession = Depends(get_db)
):
    from datetime import date as d_type
    import calendar

    start = d_type(year, month, 1)
    end = d_type(year, month, calendar.monthrange(year, month)[1])
    rows = (
        (
            await db.execute(
                select(Leave)
                .filter(Leave.date >= start, Leave.date <= end)
                .options(selectinload(Leave.staff))
                .order_by(Leave.date)
            )
        )
        .scalars()
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
async def list_preferences_for_month(
    year: int, month: int, db: AsyncSession = Depends(get_db)
):
    from datetime import date as d_type
    import calendar

    start = d_type(year, month, 1)
    end = d_type(year, month, calendar.monthrange(year, month)[1])
    rows = (
        (
            await db.execute(
                select(CallPreference)
                .filter(CallPreference.date >= start, CallPreference.date <= end)
                .options(selectinload(CallPreference.staff))
                .order_by(CallPreference.date)
            )
        )
        .scalars()
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
