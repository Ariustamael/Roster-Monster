from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RankConfig, CallTypeConfig, CallTypeEligibleRank
from ..schemas import (
    RankConfigCreate,
    RankConfigOut,
    CallTypeConfigCreate,
    CallTypeConfigOut,
)

router = APIRouter(prefix="/api/config", tags=["config"])


# ── Rank Config ─────────────────────────────────────────────────────────


@router.get("/ranks", response_model=list[RankConfigOut])
def list_ranks(db: Session = Depends(get_db)):
    return db.query(RankConfig).order_by(RankConfig.display_order).all()


@router.post("/ranks", response_model=RankConfigOut)
def create_rank(payload: RankConfigCreate, db: Session = Depends(get_db)):
    dup = db.query(RankConfig).filter(RankConfig.name == payload.name).first()
    if dup:
        raise HTTPException(409, "Rank name already exists")
    r = RankConfig(**payload.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


@router.put("/ranks/{rank_id}", response_model=RankConfigOut)
def update_rank(rank_id: int, payload: RankConfigCreate, db: Session = Depends(get_db)):
    r = db.query(RankConfig).get(rank_id)
    if not r:
        raise HTTPException(404, "Rank not found")
    dup = (
        db.query(RankConfig)
        .filter(RankConfig.name == payload.name, RankConfig.id != rank_id)
        .first()
    )
    if dup:
        raise HTTPException(409, "Rank name already exists")
    for k, v in payload.model_dump().items():
        setattr(r, k, v)
    db.commit()
    db.refresh(r)
    return r


@router.delete("/ranks/{rank_id}")
def delete_rank(rank_id: int, db: Session = Depends(get_db)):
    r = db.query(RankConfig).get(rank_id)
    if not r:
        raise HTTPException(404, "Rank not found")
    db.delete(r)
    db.commit()
    return {"ok": True}


# ── Call Type Config ────────────────────────────────────────────────────


def _sync_linked_to(ct_id: int, linked_ids_str: str | None, db: Session) -> None:
    """Auto-sync linked_to bidirectionally: when ct A is linked to B, ensure B
    is also linked to A. Handles adds (on save) and removes (when ids drop).

    The linked_to string is a comma-separated list of call_type ids. We diff
    against the previous state and update each affected target's linked_to.
    """
    desired = set()
    if linked_ids_str:
        for tok in linked_ids_str.split(","):
            tok = tok.strip()
            if tok.isdigit():
                desired.add(int(tok))
    desired.discard(ct_id)  # no self-link

    # Current reverse references: every call type that currently lists ct_id
    all_cts = db.query(CallTypeConfig).all()
    current_reverse: set[int] = set()
    for other in all_cts:
        if other.id == ct_id or not other.linked_to:
            continue
        ids = {
            int(t.strip()) for t in other.linked_to.split(",")
            if t.strip().isdigit()
        }
        if ct_id in ids:
            current_reverse.add(other.id)

    to_add = desired - current_reverse
    to_remove = current_reverse - desired

    def ids_to_str(ids: set[int]) -> str | None:
        if not ids:
            return None
        return ",".join(str(i) for i in sorted(ids))

    for tgt_id in to_add:
        tgt = next((o for o in all_cts if o.id == tgt_id), None)
        if not tgt:
            continue
        ids = set()
        if tgt.linked_to:
            ids = {int(t.strip()) for t in tgt.linked_to.split(",") if t.strip().isdigit()}
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
        min_consecutive_days=ct.min_consecutive_days if ct.min_consecutive_days is not None else 1,
        min_gap_days=ct.min_gap_days,
        switch_window_days=ct.switch_window_days if ct.switch_window_days is not None else 5,
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
def list_call_types(db: Session = Depends(get_db)):
    rows = db.query(CallTypeConfig).order_by(CallTypeConfig.display_order).all()
    return [_ct_to_out(ct) for ct in rows]


@router.post("/call-types", response_model=CallTypeConfigOut)
def create_call_type(payload: CallTypeConfigCreate, db: Session = Depends(get_db)):
    dup = db.query(CallTypeConfig).filter(CallTypeConfig.name == payload.name).first()
    if dup:
        raise HTTPException(409, "Call type name already exists")
    data = payload.model_dump(exclude={"eligible_rank_ids"})
    ct = CallTypeConfig(**data)
    db.add(ct)
    db.flush()
    for rid in payload.eligible_rank_ids:
        db.add(CallTypeEligibleRank(call_type_id=ct.id, rank_id=rid))
    _sync_linked_to(ct.id, ct.linked_to, db)
    db.commit()
    db.refresh(ct)
    return _ct_to_out(ct)


@router.put("/call-types/{ct_id}", response_model=CallTypeConfigOut)
def update_call_type(
    ct_id: int, payload: CallTypeConfigCreate, db: Session = Depends(get_db)
):
    ct = db.query(CallTypeConfig).get(ct_id)
    if not ct:
        raise HTTPException(404, "Call type not found")
    dup = (
        db.query(CallTypeConfig)
        .filter(CallTypeConfig.name == payload.name, CallTypeConfig.id != ct_id)
        .first()
    )
    if dup:
        raise HTTPException(409, "Call type name already exists")
    data = payload.model_dump(exclude={"eligible_rank_ids"})
    for k, v in data.items():
        setattr(ct, k, v)
    db.query(CallTypeEligibleRank).filter(
        CallTypeEligibleRank.call_type_id == ct_id
    ).delete()
    for rid in payload.eligible_rank_ids:
        db.add(CallTypeEligibleRank(call_type_id=ct_id, rank_id=rid))
    _sync_linked_to(ct.id, ct.linked_to, db)
    db.commit()
    db.refresh(ct)
    return _ct_to_out(ct)


@router.delete("/call-types/{ct_id}")
def delete_call_type(ct_id: int, db: Session = Depends(get_db)):
    ct = db.query(CallTypeConfig).get(ct_id)
    if not ct:
        raise HTTPException(404, "Call type not found")
    db.delete(ct)
    db.commit()
    return {"ok": True}
