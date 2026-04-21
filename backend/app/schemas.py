from pydantic import BaseModel
from datetime import date
from typing import Optional
from .models import Grade, CallType, PreferenceType, RegistrarShift, RegistrarDutyType


# ── Staff ────────────────────────────────────────────────────────────────

class StaffCreate(BaseModel):
    name: str
    grade: Grade
    active: bool = True
    has_admin_role: bool = False


class StaffOut(BaseModel):
    id: int
    name: str
    grade: Grade
    active: bool
    has_admin_role: bool
    team_name: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Team ─────────────────────────────────────────────────────────────────

class TeamOut(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class TeamAssignmentCreate(BaseModel):
    staff_id: int
    team_id: int
    role: str
    effective_from: date
    effective_to: Optional[date] = None


class TeamAssignmentOut(BaseModel):
    id: int
    staff_id: int
    staff_name: str
    team_id: int
    team_name: str
    role: str
    effective_from: date
    effective_to: Optional[date]

    model_config = {"from_attributes": True}


# ── Leave ────────────────────────────────────────────────────────────────

class LeaveCreate(BaseModel):
    staff_id: int
    date: date
    leave_type: str = "AL"


class LeaveOut(BaseModel):
    id: int
    staff_id: int
    staff_name: str
    date: date
    leave_type: str

    model_config = {"from_attributes": True}


# ── Call Preferences ─────────────────────────────────────────────────────

class CallPreferenceCreate(BaseModel):
    staff_id: int
    date: date
    preference_type: PreferenceType
    reason: Optional[str] = None


class CallPreferenceOut(BaseModel):
    id: int
    staff_id: int
    staff_name: str
    date: date
    preference_type: PreferenceType
    reason: Optional[str]

    model_config = {"from_attributes": True}


# ── Public Holidays ──────────────────────────────────────────────────────

class PublicHolidayCreate(BaseModel):
    date: date
    name: str


class PublicHolidayOut(BaseModel):
    id: int
    date: date
    name: str

    model_config = {"from_attributes": True}


# ── Monthly Config ───────────────────────────────────────────────────────

class MonthlyConfigCreate(BaseModel):
    year: int
    month: int


class MonthlyConfigOut(BaseModel):
    id: int
    year: int
    month: int
    status: str

    model_config = {"from_attributes": True}


class ConsultantOnCallCreate(BaseModel):
    date: date
    consultant_id: int


class ACOnCallCreate(BaseModel):
    date: date
    ac_id: int


class RegistrarDutyCreate(BaseModel):
    date: date
    registrar_id: int
    duty_type: RegistrarDutyType
    shift: RegistrarShift


class StepdownDayCreate(BaseModel):
    date: date


class EveningOTDateCreate(BaseModel):
    date: date


# ── Call Assignment (output) ─────────────────────────────────────────────

class CallAssignmentOut(BaseModel):
    id: int
    date: date
    staff_id: int
    staff_name: str
    call_type: CallType
    is_manual_override: bool

    model_config = {"from_attributes": True}


class DayRoster(BaseModel):
    date: date
    day_name: str
    is_weekend: bool
    is_ph: bool
    is_stepdown: bool
    consultant_oncall: Optional[str] = None
    ac_oncall: Optional[str] = None
    mo1: Optional[str] = None
    mo2: Optional[str] = None
    mo3: Optional[str] = None
    mo4: Optional[str] = None
    mo5: Optional[str] = None


class RosterResponse(BaseModel):
    year: int
    month: int
    days: list[DayRoster]
    violations: list[str]
    fairness: dict[str, dict]
