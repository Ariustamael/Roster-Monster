from pydantic import BaseModel
from datetime import date
from typing import Optional
from .models import Grade, CallType, PreferenceType, RegistrarShift, RegistrarDutyType, DutyType, Session


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


class TeamCreate(BaseModel):
    name: str


class TeamAssignmentCreate(BaseModel):
    staff_id: int
    team_id: int
    role: str
    supervisor_id: Optional[int] = None
    effective_from: date
    effective_to: Optional[date] = None


class TeamAssignmentOut(BaseModel):
    id: int
    staff_id: int
    staff_name: str
    team_id: int
    team_name: str
    role: str
    supervisor_id: Optional[int] = None
    supervisor_name: Optional[str] = None
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


class ManualOverrideCreate(BaseModel):
    date: date
    call_type: CallType
    staff_id: int


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


# ── OT Template ──────────────────────────────────────────────────────────

class OTTemplateCreate(BaseModel):
    day_of_week: int
    room: str
    consultant_id: int
    assistants_needed: int = 2
    is_la: bool = False


class OTTemplateOut(BaseModel):
    id: int
    day_of_week: int
    room: str
    consultant_id: int
    consultant_name: str
    assistants_needed: int
    is_la: bool

    model_config = {"from_attributes": True}


# ── Clinic Template ──────────────────────────────────────────────────────

class ClinicTemplateCreate(BaseModel):
    day_of_week: int
    session: Session
    room: str
    is_supervised: bool = False
    consultant_id: Optional[int] = None


class ClinicTemplateOut(BaseModel):
    id: int
    day_of_week: int
    session: Session
    room: str
    is_supervised: bool
    consultant_id: Optional[int]
    consultant_name: Optional[str] = None

    model_config = {"from_attributes": True}


# ── Duty Assignment (output) ─────────────────────────────────────────────

class DutyAssignmentOut(BaseModel):
    id: int
    date: date
    staff_id: int
    staff_name: str
    session: Session
    duty_type: DutyType
    location: Optional[str]
    consultant_id: Optional[int]
    consultant_name: Optional[str] = None
    is_manual_override: bool

    model_config = {"from_attributes": True}


class DayDutyRoster(BaseModel):
    date: date
    day_name: str
    is_weekend: bool
    is_ph: bool
    ot_assignments: list[DutyAssignmentOut]
    am_clinics: list[DutyAssignmentOut]
    pm_clinics: list[DutyAssignmentOut]
    am_admin: list[str]
    pm_admin: list[str]


class DutyRosterResponse(BaseModel):
    year: int
    month: int
    days: list[DayDutyRoster]
    duty_stats: dict[str, dict]
