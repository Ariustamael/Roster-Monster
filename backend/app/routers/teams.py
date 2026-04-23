from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Team, TeamAssignment, Staff
from ..schemas import TeamOut, TeamCreate, TeamAssignmentCreate, TeamAssignmentOut

router = APIRouter(prefix="/api/teams", tags=["teams"])


def _to_out(r: TeamAssignment) -> TeamAssignmentOut:
    return TeamAssignmentOut(
        id=r.id,
        staff_id=r.staff_id,
        staff_name=r.staff.name,
        team_id=r.team_id,
        team_name=r.team.name,
        role=r.role,
        supervisor_id=r.supervisor_id,
        supervisor_name=r.supervisor.name if r.supervisor else None,
        effective_from=r.effective_from,
        effective_to=r.effective_to,
    )


@router.get("", response_model=list[TeamOut])
def list_teams(db: Session = Depends(get_db)):
    return db.query(Team).order_by(Team.display_order, Team.id).all()


@router.post("", response_model=TeamOut)
def create_team(payload: TeamCreate, db: Session = Depends(get_db)):
    existing = db.query(Team).filter(Team.name == payload.name).first()
    if existing:
        raise HTTPException(409, "Team name already exists")
    max_order = db.query(Team).count()
    t = Team(name=payload.name, display_order=max_order)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.put("/{team_id}/rename", response_model=TeamOut)
def rename_team(team_id: int, payload: TeamCreate, db: Session = Depends(get_db)):
    t = db.query(Team).get(team_id)
    if not t:
        raise HTTPException(404, "Team not found")
    dup = db.query(Team).filter(Team.name == payload.name, Team.id != team_id).first()
    if dup:
        raise HTTPException(409, "Team name already exists")
    t.name = payload.name
    db.commit()
    db.refresh(t)
    return t


@router.put("/reorder")
def reorder_teams(order: list[int], db: Session = Depends(get_db)):
    for idx, team_id in enumerate(order):
        t = db.query(Team).get(team_id)
        if t:
            t.display_order = idx
    db.commit()
    return {"ok": True}


@router.delete("/{team_id}")
def delete_team(team_id: int, db: Session = Depends(get_db)):
    t = db.query(Team).get(team_id)
    if not t:
        raise HTTPException(404, "Team not found")
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.get("/{team_id}/members", response_model=list[TeamAssignmentOut])
def list_team_members(team_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(TeamAssignment)
        .filter(TeamAssignment.team_id == team_id)
        .order_by(TeamAssignment.effective_from.desc())
        .all()
    )
    return [_to_out(r) for r in rows]


@router.get("/all-assignments", response_model=list[TeamAssignmentOut])
def list_all_assignments(db: Session = Depends(get_db)):
    rows = (
        db.query(TeamAssignment)
        .order_by(TeamAssignment.team_id, TeamAssignment.role, TeamAssignment.staff_id)
        .all()
    )
    return [_to_out(r) for r in rows]


@router.post("/assignments", response_model=TeamAssignmentOut)
def create_assignment(payload: TeamAssignmentCreate, db: Session = Depends(get_db)):
    staff = db.query(Staff).get(payload.staff_id)
    if not staff:
        raise HTTPException(404, "Staff not found")
    team = db.query(Team).get(payload.team_id)
    if not team:
        raise HTTPException(404, "Team not found")

    ta = TeamAssignment(**payload.model_dump())
    db.add(ta)
    db.commit()
    db.refresh(ta)
    return _to_out(ta)


@router.put("/reassign/{staff_id}/{team_id}")
def reassign_staff(
    staff_id: int,
    team_id: int,
    supervisor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    staff = db.query(Staff).get(staff_id)
    if not staff:
        raise HTTPException(404, "Staff not found")
    team = db.query(Team).get(team_id)
    if not team:
        raise HTTPException(404, "Team not found")

    role = "mo"
    cons_grades = {"Senior Consultant", "Consultant", "Associate Consultant"}
    if staff.grade.value in cons_grades:
        role = "consultant"

    db.query(TeamAssignment).filter(
        TeamAssignment.staff_id == staff_id,
    ).delete()

    ta = TeamAssignment(
        staff_id=staff_id,
        team_id=team_id,
        role=role,
        supervisor_id=supervisor_id if role == "mo" else None,
        effective_from=date_type.today(),
    )
    db.add(ta)
    db.commit()
    db.refresh(ta)
    return _to_out(ta)


@router.put("/set-supervisor/{staff_id}/{supervisor_id}")
def set_supervisor(staff_id: int, supervisor_id: int, db: Session = Depends(get_db)):
    ta = (
        db.query(TeamAssignment)
        .filter(TeamAssignment.staff_id == staff_id, TeamAssignment.role == "mo")
        .first()
    )
    if not ta:
        raise HTTPException(404, "MO team assignment not found")
    sup = db.query(Staff).get(supervisor_id)
    if not sup:
        raise HTTPException(404, "Supervisor not found")
    ta.supervisor_id = supervisor_id
    db.commit()
    db.refresh(ta)
    return _to_out(ta)


@router.delete("/assignments/{assignment_id}")
def delete_assignment(assignment_id: int, db: Session = Depends(get_db)):
    ta = db.query(TeamAssignment).get(assignment_id)
    if not ta:
        raise HTTPException(404, "Assignment not found")
    db.delete(ta)
    db.commit()
    return {"ok": True}
