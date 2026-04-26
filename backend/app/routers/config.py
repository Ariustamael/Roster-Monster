from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import RankConfig, CallTypeConfig, CallTypeEligibleRank
from ..schemas import (
    RankConfigCreate,
    RankConfigOut,
    CallTypeConfigCreate,
    CallTypeConfigOut,
)

router = APIRouter(prefix="/api/config", tags=["config"])


# â”€â”€ Rank Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@router.get("/ranks", response_model=list[RankConfigOut])
async def list_ranks(db: AsyncSession = Depends(get_db)):
    return (
        (await db.execute(select(RankConfig).order_by(RankConfig.display_order)))
        .scalars()
        .all()
    )


@router.post("/ranks", response_model=RankConfigOut)
async def create_rank(payload: RankConfigCreate, db: AsyncSession = Depends(get_db)):
    dup = (
        await db.execute(select(RankConfig).filter(RankConfig.name == payload.name))
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "Rank name already exists")
    r = RankConfig(**payload.model_dump())
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


@router.put("/ranks/{rank_id}", response_model=RankConfigOut)
async def update_rank(
    rank_id: int, payload: RankConfigCreate, db: AsyncSession = Depends(get_db)
):
    r = await db.get(RankConfig, rank_id)
    if not r:
        raise HTTPException(404, "Rank not found")
    dup = (
        await db.execute(
            select(RankConfig).filter(
                RankConfig.name == payload.name, RankConfig.id != rank_id
            )
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "Rank name already exists")
    for k, v in payload.model_dump().items():
        setattr(r, k, v)
    await db.commit()
    await db.refresh(r)
    return r


@router.delete("/ranks/{rank_id}")
async def delete_rank(rank_id: int, db: AsyncSession = Depends(get_db)):
    r = await db.get(RankConfig, rank_id)
    if not r:
        raise HTTPException(404, "Rank not found")
    await db.delete(r)
    await db.commit()
    return {"ok": True}


# â”€â”€ Call Type Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


async def _sync_linked_to(
    ct_id: int, linked_ids_str: str | None, db: AsyncSession
) -> None:
    """Auto-sync linked_to bidirectionally."""
    desired = set()
    if linked_ids_str:
        for tok in linked_ids_str.split(","):
            tok = tok.strip()
            if tok.isdigit():
                desired.add(int(tok))
    desired.discard(ct_id)

    all_cts = (await db.execute(select(CallTypeConfig))).scalars().all()
    current_reverse: set[int] = set()
    for other in all_cts:
        if other.id == ct_id or not other.linked_to:
            continue
        ids = {
            int(t.strip()) for t in other.linked_to.split(",") if t.strip().isdigit()
        }
        if ct_id in ids:
            current_reverse.add(other.id)

    to_add = desired - current_reverse
    to_remove = current_reverse - desired

    def ids_to_str(ids: set[int]) -> str | None:
        return ",".join(str(i) for i in sorted(ids)) if ids else None

    for tgt_id in to_add:
        tgt = next((o for o in all_cts if o.id == tgt_id), None)
        if not tgt:
            continue
        ids = set()
        if tgt.linked_to:
            ids = {
                int(t.strip()) for t in tgt.linked_to.split(",") if t.strip().isdigit()
            }
        ids.add(ct_id)
        tgt.linked_to = ids_to_str(ids)

    for tgt_id in to_remove:
        tgt = next((o for o in all_cts if o.id == tgt_id), None)
        if not tgt or not tgt.linked_to:
            continue
        ids = {int(t.strip()) for t in tgt.linked_to.split(",") if t.strip().isdigit()}
        ids.discard(ct_id)
        tgt.linked_to = ids_to_str(ids)


def _ct_to_out(ct: CallTypeConfig) -> CallTypeConfigOut:
    rank_ids = [er.rank_id for er in ct.eligible_ranks]
    return CallTypeConfigOut(
        id=ct.id,
        name=ct.name,
        display_order=ct.display_order,
        is_overnight=ct.is_overnight,
        post_call_type=ct.post_call_type,
        max_consecutive_days=ct.max_consecutive_days,
        min_consecutive_days=ct.min_consecutive_days
        if ct.min_consecutive_days is not None
        else 1,
        min_gap_days=ct.min_gap_days,
        switch_window_days=ct.switch_window_days
        if ct.switch_window_days is not None
        else 5,
        difficulty_points=ct.difficulty_points,
        counts_towards_fairness=ct.counts_towards_fairness,
        applicable_days=ct.applicable_days,
        required_conditions=ct.required_conditions,
        default_duty_type=ct.default_duty_type,
        is_night_float=ct.is_night_float or False,
        night_float_run=ct.night_float_run,
        uses_consultant_affinity=ct.uses_consultant_affinity or False,
        is_active=ct.is_active,
        is_duty_only=ct.is_duty_only or False,
        linked_to=ct.linked_to,
        mutually_exclusive_with=ct.mutually_exclusive_with,
        eligible_rank_ids=rank_ids,
    )


@router.get("/call-types", response_model=list[CallTypeConfigOut])
async def list_call_types(db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(CallTypeConfig)
                .options(selectinload(CallTypeConfig.eligible_ranks))
                .order_by(CallTypeConfig.display_order)
            )
        )
        .scalars()
        .all()
    )
    return [_ct_to_out(ct) for ct in rows]


@router.post("/call-types", response_model=CallTypeConfigOut)
async def create_call_type(
    payload: CallTypeConfigCreate, db: AsyncSession = Depends(get_db)
):
    dup = (
        await db.execute(
            select(CallTypeConfig).filter(CallTypeConfig.name == payload.name)
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "Call type name already exists")
    data = payload.model_dump(exclude={"eligible_rank_ids"})
    ct = CallTypeConfig(**data)
    db.add(ct)
    await db.flush()
    for rid in payload.eligible_rank_ids:
        db.add(CallTypeEligibleRank(call_type_id=ct.id, rank_id=rid))
    await _sync_linked_to(ct.id, ct.linked_to, db)
    await db.commit()
    ct = await db.get(
        CallTypeConfig, ct.id, options=[selectinload(CallTypeConfig.eligible_ranks)]
    )
    return _ct_to_out(ct)


@router.put("/call-types/{ct_id}", response_model=CallTypeConfigOut)
async def update_call_type(
    ct_id: int, payload: CallTypeConfigCreate, db: AsyncSession = Depends(get_db)
):
    ct = await db.get(
        CallTypeConfig, ct_id, options=[selectinload(CallTypeConfig.eligible_ranks)]
    )
    if not ct:
        raise HTTPException(404, "Call type not found")
    dup = (
        await db.execute(
            select(CallTypeConfig).filter(
                CallTypeConfig.name == payload.name, CallTypeConfig.id != ct_id
            )
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "Call type name already exists")
    data = payload.model_dump(exclude={"eligible_rank_ids"})
    for k, v in data.items():
        setattr(ct, k, v)
    await db.execute(
        delete(CallTypeEligibleRank).where(CallTypeEligibleRank.call_type_id == ct_id)
    )
    for rid in payload.eligible_rank_ids:
        db.add(CallTypeEligibleRank(call_type_id=ct_id, rank_id=rid))
    await _sync_linked_to(ct.id, ct.linked_to, db)
    await db.commit()
    ct = await db.get(
        CallTypeConfig, ct_id, options=[selectinload(CallTypeConfig.eligible_ranks)]
    )
    return _ct_to_out(ct)


@router.delete("/call-types/{ct_id}")
async def delete_call_type(ct_id: int, db: AsyncSession = Depends(get_db)):
    ct = await db.get(CallTypeConfig, ct_id)
    if not ct:
        raise HTTPException(404, "Call type not found")
    await db.delete(ct)
    await db.commit()
    return {"ok": True}
