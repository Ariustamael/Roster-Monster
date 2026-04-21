from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    MonthlyConfig, ConsultantOnCall, ACOnCall,
    RegistrarDuty, StepdownDay, EveningOTDate, Staff,
)
from ..schemas import (
    MonthlyConfigCreate, MonthlyConfigOut,
    ConsultantOnCallCreate, ACOnCallCreate,
    RegistrarDutyCreate, StepdownDayCreate, EveningOTDateCreate,
)

router = APIRouter(prefix="/api/config", tags=["monthly_config"])


@router.get("", response_model=list[MonthlyConfigOut])
def list_configs(db: Session = Depends(get_db)):
    return db.query(MonthlyConfig).order_by(MonthlyConfig.year.desc(), MonthlyConfig.month.desc()).all()


@router.post("", response_model=MonthlyConfigOut)
def create_config(payload: MonthlyConfigCreate, db: Session = Depends(get_db)):
    existing = (
        db.query(MonthlyConfig)
        .filter(MonthlyConfig.year == payload.year, MonthlyConfig.month == payload.month)
        .first()
    )
    if existing:
        raise HTTPException(409, "Config already exists for this month")
    cfg = MonthlyConfig(**payload.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)
    return cfg


@router.get("/{config_id}", response_model=MonthlyConfigOut)
def get_config(config_id: int, db: Session = Depends(get_db)):
    cfg = db.query(MonthlyConfig).get(config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    return cfg


# ── Consultant On-Call ───────────────────────────────────────────────────

@router.post("/{config_id}/consultant-oncall")
def set_consultant_oncall(
    config_id: int,
    entries: list[ConsultantOnCallCreate],
    db: Session = Depends(get_db),
):
    cfg = db.query(MonthlyConfig).get(config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    db.query(ConsultantOnCall).filter(ConsultantOnCall.config_id == config_id).delete()
    for e in entries:
        db.add(ConsultantOnCall(config_id=config_id, date=e.date, consultant_id=e.consultant_id))
    db.commit()
    return {"ok": True, "count": len(entries)}


@router.get("/{config_id}/consultant-oncall")
def get_consultant_oncall(config_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(ConsultantOnCall)
        .filter(ConsultantOnCall.config_id == config_id)
        .order_by(ConsultantOnCall.date)
        .all()
    )
    return [
        {"date": str(r.date), "consultant_id": r.consultant_id, "consultant_name": r.consultant.name}
        for r in rows
    ]


# ── AC On-Call ───────────────────────────────────────────────────────────

@router.post("/{config_id}/ac-oncall")
def set_ac_oncall(
    config_id: int,
    entries: list[ACOnCallCreate],
    db: Session = Depends(get_db),
):
    cfg = db.query(MonthlyConfig).get(config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    db.query(ACOnCall).filter(ACOnCall.config_id == config_id).delete()
    for e in entries:
        db.add(ACOnCall(config_id=config_id, date=e.date, ac_id=e.ac_id))
    db.commit()
    return {"ok": True, "count": len(entries)}


@router.get("/{config_id}/ac-oncall")
def get_ac_oncall(config_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(ACOnCall)
        .filter(ACOnCall.config_id == config_id)
        .order_by(ACOnCall.date)
        .all()
    )
    return [
        {"date": str(r.date), "ac_id": r.ac_id, "ac_name": r.ac.name}
        for r in rows
    ]


# ── Registrar Duties ────────────────────────────────────────────────────

@router.post("/{config_id}/registrar-duties")
def set_registrar_duties(
    config_id: int,
    entries: list[RegistrarDutyCreate],
    db: Session = Depends(get_db),
):
    cfg = db.query(MonthlyConfig).get(config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    db.query(RegistrarDuty).filter(RegistrarDuty.config_id == config_id).delete()
    for e in entries:
        db.add(RegistrarDuty(
            config_id=config_id, date=e.date,
            registrar_id=e.registrar_id, duty_type=e.duty_type, shift=e.shift,
        ))
    db.commit()
    return {"ok": True, "count": len(entries)}


# ── Stepdown Days ────────────────────────────────────────────────────────

@router.post("/{config_id}/stepdown-days")
def set_stepdown_days(
    config_id: int,
    entries: list[StepdownDayCreate],
    db: Session = Depends(get_db),
):
    cfg = db.query(MonthlyConfig).get(config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    db.query(StepdownDay).filter(StepdownDay.config_id == config_id).delete()
    for e in entries:
        db.add(StepdownDay(config_id=config_id, date=e.date))
    db.commit()
    return {"ok": True, "count": len(entries)}


# ── Evening OT Dates ─────────────────────────────────────────────────────

@router.post("/{config_id}/evening-ot-dates")
def set_evening_ot_dates(
    config_id: int,
    entries: list[EveningOTDateCreate],
    db: Session = Depends(get_db),
):
    cfg = db.query(MonthlyConfig).get(config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    db.query(EveningOTDate).filter(EveningOTDate.config_id == config_id).delete()
    for e in entries:
        db.add(EveningOTDate(config_id=config_id, date=e.date))
    db.commit()
    return {"ok": True, "count": len(entries)}
