from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func as sa_func

from ..database import get_db
from ..models import (
    MonthlyConfig, ConsultantOnCall, ACOnCall,
    RegistrarDuty, StepdownDay, EveningOTDate, PublicHoliday,
)
from ..schemas import (
    MonthlyConfigCreate, MonthlyConfigOut,
    ConsultantOnCallCreate, ConsultantOnCallOut,
    ACOnCallCreate, ACOnCallOut,
    RegistrarDutyCreate, RegistrarDutyOut,
    StepdownDayCreate, StepdownDayOut,
    EveningOTDateCreate, EveningOTDateOut,
    PublicHolidayCreate, PublicHolidayOut,
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


# ── Public Holidays (before /{config_id} to avoid path conflict) ────────

@router.get("/public-holidays", response_model=list[PublicHolidayOut])
def list_public_holidays(
    year: int | None = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(PublicHoliday).order_by(PublicHoliday.date)
    if year is not None:
        from sqlalchemy import extract
        q = q.filter(extract("year", PublicHoliday.date) == year)
    return q.all()


@router.post("/public-holidays", response_model=PublicHolidayOut)
def create_public_holiday(payload: PublicHolidayCreate, db: Session = Depends(get_db)):
    existing = db.query(PublicHoliday).filter(PublicHoliday.date == payload.date).first()
    if existing:
        raise HTTPException(409, "Holiday already exists for this date")
    ph = PublicHoliday(date=payload.date, name=payload.name)
    db.add(ph)
    db.commit()
    db.refresh(ph)
    return ph


@router.delete("/public-holidays/{holiday_id}")
def delete_public_holiday(holiday_id: int, db: Session = Depends(get_db)):
    ph = db.query(PublicHoliday).get(holiday_id)
    if not ph:
        raise HTTPException(404, "Holiday not found")
    db.delete(ph)
    db.commit()
    return {"ok": True}


# ── Config by ID ────────────────────────────────────────────────────────

@router.get("/{config_id}", response_model=MonthlyConfigOut)
def get_config(config_id: int, db: Session = Depends(get_db)):
    cfg = db.query(MonthlyConfig).get(config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    return cfg


@router.delete("/{config_id}")
def delete_config(config_id: int, db: Session = Depends(get_db)):
    cfg = db.query(MonthlyConfig).get(config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    db.delete(cfg)
    db.commit()
    return {"ok": True}


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
        db.add(ConsultantOnCall(
            config_id=config_id,
            date=e.date,
            consultant_id=e.consultant_id,
            supervising_consultant_id=e.supervising_consultant_id,
        ))
    cfg.updated_at = sa_func.now()
    db.commit()
    return {"ok": True, "count": len(entries)}


@router.get("/{config_id}/consultant-oncall", response_model=list[ConsultantOnCallOut])
def get_consultant_oncall(config_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(ConsultantOnCall)
        .filter(ConsultantOnCall.config_id == config_id)
        .order_by(ConsultantOnCall.date)
        .all()
    )
    return [
        ConsultantOnCallOut(
            id=r.id,
            date=r.date,
            consultant_id=r.consultant_id,
            consultant_name=r.consultant.name,
            supervising_consultant_id=r.supervising_consultant_id,
            supervising_consultant_name=(
                r.supervising_consultant.name if r.supervising_consultant else None
            ),
        )
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
    cfg.updated_at = sa_func.now()
    db.commit()
    return {"ok": True, "count": len(entries)}


@router.get("/{config_id}/ac-oncall", response_model=list[ACOnCallOut])
def get_ac_oncall(config_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(ACOnCall)
        .filter(ACOnCall.config_id == config_id)
        .order_by(ACOnCall.date)
        .all()
    )
    return [
        ACOnCallOut(id=r.id, date=r.date, ac_id=r.ac_id, ac_name=r.ac.name)
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
    cfg.updated_at = sa_func.now()
    db.commit()
    return {"ok": True, "count": len(entries)}


@router.get("/{config_id}/registrar-duties", response_model=list[RegistrarDutyOut])
def get_registrar_duties(config_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(RegistrarDuty)
        .filter(RegistrarDuty.config_id == config_id)
        .order_by(RegistrarDuty.date)
        .all()
    )
    return [
        RegistrarDutyOut(
            id=r.id, date=r.date,
            registrar_id=r.registrar_id,
            registrar_name=r.registrar.name,
            duty_type=r.duty_type,
            shift=r.shift,
        )
        for r in rows
    ]


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
    cfg.updated_at = sa_func.now()
    db.commit()
    return {"ok": True, "count": len(entries)}


@router.get("/{config_id}/stepdown-days", response_model=list[StepdownDayOut])
def get_stepdown_days(config_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(StepdownDay)
        .filter(StepdownDay.config_id == config_id)
        .order_by(StepdownDay.date)
        .all()
    )
    return [StepdownDayOut(id=r.id, date=r.date) for r in rows]


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
    cfg.updated_at = sa_func.now()
    db.commit()
    return {"ok": True, "count": len(entries)}


@router.get("/{config_id}/evening-ot-dates", response_model=list[EveningOTDateOut])
def get_evening_ot_dates(config_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(EveningOTDate)
        .filter(EveningOTDate.config_id == config_id)
        .order_by(EveningOTDate.date)
        .all()
    )
    return [EveningOTDateOut(id=r.id, date=r.date) for r in rows]
