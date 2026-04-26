from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, delete, extract, func as sa_func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import (
    MonthlyConfig,
    ConsultantOnCall,
    ACOnCall,
    RegistrarDuty,
    StepdownDay,
    ExtOTDate,
    PublicHoliday,
)
from ..schemas import (
    MonthlyConfigCreate,
    MonthlyConfigOut,
    ConsultantOnCallCreate,
    ConsultantOnCallOut,
    ACOnCallCreate,
    ACOnCallOut,
    RegistrarDutyCreate,
    RegistrarDutyOut,
    StepdownDayCreate,
    StepdownDayOut,
    ExtOTDateCreate,
    ExtOTDateOut,
    PublicHolidayCreate,
    PublicHolidayOut,
)

router = APIRouter(prefix="/api/config", tags=["monthly_config"])


@router.get("", response_model=list[MonthlyConfigOut])
async def list_configs(db: AsyncSession = Depends(get_db)):
    return (
        (
            await db.execute(
                select(MonthlyConfig).order_by(
                    MonthlyConfig.year.desc(), MonthlyConfig.month.desc()
                )
            )
        )
        .scalars()
        .all()
    )


@router.post("", response_model=MonthlyConfigOut)
async def create_config(
    payload: MonthlyConfigCreate, db: AsyncSession = Depends(get_db)
):
    existing = (
        await db.execute(
            select(MonthlyConfig).filter(
                MonthlyConfig.year == payload.year, MonthlyConfig.month == payload.month
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "Config already exists for this month")
    cfg = MonthlyConfig(**payload.model_dump())
    db.add(cfg)
    await db.commit()
    await db.refresh(cfg)
    return cfg


# â”€â”€ Public Holidays (before /{config_id} to avoid path conflict) â”€â”€â”€â”€â”€â”€â”€â”€


@router.get("/public-holidays", response_model=list[PublicHolidayOut])
async def list_public_holidays(
    year: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    q = select(PublicHoliday).order_by(PublicHoliday.date)
    if year is not None:
        q = q.filter(extract("year", PublicHoliday.date) == year)
    return (await db.execute(q)).scalars().all()


@router.post("/public-holidays", response_model=PublicHolidayOut)
async def create_public_holiday(
    payload: PublicHolidayCreate, db: AsyncSession = Depends(get_db)
):
    existing = (
        await db.execute(
            select(PublicHoliday).filter(PublicHoliday.date == payload.date)
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "Holiday already exists for this date")
    ph = PublicHoliday(date=payload.date, name=payload.name)
    db.add(ph)
    await db.commit()
    await db.refresh(ph)
    return ph


@router.delete("/public-holidays/{holiday_id}")
async def delete_public_holiday(holiday_id: int, db: AsyncSession = Depends(get_db)):
    ph = await db.get(PublicHoliday, holiday_id)
    if not ph:
        raise HTTPException(404, "Holiday not found")
    await db.delete(ph)
    await db.commit()
    return {"ok": True}


# â”€â”€ Config by ID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@router.get("/{config_id}", response_model=MonthlyConfigOut)
async def get_config(config_id: int, db: AsyncSession = Depends(get_db)):
    cfg = await db.get(MonthlyConfig, config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    return cfg


@router.delete("/{config_id}")
async def delete_config(config_id: int, db: AsyncSession = Depends(get_db)):
    cfg = await db.get(MonthlyConfig, config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    await db.delete(cfg)
    await db.commit()
    return {"ok": True}


# â”€â”€ Consultant On-Call â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@router.post("/{config_id}/consultant-oncall")
async def set_consultant_oncall(
    config_id: int,
    entries: list[ConsultantOnCallCreate],
    db: AsyncSession = Depends(get_db),
):
    cfg = await db.get(MonthlyConfig, config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    await db.execute(
        delete(ConsultantOnCall).where(ConsultantOnCall.config_id == config_id)
    )
    for e in entries:
        db.add(
            ConsultantOnCall(
                config_id=config_id,
                date=e.date,
                consultant_id=e.consultant_id,
                supervising_consultant_id=e.supervising_consultant_id,
            )
        )
    cfg.updated_at = sa_func.now()
    await db.commit()
    return {"ok": True, "count": len(entries)}


@router.get("/{config_id}/consultant-oncall", response_model=list[ConsultantOnCallOut])
async def get_consultant_oncall(config_id: int, db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(ConsultantOnCall)
                .filter(ConsultantOnCall.config_id == config_id)
                .options(
                    selectinload(ConsultantOnCall.consultant),
                    selectinload(ConsultantOnCall.supervising_consultant),
                )
                .order_by(ConsultantOnCall.date)
            )
        )
        .scalars()
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


# â”€â”€ AC On-Call â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@router.post("/{config_id}/ac-oncall")
async def set_ac_oncall(
    config_id: int,
    entries: list[ACOnCallCreate],
    db: AsyncSession = Depends(get_db),
):
    cfg = await db.get(MonthlyConfig, config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    await db.execute(delete(ACOnCall).where(ACOnCall.config_id == config_id))
    for e in entries:
        db.add(ACOnCall(config_id=config_id, date=e.date, ac_id=e.ac_id))
    cfg.updated_at = sa_func.now()
    await db.commit()
    return {"ok": True, "count": len(entries)}


@router.get("/{config_id}/ac-oncall", response_model=list[ACOnCallOut])
async def get_ac_oncall(config_id: int, db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(ACOnCall)
                .filter(ACOnCall.config_id == config_id)
                .options(selectinload(ACOnCall.ac))
                .order_by(ACOnCall.date)
            )
        )
        .scalars()
        .all()
    )
    return [
        ACOnCallOut(id=r.id, date=r.date, ac_id=r.ac_id, ac_name=r.ac.name)
        for r in rows
    ]


# â”€â”€ Registrar Duties â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@router.post("/{config_id}/registrar-duties")
async def set_registrar_duties(
    config_id: int,
    entries: list[RegistrarDutyCreate],
    db: AsyncSession = Depends(get_db),
):
    cfg = await db.get(MonthlyConfig, config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    await db.execute(delete(RegistrarDuty).where(RegistrarDuty.config_id == config_id))
    for e in entries:
        db.add(
            RegistrarDuty(
                config_id=config_id,
                date=e.date,
                registrar_id=e.registrar_id,
                duty_type=e.duty_type,
                shift=e.shift,
            )
        )
    cfg.updated_at = sa_func.now()
    await db.commit()
    return {"ok": True, "count": len(entries)}


@router.get("/{config_id}/registrar-duties", response_model=list[RegistrarDutyOut])
async def get_registrar_duties(config_id: int, db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(RegistrarDuty)
                .filter(RegistrarDuty.config_id == config_id)
                .options(selectinload(RegistrarDuty.registrar))
                .order_by(RegistrarDuty.date)
            )
        )
        .scalars()
        .all()
    )
    return [
        RegistrarDutyOut(
            id=r.id,
            date=r.date,
            registrar_id=r.registrar_id,
            registrar_name=r.registrar.name,
            duty_type=r.duty_type,
            shift=r.shift,
        )
        for r in rows
    ]


# â”€â”€ Stepdown Days â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@router.post("/{config_id}/stepdown-days")
async def set_stepdown_days(
    config_id: int,
    entries: list[StepdownDayCreate],
    db: AsyncSession = Depends(get_db),
):
    cfg = await db.get(MonthlyConfig, config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    await db.execute(delete(StepdownDay).where(StepdownDay.config_id == config_id))
    for e in entries:
        db.add(StepdownDay(config_id=config_id, date=e.date))
    cfg.updated_at = sa_func.now()
    await db.commit()
    return {"ok": True, "count": len(entries)}


@router.get("/{config_id}/stepdown-days", response_model=list[StepdownDayOut])
async def get_stepdown_days(config_id: int, db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(StepdownDay)
                .filter(StepdownDay.config_id == config_id)
                .order_by(StepdownDay.date)
            )
        )
        .scalars()
        .all()
    )
    return [StepdownDayOut(id=r.id, date=r.date) for r in rows]


# â”€â”€ Extended OT Dates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


@router.post("/{config_id}/ext-ot-dates")
async def set_ext_ot_dates(
    config_id: int,
    entries: list[ExtOTDateCreate],
    db: AsyncSession = Depends(get_db),
):
    cfg = await db.get(MonthlyConfig, config_id)
    if not cfg:
        raise HTTPException(404, "Config not found")
    await db.execute(delete(ExtOTDate).where(ExtOTDate.config_id == config_id))
    for e in entries:
        db.add(ExtOTDate(config_id=config_id, date=e.date))
    cfg.updated_at = sa_func.now()
    await db.commit()
    return {"ok": True, "count": len(entries)}


@router.get("/{config_id}/ext-ot-dates", response_model=list[ExtOTDateOut])
async def get_ext_ot_dates(config_id: int, db: AsyncSession = Depends(get_db)):
    rows = (
        (
            await db.execute(
                select(ExtOTDate)
                .filter(ExtOTDate.config_id == config_id)
                .order_by(ExtOTDate.date)
            )
        )
        .scalars()
        .all()
    )
    return [ExtOTDateOut(id=r.id, date=r.date) for r in rows]
