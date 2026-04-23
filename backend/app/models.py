from sqlalchemy import (
    Column, Integer, String, Date, Boolean, ForeignKey, Enum as SAEnum,
    UniqueConstraint, Text,
)
from sqlalchemy.orm import relationship
import enum

from .database import Base


class DutyType(str, enum.Enum):
    OT = "OT"
    EOT = "EOT"
    CLINIC = "Clinic"
    MOPD = "MOPD"
    ADMIN = "Admin"
    CAT_A = "CAT-A"
    SPECIAL = "Special"


class Session(str, enum.Enum):
    AM = "AM"
    PM = "PM"
    FULL_DAY = "Full Day"


class PreferenceType(str, enum.Enum):
    REQUEST = "request"
    BLOCK = "block"


class RegistrarShift(str, enum.Enum):
    DAY = "day"
    NIGHT = "night"
    COMBINED = "combined"


class RegistrarDutyType(str, enum.Enum):
    R1 = "R1"
    R2 = "R2"
    EOT = "EOT"


# ── Rank Configuration ──────────────────────────────────────────────────

class RankConfig(Base):
    __tablename__ = "rank_config"

    id = Column(Integer, primary_key=True)
    name = Column(String(60), nullable=False, unique=True)
    abbreviation = Column(String(10), nullable=False)
    display_order = Column(Integer, nullable=False, server_default="0")
    is_call_eligible = Column(Boolean, default=False)
    is_duty_eligible = Column(Boolean, default=False)
    is_consultant_tier = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)

    eligible_call_types = relationship(
        "CallTypeEligibleRank", back_populates="rank", cascade="all, delete-orphan",
    )


# ── Call Type Configuration ─────────────────────────────────────────────

class CallTypeConfig(Base):
    __tablename__ = "call_type_config"

    id = Column(Integer, primary_key=True)
    name = Column(String(20), nullable=False, unique=True)
    display_order = Column(Integer, nullable=False, server_default="0")
    is_overnight = Column(Boolean, default=False)
    post_call_type = Column(String(10), default="none")
    max_consecutive_days = Column(Integer, default=1)
    min_gap_days = Column(Integer, default=2)
    difficulty_points = Column(Integer, default=1)
    counts_towards_fairness = Column(Boolean, default=True)
    applicable_days = Column(String(50), default="Mon,Tue,Wed,Thu,Fri,Sat,Sun,PH")
    is_active = Column(Boolean, default=True)

    eligible_ranks = relationship(
        "CallTypeEligibleRank", back_populates="call_type", cascade="all, delete-orphan",
    )


class CallTypeEligibleRank(Base):
    __tablename__ = "call_type_eligible_rank"

    id = Column(Integer, primary_key=True)
    call_type_id = Column(Integer, ForeignKey("call_type_config.id"), nullable=False)
    rank_id = Column(Integer, ForeignKey("rank_config.id"), nullable=False)

    call_type = relationship("CallTypeConfig", back_populates="eligible_ranks")
    rank = relationship("RankConfig", back_populates="eligible_call_types")

    __table_args__ = (UniqueConstraint("call_type_id", "rank_id"),)


# ── Staff ────────────────────────────────────────────────────────────────

class Staff(Base):
    __tablename__ = "staff"

    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    rank = Column(String(60), nullable=False)
    active = Column(Boolean, default=True)
    has_admin_role = Column(Boolean, default=False)

    team_assignments = relationship(
        "TeamAssignment", back_populates="staff",
        foreign_keys="TeamAssignment.staff_id", cascade="all, delete-orphan",
    )
    leaves = relationship("Leave", back_populates="staff", cascade="all, delete-orphan")
    call_preferences = relationship("CallPreference", back_populates="staff", cascade="all, delete-orphan")
    call_assignments = relationship("CallAssignment", back_populates="staff", cascade="all, delete-orphan")


# ── Teams ────────────────────────────────────────────────────────────────

class Team(Base):
    __tablename__ = "team"

    id = Column(Integer, primary_key=True)
    name = Column(String(60), nullable=False, unique=True)
    display_order = Column(Integer, nullable=False, server_default="0")

    assignments = relationship("TeamAssignment", back_populates="team", cascade="all, delete-orphan")


class TeamAssignment(Base):
    __tablename__ = "team_assignment"

    id = Column(Integer, primary_key=True)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=False)
    team_id = Column(Integer, ForeignKey("team.id"), nullable=False)
    role = Column(String(20), nullable=False)  # "consultant" or "mo"
    supervisor_id = Column(Integer, ForeignKey("staff.id"), nullable=True)
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=True)

    staff = relationship("Staff", back_populates="team_assignments", foreign_keys=[staff_id])
    team = relationship("Team", back_populates="assignments")
    supervisor = relationship("Staff", foreign_keys=[supervisor_id])


# ── Leave ────────────────────────────────────────────────────────────────

class Leave(Base):
    __tablename__ = "leave"

    id = Column(Integer, primary_key=True)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=False)
    date = Column(Date, nullable=False)
    leave_type = Column(String(30), default="AL")

    staff = relationship("Staff", back_populates="leaves")

    __table_args__ = (UniqueConstraint("staff_id", "date"),)


# ── Call Preferences ─────────────────────────────────────────────────────

class CallPreference(Base):
    __tablename__ = "call_preference"

    id = Column(Integer, primary_key=True)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=False)
    date = Column(Date, nullable=False)
    preference_type = Column(SAEnum(PreferenceType), nullable=False)
    reason = Column(Text, nullable=True)

    staff = relationship("Staff", back_populates="call_preferences")

    __table_args__ = (UniqueConstraint("staff_id", "date"),)


# ── Public Holidays ──────────────────────────────────────────────────────

class PublicHoliday(Base):
    __tablename__ = "public_holiday"

    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False, unique=True)
    name = Column(String(120), nullable=False)


# ── Monthly Configuration ────────────────────────────────────────────────

class MonthlyConfig(Base):
    __tablename__ = "monthly_config"

    id = Column(Integer, primary_key=True)
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    status = Column(String(20), default="draft")

    consultant_oncalls = relationship("ConsultantOnCall", back_populates="config", cascade="all, delete-orphan")
    ac_oncalls = relationship("ACOnCall", back_populates="config", cascade="all, delete-orphan")
    registrar_duties = relationship("RegistrarDuty", back_populates="config", cascade="all, delete-orphan")
    stepdown_days = relationship("StepdownDay", back_populates="config", cascade="all, delete-orphan")
    evening_ot_dates = relationship("EveningOTDate", back_populates="config", cascade="all, delete-orphan")
    call_assignments = relationship("CallAssignment", back_populates="config", cascade="all, delete-orphan")
    duty_assignments = relationship("DutyAssignment", back_populates="config", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("year", "month"),)


class ConsultantOnCall(Base):
    __tablename__ = "consultant_oncall"

    id = Column(Integer, primary_key=True)
    config_id = Column(Integer, ForeignKey("monthly_config.id"), nullable=False)
    date = Column(Date, nullable=False)
    consultant_id = Column(Integer, ForeignKey("staff.id"), nullable=False)
    supervising_consultant_id = Column(Integer, ForeignKey("staff.id"), nullable=True)

    config = relationship("MonthlyConfig", back_populates="consultant_oncalls")
    consultant = relationship("Staff", foreign_keys=[consultant_id])
    supervising_consultant = relationship("Staff", foreign_keys=[supervising_consultant_id])

    __table_args__ = (UniqueConstraint("config_id", "date"),)


class ACOnCall(Base):
    __tablename__ = "ac_oncall"

    id = Column(Integer, primary_key=True)
    config_id = Column(Integer, ForeignKey("monthly_config.id"), nullable=False)
    date = Column(Date, nullable=False)
    ac_id = Column(Integer, ForeignKey("staff.id"), nullable=False)

    config = relationship("MonthlyConfig", back_populates="ac_oncalls")
    ac = relationship("Staff")

    __table_args__ = (UniqueConstraint("config_id", "date"),)


class RegistrarDuty(Base):
    __tablename__ = "registrar_duty"

    id = Column(Integer, primary_key=True)
    config_id = Column(Integer, ForeignKey("monthly_config.id"), nullable=False)
    date = Column(Date, nullable=False)
    registrar_id = Column(Integer, ForeignKey("staff.id"), nullable=False)
    duty_type = Column(SAEnum(RegistrarDutyType), nullable=False)
    shift = Column(SAEnum(RegistrarShift), nullable=False)

    config = relationship("MonthlyConfig", back_populates="registrar_duties")
    registrar = relationship("Staff")


class StepdownDay(Base):
    __tablename__ = "stepdown_day"

    id = Column(Integer, primary_key=True)
    config_id = Column(Integer, ForeignKey("monthly_config.id"), nullable=False)
    date = Column(Date, nullable=False)

    config = relationship("MonthlyConfig", back_populates="stepdown_days")

    __table_args__ = (UniqueConstraint("config_id", "date"),)


class EveningOTDate(Base):
    __tablename__ = "evening_ot_date"

    id = Column(Integer, primary_key=True)
    config_id = Column(Integer, ForeignKey("monthly_config.id"), nullable=False)
    date = Column(Date, nullable=False)

    config = relationship("MonthlyConfig", back_populates="evening_ot_dates")

    __table_args__ = (UniqueConstraint("config_id", "date"),)


# ── Call Assignments (output) ────────────────────────────────────────────

class CallAssignment(Base):
    __tablename__ = "call_assignment"

    id = Column(Integer, primary_key=True)
    config_id = Column(Integer, ForeignKey("monthly_config.id"), nullable=False)
    date = Column(Date, nullable=False)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=False)
    call_type = Column(String(20), nullable=False)
    is_manual_override = Column(Boolean, default=False)

    config = relationship("MonthlyConfig", back_populates="call_assignments")
    staff = relationship("Staff", back_populates="call_assignments")

    __table_args__ = (UniqueConstraint("config_id", "date", "call_type"),)


# ── OT Templates (weekly recurring) ─────────────────────────────────────

class OTTemplate(Base):
    __tablename__ = "ot_template"

    id = Column(Integer, primary_key=True)
    day_of_week = Column(Integer, nullable=False)
    room = Column(String(20), nullable=False)
    consultant_id = Column(Integer, ForeignKey("staff.id"), nullable=True)
    assistants_needed = Column(Integer, default=2)
    is_emergency = Column(Boolean, default=False)
    linked_call_slot = Column(String(50), nullable=True)
    color = Column(String(10), nullable=True)

    consultant = relationship("Staff")


# ── Clinic Templates (weekly recurring) ──────────────────────────────────

class ClinicTemplate(Base):
    __tablename__ = "clinic_template"

    id = Column(Integer, primary_key=True)
    day_of_week = Column(Integer, nullable=False)  # 0=Mon..4=Fri
    session = Column(SAEnum(Session), nullable=False)  # AM or PM
    room = Column(String(20), nullable=False)
    clinic_type = Column(String(20), default="Sup")
    mos_required = Column(Integer, default=1)
    consultant_id = Column(Integer, ForeignKey("staff.id"), nullable=True)
    color = Column(String(10), nullable=True)

    consultant = relationship("Staff")


# ── Duty Assignments (output) ────────────────────────────────────────────

class DutyAssignment(Base):
    __tablename__ = "duty_assignment"

    id = Column(Integer, primary_key=True)
    config_id = Column(Integer, ForeignKey("monthly_config.id"), nullable=False)
    date = Column(Date, nullable=False)
    staff_id = Column(Integer, ForeignKey("staff.id"), nullable=False)
    session = Column(SAEnum(Session), nullable=False)
    duty_type = Column(SAEnum(DutyType), nullable=False)
    location = Column(String(30), nullable=True)
    consultant_id = Column(Integer, ForeignKey("staff.id"), nullable=True)
    is_manual_override = Column(Boolean, default=False)

    config = relationship("MonthlyConfig", back_populates="duty_assignments")
    staff = relationship("Staff", foreign_keys=[staff_id])
    consultant = relationship("Staff", foreign_keys=[consultant_id])
