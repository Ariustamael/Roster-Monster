from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import Team, TeamAssignment, Staff, RankConfig
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


async def _load_assignment(db: AsyncSession, ta: TeamAssignment) -> TeamAssignment:
    """Eagerly load staff/team/supervisor relationships for _to_out."""
    await db.refresh(ta, ["staff", "team", "supervisor"])
    return ta


@router.get("", response_model=list[TeamOut])
async def list_teams(db: AsyncSession = Depends(get_db)):
    return (
        (await db.execute(select(Team).order_by(Team.display_order, Team.id)))
        .scalars()
        .all()
    )


@router.post("", response_model=TeamOut)
async def create_team(payload: TeamCreate, db: AsyncSession = Depends(get_db)):
    existing = (
        await db.execute(select(Team).filter(Team.name == payload.name))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "Team name already exists")
    max_order = (await db.execute(select(func.count()).select_from(Team))).scalar() or 0
    t = Team(name=payload.name, display_order=max_order)
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


@router.put("/{team_id}/rename", response_model=TeamOut)
async def rename_team(
    team_id: int, payload: TeamCreate, db: AsyncSession = Depends(get_db)
):
    t = await db.get(Team, team_id)
    if not t:
        raise HTTPException(404, "Team not found")
    dup = (
        await db.execute(
            select(Team).filter(Team.name == payload.name, Team.id != team_id)
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "Team name already exists")
    t.name = payload.name
    await db.commit()
    await db.refresh(t)
    return t


@router.put("/reorder")
async def reorder_teams(order: list[int], db: AsyncSession = Depends(get_db)):
    for idx, team_id in enumerate(order):
        t = await db.get(Team, team_id)
        if t:
            t.display_order = idx
    await db.commit()
    return {"ok": True}


@router.delete("/{team_id}")
async def delete_team(team_id: int, db: AsyncSession = Depends(get_db)):
    t = await db.get(Team, team_id)
    if not t:
        raise HTTPException(404, "Team not found")
    await db.delete(t)
    await db.commit()
    return {"ok": True}


@router.get("/{team_id}/members", response_model=list[TeamAssignmentOut])
async def list_team_members(team_id: int, db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(TeamAssignment)
                .filter(TeamAssignment.team_id == team_id)
                .options(
                    selectinload(TeamAssignment.staff),
                    selectinload(TeamAssignment.team),
                    selectinload(TeamAssignment.supervisor),
                )
                .order_by(TeamAssignment.effective_from.desc())
            )
        )
        .scalars()
        .all()
    )
    return [_to_out(r) for r in rows]


@router.get("/all-assignments", response_model=list[TeamAssignmentOut])
async def list_all_assignments(db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(TeamAssignment)
                .options(
                    selectinload(TeamAssignment.staff),
                    selectinload(TeamAssignment.team),
                    selectinload(TeamAssignment.supervisor),
                )
                .order_by(
                    TeamAssignment.team_id, TeamAssignment.role, TeamAssignment.staff_id
                )
            )
        )
        .scalars()
        .all()
    )
    return [_to_out(r) for r in rows]


@router.post("/assignments", response_model=TeamAssignmentOut)
async def create_assignment(
    payload: TeamAssignmentCreate, db: AsyncSession = Depends(get_db)
):
    staff = await db.get(Staff, payload.staff_id)
    if not staff:
        raise HTTPException(404, "Staff not found")
    team = await db.get(Team, payload.team_id)
    if not team:
        raise HTTPException(404, "Team not found")

    ta = TeamAssignment(**payload.model_dump())
    db.add(ta)
    await db.commit()
    ta = await db.get(
        TeamAssignment,
        ta.id,
        options=[
            selectinload(TeamAssignment.staff),
            selectinload(TeamAssignment.team),
            selectinload(TeamAssignment.supervisor),
        ],
    )
    return _to_out(ta)


@router.put("/reassign/{staff_id}/{team_id}")
async def reassign_staff(
    staff_id: int,
    team_id: int,
    supervisor_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    staff = await db.get(Staff, staff_id)
    if not staff:
        raise HTTPException(404, "Staff not found")
    team = await db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Team not found")

    role = "mo"
    rank_val = staff.rank if isinstance(staff.rank, str) else staff.rank.value
    cons_ranks = (
        (
            await db.execute(
                select(RankConfig).filter(RankConfig.is_consultant_tier.is_(True))
            )
        )
        .scalars()
        .all()
    )
    cons_rank_names = {r.name for r in cons_ranks}
    if rank_val in cons_rank_names:
        role = "consultant"

    await db.execute(delete(TeamAssignment).where(TeamAssignment.staff_id == staff_id))

    ta = TeamAssignment(
        staff_id=staff_id,
        team_id=team_id,
        role=role,
        supervisor_id=supervisor_id if role == "mo" else None,
        effective_from=date_type.today(),
    )
    db.add(ta)
    await db.commit()
    ta = await db.get(
        TeamAssignment,
        ta.id,
        options=[
            selectinload(TeamAssignment.staff),
            selectinload(TeamAssignment.team),
            selectinload(TeamAssignment.supervisor),
        ],
    )
    return _to_out(ta)


@router.put("/set-supervisor/{staff_id}/{supervisor_id}")
async def set_supervisor(
    staff_id: int, supervisor_id: int, db: AsyncSession = Depends(get_db)
):
    ta = (
        await db.execute(
            select(TeamAssignment)
            .filter(TeamAssignment.staff_id == staff_id, TeamAssignment.role == "mo")
            .options(
                selectinload(TeamAssignment.staff),
                selectinload(TeamAssignment.team),
                selectinload(TeamAssignment.supervisor),
            )
        )
    ).scalar_one_or_none()
    if not ta:
        raise HTTPException(404, "MO team assignment not found")
    sup = await db.get(Staff, supervisor_id)
    if not sup:
        raise HTTPException(404, "Supervisor not found")
    ta.supervisor_id = supervisor_id
    await db.commit()
    await db.refresh(ta, ["supervisor"])
    return _to_out(ta)


@router.delete("/assignments/{assignment_id}")
async def delete_assignment(assignment_id: int, db: AsyncSession = Depends(get_db)):
    ta = await db.get(TeamAssignment, assignment_id)
    if not ta:
        raise HTTPException(404, "Assignment not found")
    await db.delete(ta)
    await db.commit()
    return {"ok": True}
