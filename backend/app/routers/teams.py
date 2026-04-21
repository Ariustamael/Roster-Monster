from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Team, TeamAssignment, Staff
from ..schemas import TeamOut, TeamAssignmentCreate, TeamAssignmentOut

router = APIRouter(prefix="/api/teams", tags=["teams"])


@router.get("", response_model=list[TeamOut])
def list_teams(db: Session = Depends(get_db)):
    return db.query(Team).order_by(Team.name).all()


@router.get("/{team_id}/members", response_model=list[TeamAssignmentOut])
def list_team_members(team_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(TeamAssignment)
        .filter(TeamAssignment.team_id == team_id)
        .order_by(TeamAssignment.effective_from.desc())
        .all()
    )
    return [
        TeamAssignmentOut(
            id=r.id,
            staff_id=r.staff_id,
            staff_name=r.staff.name,
            team_id=r.team_id,
            team_name=r.team.name,
            role=r.role,
            effective_from=r.effective_from,
            effective_to=r.effective_to,
        )
        for r in rows
    ]


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
    return TeamAssignmentOut(
        id=ta.id,
        staff_id=ta.staff_id,
        staff_name=staff.name,
        team_id=ta.team_id,
        team_name=team.name,
        role=ta.role,
        effective_from=ta.effective_from,
        effective_to=ta.effective_to,
    )


@router.delete("/assignments/{assignment_id}")
def delete_assignment(assignment_id: int, db: Session = Depends(get_db)):
    ta = db.query(TeamAssignment).get(assignment_id)
    if not ta:
        raise HTTPException(404, "Assignment not found")
    db.delete(ta)
    db.commit()
    return {"ok": True}
