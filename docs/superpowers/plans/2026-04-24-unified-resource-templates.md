# Unified Resource Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `clinic_template` and `ot_template` tables into a single `resource_template` table, with a unified grid UI showing Clinic and OT as sub-columns within each day/session.

**Architecture:** New `ResourceTemplate` SQLAlchemy model replaces both old models. A data migration copies existing rows into the new table with a `resource_type` discriminator ("clinic" or "ot"). Frontend replaces two tab components with one `ResourceTemplatesTab` showing a single interleaved grid. The duty solver continues to receive `OTSlot` and `ClinicSlot` dataclasses — the router maps unified templates to these based on `resource_type`.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), React 19/TypeScript/Vite (frontend), SQLite

---

## File Structure

### Backend — Create
- `(none — all modifications to existing files)`

### Backend — Modify
- `backend/app/models.py` — Add `ResourceTemplate` model, keep old models temporarily for migration
- `backend/app/schemas.py` — Add `ResourceTemplateCreate` and `ResourceTemplateOut` schemas
- `backend/app/database.py` — Add migration to create `resource_template` table and copy data
- `backend/app/routers/duties.py` — Replace OT/Clinic template CRUD with unified resource CRUD; update `_build_duty_input` to query `ResourceTemplate`
- `backend/app/routers/staff.py` — Update staff delete cascade to use `ResourceTemplate`
- `backend/app/routers/roster.py` — Update `get_resources` to use `ResourceTemplate`

### Frontend — Create
- `frontend/src/pages/resources/ResourceTemplatesTab.tsx` — Unified grid + form component

### Frontend — Modify
- `frontend/src/types.ts` — Add `ResourceTemplate` interface
- `frontend/src/api.ts` — Replace clinic/OT API functions with unified resource API
- `frontend/src/pages/ResourcesView.tsx` — Replace two tabs with one
- `frontend/src/styles/app.css` — Update grid styles for two-column (Clinic/OT) layout

### Frontend — Delete
- `frontend/src/pages/resources/ClinicTemplatesTab.tsx`
- `frontend/src/pages/resources/OTTemplatesTab.tsx`

---

## Task 1: Backend Model & Migration

**Files:**
- Modify: `backend/app/models.py:302-336`
- Modify: `backend/app/database.py` (add migration block)

- [ ] **Step 1: Add ResourceTemplate model to models.py**

Add after the existing `ClinicTemplate` class (around line 336). Do NOT delete the old models yet — migration needs them.

```python
class ResourceTemplate(Base):
    __tablename__ = "resource_template"

    id = Column(Integer, primary_key=True)
    resource_type = Column(String(10), nullable=False)  # "clinic" or "ot"
    day_of_week = Column(Integer, nullable=False)
    session = Column(SAEnum(Session), nullable=False)
    room = Column(String(40), nullable=False)
    label = Column(String(40), default="")
    consultant_id = Column(Integer, ForeignKey("staff.id"), nullable=True)
    staff_required = Column(Integer, default=1)
    is_emergency = Column(Boolean, default=False)
    linked_manpower = Column(String(100), nullable=True)
    weeks = Column(String(20), nullable=True)  # e.g. "1,3,5" or null=every week
    color = Column(String(10), nullable=True)
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)

    consultant = relationship("Staff")
```

- [ ] **Step 2: Add data migration in database.py**

Add a new migration block inside the `_migrate(engine)` function. This creates the `resource_template` table and copies data from both old tables.

```python
    # ── Merge clinic_template + ot_template → resource_template ──────────
    insp = inspect(engine)
    if "resource_template" not in insp.get_table_names():
        from .models import ResourceTemplate
        ResourceTemplate.__table__.create(bind=engine)

        with SessionLocal() as s:
            # Migrate clinic templates
            for row in s.execute(text("SELECT * FROM clinic_template")).mappings():
                s.execute(text("""
                    INSERT INTO resource_template
                    (resource_type, day_of_week, session, room, label,
                     consultant_id, staff_required, is_emergency,
                     linked_manpower, weeks, color, is_active, sort_order)
                    VALUES ('clinic', :dow, :session, :room, :label,
                            :cons_id, :staff_req, 0,
                            NULL, NULL, :color, :is_active, 0)
                """), {
                    "dow": row["day_of_week"],
                    "session": row["session"],
                    "room": row["room"],
                    "label": row.get("clinic_type", "Sup") or "Sup",
                    "cons_id": row.get("consultant_id"),
                    "staff_req": row.get("mos_required", 1) or 1,
                    "color": row.get("color"),
                    "is_active": row.get("is_active", True),
                })

            # Migrate OT templates
            for row in s.execute(text("SELECT * FROM ot_template")).mappings():
                week_val = row.get("week_of_month")
                s.execute(text("""
                    INSERT INTO resource_template
                    (resource_type, day_of_week, session, room, label,
                     consultant_id, staff_required, is_emergency,
                     linked_manpower, weeks, color, is_active, sort_order)
                    VALUES ('ot', :dow, 'AM', :room, '',
                            :cons_id, :staff_req, :is_emerg,
                            :linked, :weeks, :color, :is_active, 0)
                """), {
                    "dow": row["day_of_week"],
                    "room": row["room"],
                    "cons_id": row.get("consultant_id"),
                    "staff_req": row.get("assistants_needed", 2) or 2,
                    "is_emerg": row.get("is_emergency", False),
                    "linked": row.get("linked_call_slot"),
                    "weeks": str(week_val) if week_val is not None else None,
                    "color": row.get("color"),
                    "is_active": row.get("is_active", True),
                })
            s.commit()
```

- [ ] **Step 3: Verify migration runs**

Start the backend and confirm the table is created with migrated data:

```bash
cd backend && venv/Scripts/python.exe -c "from app.database import init_db; init_db(); from app.database import SessionLocal; s=SessionLocal(); print(s.execute(__import__('sqlalchemy').text('SELECT COUNT(*) FROM resource_template')).scalar())"
```

Expected: a number equal to the sum of rows in `clinic_template` + `ot_template` (currently 84 + 39 = 123).

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/app/database.py
git commit -m "feat: add ResourceTemplate model and data migration from clinic+OT tables"
```

---

## Task 2: Backend Schema & API

**Files:**
- Modify: `backend/app/schemas.py:255-311`
- Modify: `backend/app/routers/duties.py:1-145`

- [ ] **Step 1: Add unified schemas to schemas.py**

Add after the existing OT/Clinic schemas (keep old ones temporarily — the solver code still references them until Task 3):

```python
class ResourceTemplateCreate(BaseModel):
    resource_type: str  # "clinic" or "ot"
    day_of_week: int
    session: Session
    room: str
    label: str = ""
    consultant_id: Optional[int] = None
    staff_required: int = 1
    is_emergency: bool = False
    linked_manpower: Optional[str] = None
    weeks: Optional[str] = None
    color: Optional[str] = None
    is_active: bool = True
    sort_order: int = 0


class ResourceTemplateOut(BaseModel):
    id: int
    resource_type: str
    day_of_week: int
    session: Session
    room: str
    label: str
    consultant_id: Optional[int]
    consultant_name: Optional[str] = None
    staff_required: int
    is_emergency: bool
    linked_manpower: Optional[str] = None
    weeks: Optional[str] = None
    color: Optional[str] = None
    is_active: bool = True
    sort_order: int = 0

    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Replace OT/Clinic CRUD in duties.py with unified resource CRUD**

Replace lines 29–145 (the OT Templates and Clinic Templates sections) with:

```python
# ── Resource Templates ──────────────────────────────────────────────────

def _resource_out(r: ResourceTemplate) -> ResourceTemplateOut:
    return ResourceTemplateOut(
        id=r.id,
        resource_type=r.resource_type,
        day_of_week=r.day_of_week,
        session=r.session,
        room=r.room,
        label=r.label or "",
        consultant_id=r.consultant_id,
        consultant_name=r.consultant.name if r.consultant else None,
        staff_required=r.staff_required if r.staff_required is not None else 1,
        is_emergency=r.is_emergency or False,
        linked_manpower=r.linked_manpower,
        weeks=r.weeks,
        color=r.color,
        is_active=r.is_active if r.is_active is not None else True,
        sort_order=r.sort_order or 0,
    )


@router.get("/templates/resources", response_model=list[ResourceTemplateOut])
def list_resource_templates(db: DBSession = Depends(get_db)):
    rows = (
        db.query(ResourceTemplate)
        .order_by(ResourceTemplate.day_of_week, ResourceTemplate.session, ResourceTemplate.sort_order, ResourceTemplate.room)
        .all()
    )
    return [_resource_out(r) for r in rows]


@router.post("/templates/resources", response_model=ResourceTemplateOut)
def create_resource_template(payload: ResourceTemplateCreate, db: DBSession = Depends(get_db)):
    t = ResourceTemplate(**payload.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return _resource_out(t)


@router.put("/templates/resources/{template_id}", response_model=ResourceTemplateOut)
def update_resource_template(template_id: int, payload: ResourceTemplateCreate, db: DBSession = Depends(get_db)):
    t = db.query(ResourceTemplate).get(template_id)
    if not t:
        raise HTTPException(404)
    for k, v in payload.model_dump().items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return _resource_out(t)


@router.delete("/templates/resources/{template_id}")
def delete_resource_template(template_id: int, db: DBSession = Depends(get_db)):
    t = db.query(ResourceTemplate).get(template_id)
    if not t:
        raise HTTPException(404)
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.post("/templates/resources/{template_id}/duplicate", response_model=ResourceTemplateOut)
def duplicate_resource_template(template_id: int, db: DBSession = Depends(get_db)):
    src = db.query(ResourceTemplate).get(template_id)
    if not src:
        raise HTTPException(404)
    dup = ResourceTemplate(
        resource_type=src.resource_type,
        day_of_week=src.day_of_week,
        session=src.session,
        room=src.room,
        label=src.label,
        consultant_id=src.consultant_id,
        staff_required=src.staff_required,
        is_emergency=src.is_emergency,
        linked_manpower=src.linked_manpower,
        weeks=src.weeks,
        color=src.color,
        is_active=src.is_active,
        sort_order=(src.sort_order or 0) + 1,
    )
    db.add(dup)
    db.commit()
    db.refresh(dup)
    return _resource_out(dup)


@router.put("/templates/resources/reorder")
def reorder_resource_templates(updates: list[dict], db: DBSession = Depends(get_db)):
    for u in updates:
        t = db.query(ResourceTemplate).get(u["id"])
        if t:
            t.sort_order = u["sort_order"]
            if "day_of_week" in u:
                t.day_of_week = u["day_of_week"]
            if "session" in u:
                t.session = u["session"]
    db.commit()
    return {"ok": True}
```

- [ ] **Step 3: Update imports in duties.py**

At the top of the file, update the imports:

Replace:
```python
from ..models import (
    MonthlyConfig, CallAssignment, DutyAssignment, Staff, TeamAssignment,
    OTTemplate, ClinicTemplate, Leave, PublicHoliday,
    ConsultantOnCall, ACOnCall,
    DutyType, Session, CallTypeConfig, RankConfig,
)
from ..schemas import (
    DutyRosterResponse, DayDutyRoster, DutyAssignmentOut,
    OTTemplateCreate, OTTemplateOut, ClinicTemplateCreate, ClinicTemplateOut,
    DutyOverrideCreate,
)
```

With:
```python
from ..models import (
    MonthlyConfig, CallAssignment, DutyAssignment, Staff, TeamAssignment,
    ResourceTemplate, Leave, PublicHoliday,
    ConsultantOnCall, ACOnCall,
    DutyType, Session, CallTypeConfig, RankConfig,
)
from ..schemas import (
    DutyRosterResponse, DayDutyRoster, DutyAssignmentOut,
    ResourceTemplateCreate, ResourceTemplateOut,
    DutyOverrideCreate,
)
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/duties.py
git commit -m "feat: unified resource template CRUD API with duplicate and reorder endpoints"
```

---

## Task 3: Update Duty Solver Integration

**Files:**
- Modify: `backend/app/routers/duties.py:180-290` (the `_build_duty_input` function)
- Modify: `backend/app/routers/duties.py:384-386` (the `clinic_type_lookup`)

- [ ] **Step 1: Update `_build_duty_input` to query ResourceTemplate**

Replace lines 182-191 (the template queries and grouping):

```python
    all_templates = db.query(ResourceTemplate).filter(ResourceTemplate.is_active.is_(True)).all()

    ot_by_dow_week: dict[tuple[int, int | None], list[ResourceTemplate]] = defaultdict(list)
    clinic_by_dow_session: dict[tuple[int, str], list[ResourceTemplate]] = defaultdict(list)
    for t in all_templates:
        if t.resource_type == "ot":
            if t.weeks:
                for w in t.weeks.split(","):
                    ot_by_dow_week[(t.day_of_week, int(w.strip()))].append(t)
            else:
                ot_by_dow_week[(t.day_of_week, None)].append(t)
        else:
            clinic_by_dow_session[(t.day_of_week, t.session.value)].append(t)
```

- [ ] **Step 2: Update OTSlot construction (lines ~246-264)**

Replace the OTSlot building loop to read from `ResourceTemplate` fields:

```python
        ot_slots = []
        for t in day_ot_templates:
            if t.is_emergency:
                ot_slots.append(OTSlot(
                    room=t.room,
                    consultant_id=t.consultant_id,
                    consultant_team_id=consultant_team.get(t.consultant_id) if t.consultant_id else None,
                    assistants_needed=t.staff_required,
                    registrar_needed=0,
                    is_emergency=True,
                    linked_call_slot=t.linked_manpower,
                ))
            elif not is_wknd and not is_ph:
                ot_slots.append(OTSlot(
                    room=t.room,
                    consultant_id=t.consultant_id,
                    consultant_team_id=consultant_team.get(t.consultant_id) if t.consultant_id else None,
                    assistants_needed=t.staff_required,
                    registrar_needed=0,
                ))
```

- [ ] **Step 3: Update ClinicSlot construction (lines ~266-284)**

Replace the ClinicSlot building loop:

```python
        am_clinics = []
        pm_clinics = []
        if not is_wknd and not is_ph:
            for t in clinic_by_dow_session.get((dow, Session.AM.value), []):
                am_clinics.append(ClinicSlot(
                    room=t.room, session=Session.AM,
                    clinic_type=t.label or "Sup",
                    mos_required=t.staff_required if t.staff_required is not None else 1,
                    consultant_id=t.consultant_id,
                    consultant_team_id=consultant_team.get(t.consultant_id) if t.consultant_id else None,
                ))
            for t in clinic_by_dow_session.get((dow, Session.PM.value), []):
                pm_clinics.append(ClinicSlot(
                    room=t.room, session=Session.PM,
                    clinic_type=t.label or "Sup",
                    mos_required=t.staff_required if t.staff_required is not None else 1,
                    consultant_id=t.consultant_id,
                    consultant_team_id=consultant_team.get(t.consultant_id) if t.consultant_id else None,
                ))
```

- [ ] **Step 4: Update `clinic_type_lookup` (around line 384-386)**

Replace:
```python
    clinic_type_lookup: dict[tuple[str, str], str] = {}
    for ct in db.query(ClinicTemplate).all():
        clinic_type_lookup[(ct.room, ct.session.value)] = ct.clinic_type or "Sup"
```

With:
```python
    clinic_type_lookup: dict[tuple[str, str], str] = {}
    for ct in db.query(ResourceTemplate).filter(ResourceTemplate.resource_type == "clinic").all():
        clinic_type_lookup[(ct.room, ct.session.value)] = ct.label or "Sup"
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/duties.py
git commit -m "feat: update duty solver to use unified ResourceTemplate"
```

---

## Task 4: Update Staff & Roster Routers

**Files:**
- Modify: `backend/app/routers/staff.py:86-96`
- Modify: `backend/app/routers/roster.py:13,398-468`

- [ ] **Step 1: Update staff.py delete cascade**

In `delete_staff()` (line 86-96), replace:

```python
    from ..models import (
        ConsultantOnCall, ACOnCall, RegistrarDuty,
        DutyAssignment, OTTemplate, ClinicTemplate,
    )
```

With:

```python
    from ..models import (
        ConsultantOnCall, ACOnCall, RegistrarDuty,
        DutyAssignment, ResourceTemplate,
    )
```

And replace lines 95-96:

```python
    db.query(OTTemplate).filter(OTTemplate.consultant_id == staff_id).delete()
    db.query(ClinicTemplate).filter(ClinicTemplate.consultant_id == staff_id).delete()
```

With:

```python
    db.query(ResourceTemplate).filter(ResourceTemplate.consultant_id == staff_id).delete()
```

- [ ] **Step 2: Update roster.py get_resources**

At the import (line 13), replace `OTTemplate, ClinicTemplate` with `ResourceTemplate`.

In `get_resources()` (lines 398-468), replace the template queries:

```python
    ot_templates = db.query(OTTemplate).all()
    clinic_templates = db.query(ClinicTemplate).all()
```

With:

```python
    all_templates = db.query(ResourceTemplate).all()
    ot_templates = [t for t in all_templates if t.resource_type == "ot"]
    clinic_templates = [t for t in all_templates if t.resource_type == "clinic"]
```

And update the resource counting loop (lines 458-468) to use unified field names:

```python
        if not is_wknd and not is_ph:
            for ot in ot_templates:
                if ot.day_of_week == dow:
                    ot_rooms += 1
                    ot_assistants += ot.staff_required
            for cl in clinic_templates:
                if cl.day_of_week == dow:
                    ct = cl.label or "Sup"
                    if ct == "MOPD":
                        clinic_mopd += 1
                    elif (cl.staff_required or 0) > 0:
                        clinic_sup += 1
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/staff.py backend/app/routers/roster.py
git commit -m "feat: update staff delete cascade and roster resources to use ResourceTemplate"
```

---

## Task 5: Frontend Types & API

**Files:**
- Modify: `frontend/src/types.ts:138-164`
- Modify: `frontend/src/api.ts:167-184`

- [ ] **Step 1: Add ResourceTemplate type to types.ts**

Replace the `OTTemplate` and `ClinicTemplate` interfaces (lines 138-164) with:

```typescript
export interface ResourceTemplate {
  id: number;
  resource_type: "clinic" | "ot";
  day_of_week: number;
  session: string;
  room: string;
  label: string;
  consultant_id: number | null;
  consultant_name: string | null;
  staff_required: number;
  is_emergency: boolean;
  linked_manpower: string | null;
  weeks: string | null;
  color: string | null;
  is_active: boolean;
  sort_order: number;
}
```

- [ ] **Step 2: Replace API functions in api.ts**

Replace the OT and Clinic template API functions (lines 167-184) with:

```typescript
  getResourceTemplates: () =>
    request<import("./types").ResourceTemplate[]>("/templates/resources"),
  createResourceTemplate: (data: Omit<import("./types").ResourceTemplate, "id" | "consultant_name">) =>
    request<import("./types").ResourceTemplate>("/templates/resources", { method: "POST", body: JSON.stringify(data) }),
  updateResourceTemplate: (id: number, data: Omit<import("./types").ResourceTemplate, "id" | "consultant_name">) =>
    request<import("./types").ResourceTemplate>(`/templates/resources/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteResourceTemplate: (id: number) =>
    request<{ ok: boolean }>(`/templates/resources/${id}`, { method: "DELETE" }),
  duplicateResourceTemplate: (id: number) =>
    request<import("./types").ResourceTemplate>(`/templates/resources/${id}/duplicate`, { method: "POST" }),
  reorderResourceTemplates: (updates: { id: number; sort_order: number; day_of_week?: number; session?: string }[]) =>
    request<{ ok: boolean }>("/templates/resources/reorder", { method: "PUT", body: JSON.stringify(updates) }),
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat: add unified ResourceTemplate type and API functions"
```

---

## Task 6: Frontend Grid Component

**Files:**
- Create: `frontend/src/pages/resources/ResourceTemplatesTab.tsx`

This is the largest task — the unified grid with interleaved Clinic/OT sub-columns.

- [ ] **Step 1: Create ResourceTemplatesTab.tsx**

```tsx
import { useEffect, useState, type DragEvent } from "react";
import { api } from "../../api";
import type { ResourceTemplate, Staff, CallTypeConfig } from "../../types";
import { DAY_NAMES, CONS_RANKS, COLOR_PRESETS } from "./constants";

const SESSIONS = ["AM", "PM"] as const;

export default function ResourceTemplatesTab() {
  const [templates, setTemplates] = useState<ResourceTemplate[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [callTypes, setCallTypes] = useState<CallTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [dragItem, setDragItem] = useState<{ id: number; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getResourceTemplates(), api.getStaff(), api.getCallTypes()]).then(([t, s, ct]) => {
      setTemplates(t);
      setStaff(s);
      setCallTypes(ct);
      setLoading(false);
    });
  }, []);

  const consultants = staff.filter((s) => CONS_RANKS.includes(s.rank));

  async function handleAdd(data: any) {
    try {
      const t = await api.createResourceTemplate(data);
      setTemplates((prev) => [...prev, t]);
      setShowAdd(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to add resource.");
    }
  }

  async function handleUpdate(id: number, data: any) {
    try {
      const t = await api.updateResourceTemplate(id, data);
      setTemplates((prev) => prev.map((x) => (x.id === id ? t : x)));
      setEditId(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to update resource.");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this resource?")) return;
    try {
      await api.deleteResourceTemplate(id);
      setTemplates((prev) => prev.filter((x) => x.id !== id));
      setEditId(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to delete resource.");
    }
  }

  async function handleDuplicate(id: number) {
    try {
      const t = await api.duplicateResourceTemplate(id);
      setTemplates((prev) => [...prev, t]);
    } catch (e: any) {
      setError(e?.message ?? "Failed to duplicate resource.");
    }
  }

  async function handleDrop(e: DragEvent, targetDow: number, targetSession: string, targetType: string) {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("text/plain"));
    if (!id) return;
    const tmpl = templates.find((t) => t.id === id);
    if (!tmpl) { setDragItem(null); return; }
    if (tmpl.resource_type !== targetType) { setDragItem(null); return; }
    if (tmpl.day_of_week === targetDow && tmpl.session === targetSession) {
      setDragItem(null);
      return;
    }
    await handleUpdate(id, {
      ...tmpl,
      day_of_week: targetDow,
      session: targetSession,
    });
    setDragItem(null);
  }

  async function handleReorder(cellTemplates: ResourceTemplate[], draggedId: number, targetIndex: number) {
    const ordered = [...cellTemplates];
    const fromIdx = ordered.findIndex((t) => t.id === draggedId);
    if (fromIdx === -1) return;
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(targetIndex, 0, moved);
    const updates = ordered.map((t, i) => ({ id: t.id, sort_order: i }));
    try {
      await api.reorderResourceTemplates(updates);
      setTemplates((prev) => {
        const next = [...prev];
        for (const u of updates) {
          const idx = next.findIndex((t) => t.id === u.id);
          if (idx !== -1) next[idx] = { ...next[idx], sort_order: u.sort_order };
        }
        return next;
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to reorder.");
    }
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  // Build grid: [day][session][type] → sorted templates
  const grid: Record<string, Record<string, Record<string, ResourceTemplate[]>>> = {};
  for (const day of DAY_NAMES) {
    grid[day] = {};
    for (const sess of SESSIONS) {
      grid[day][sess] = { clinic: [], ot: [] };
    }
  }
  for (const t of templates) {
    if (t.day_of_week >= 0 && t.day_of_week < 7) {
      const dayKey = DAY_NAMES[t.day_of_week];
      const sess = t.session === "PM" ? "PM" : "AM";
      grid[dayKey][sess][t.resource_type].push(t);
    }
  }
  for (const day of DAY_NAMES) {
    for (const sess of SESSIONS) {
      for (const type of ["clinic", "ot"]) {
        grid[day][sess][type].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      }
    }
  }

  const editTemplate = editId != null ? templates.find((t) => t.id === editId) : null;

  return (
    <>
      {error && (
        <div style={{
          background: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5",
          borderRadius: 6, padding: "8px 14px", marginBottom: 12, display: "flex",
          alignItems: "center", justifyContent: "space-between",
        }}>
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{ background: "none", border: "none", cursor: "pointer", fontWeight: 700, color: "#b91c1c" }}
          >✕</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Resource</button>
      </div>

      <div className="resource-grid-container">
        <table className="resource-grid">
          <thead>
            <tr>
              <th style={{ width: 50 }}></th>
              {DAY_NAMES.map((d) => (
                <th key={d} colSpan={2}>{d}</th>
              ))}
            </tr>
            <tr>
              <th></th>
              {DAY_NAMES.map((d) => (
                <Fragment key={d}>
                  <th className="sub-col-header">Clinic</th>
                  <th className="sub-col-header">OT</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {SESSIONS.map((sess) => (
              <tr key={sess}>
                <td className="session-label">{sess}</td>
                {DAY_NAMES.map((day, dow) => (
                  <Fragment key={`${day}-${sess}`}>
                    {(["clinic", "ot"] as const).map((type) => (
                      <td
                        key={`${day}-${sess}-${type}`}
                        className={`resource-cell ${dragItem && dragItem.type === type ? "drop-highlight" : ""}`}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                        onDrop={(e) => handleDrop(e, dow, sess, type)}
                      >
                        {grid[day][sess][type].map((t, idx) => (
                          <ResourceCard
                            key={t.id}
                            template={t}
                            isDragging={dragItem?.id === t.id}
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", String(t.id));
                              setDragItem({ id: t.id, type: t.resource_type });
                            }}
                            onDragEnd={() => setDragItem(null)}
                            onClick={() => setEditId(t.id)}
                            onDuplicate={() => handleDuplicate(t.id)}
                          />
                        ))}
                      </td>
                    ))}
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <ResourceFormModal
          title="Add Resource"
          consultants={consultants}
          callSlotNames={callTypes.filter((c) => c.is_active).map((c) => c.name)}
          onSave={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}
      {editTemplate && (
        <ResourceFormModal
          title="Edit Resource"
          consultants={consultants}
          callSlotNames={callTypes.filter((c) => c.is_active).map((c) => c.name)}
          initial={editTemplate}
          onSave={(data) => handleUpdate(editTemplate.id, data)}
          onClose={() => setEditId(null)}
          onDelete={() => handleDelete(editTemplate.id)}
        />
      )}
    </>
  );
}


function ResourceCard({
  template: t,
  isDragging,
  onDragStart,
  onDragEnd,
  onClick,
  onDuplicate,
}: {
  template: ResourceTemplate;
  isDragging: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onClick: () => void;
  onDuplicate: () => void;
}) {
  const defaultColor = t.resource_type === "ot"
    ? (t.is_emergency ? "#fef3c7" : "#dbeafe")
    : "#f8f9fa";
  const bg = t.color ?? defaultColor;

  return (
    <div
      className={`resource-card ${isDragging ? "dragging" : ""}`}
      style={{ backgroundColor: bg, opacity: t.is_active === false ? 0.45 : 1 }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      <div className="resource-card-header">
        <span className="resource-card-label">
          {t.is_emergency ? "⚡ " : ""}
          {t.label || t.room}
        </span>
        <button
          className="resource-card-dup"
          title="Duplicate"
          onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
        >⧉</button>
      </div>
      <div className="resource-card-room">{t.label ? t.room : ""}</div>
      <div className="resource-card-cons">
        {t.is_emergency
          ? (t.linked_manpower ? `→ ${t.linked_manpower}` : "Emergency")
          : (t.consultant_name ?? "")}
      </div>
      {t.staff_required > 0 && (
        <div className="resource-card-staff">{t.staff_required} staff</div>
      )}
      {t.weeks && (
        <span className="resource-card-weeks">
          Wk {t.weeks}
        </span>
      )}
    </div>
  );
}


function ResourceFormModal({
  title, consultants, callSlotNames, initial, onSave, onClose, onDelete,
}: {
  title: string;
  consultants: Staff[];
  callSlotNames: string[];
  initial?: ResourceTemplate;
  onSave: (data: any) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [resourceType, setResourceType] = useState<"clinic" | "ot">(initial?.resource_type ?? "clinic");
  const [dow, setDow] = useState(initial?.day_of_week ?? 0);
  const [session, setSession] = useState(initial?.session ?? "AM");
  const [room, setRoom] = useState(initial?.room ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [consId, setConsId] = useState<number | null>(initial?.consultant_id ?? null);
  const [staffRequired, setStaffRequired] = useState(initial?.staff_required ?? 1);
  const [isEmergency, setIsEmergency] = useState(initial?.is_emergency ?? false);
  const [linkedSlots, setLinkedSlots] = useState<string[]>(
    initial?.linked_manpower ? initial.linked_manpower.split(",").map((s) => s.trim()).filter(Boolean) : []
  );
  const [selectedWeeks, setSelectedWeeks] = useState<number[]>(
    initial?.weeks ? initial.weeks.split(",").map((w) => parseInt(w.trim())).filter((n) => !isNaN(n)) : []
  );
  const [color, setColor] = useState<string | null>(initial?.color ?? null);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  const isOT = resourceType === "ot";
  const isClinic = resourceType === "clinic";

  function toggleWeek(w: number) {
    setSelectedWeeks((prev) =>
      prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w].sort()
    );
  }

  function toggleSlot(slot: string) {
    setLinkedSlots((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>

        {/* Resource Type toggle */}
        <div className="form-group">
          <label>Type</label>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              className={`btn ${isClinic ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1 }}
              onClick={() => setResourceType("clinic")}
            >Clinic</button>
            <button
              className={`btn ${isOT ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1 }}
              onClick={() => setResourceType("ot")}
            >OT</button>
          </div>
        </div>

        <div className="form-group">
          <label>Day</label>
          <select value={dow} onChange={(e) => setDow(Number(e.target.value))}>
            {DAY_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Session</label>
          <select value={session} onChange={(e) => setSession(e.target.value)}>
            {SESSIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Room</label>
          <input type="text" value={room} onChange={(e) => setRoom(e.target.value)}
            placeholder={isOT ? "e.g. OT1, EOT" : "e.g. 4E-Rm3"} />
        </div>

        {/* Label — greyed out for OT */}
        <div className="form-group" style={{ opacity: isOT ? 0.4 : 1 }}>
          <label>Resource Label</label>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. NC, Sup, MOPD, Trauma"
            disabled={isOT} />
        </div>

        {/* Consultant — greyed out when emergency */}
        <div className="form-group" style={{ opacity: isEmergency ? 0.4 : 1 }}>
          <label>Consultant</label>
          <select value={consId ?? ""} onChange={(e) => setConsId(e.target.value ? Number(e.target.value) : null)}
            disabled={isEmergency}>
            <option value="">— None —</option>
            {consultants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Staff Required</label>
          <input type="number" min={0} max={10} value={staffRequired}
            onChange={(e) => setStaffRequired(Number(e.target.value))} />
        </div>

        {/* Emergency — greyed out for clinic */}
        <div className="form-group" style={{ opacity: isClinic ? 0.4 : 1 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={isEmergency}
              disabled={isClinic}
              onChange={(e) => {
                setIsEmergency(e.target.checked);
                if (e.target.checked) setConsId(null);
              }} />
            Emergency (24h, no fixed consultant)
          </label>
        </div>

        {/* Weeks */}
        <div className="form-group">
          <label>Weeks (none = every week)</label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            {[1, 2, 3, 4, 5].map((w) => (
              <label key={w} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input type="checkbox" checked={selectedWeeks.includes(w)} onChange={() => toggleWeek(w)} />
                Wk{w}
              </label>
            ))}
          </div>
        </div>

        {/* Linked Manpower */}
        <div className="form-group">
          <label>Linked Manpower</label>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
            {callSlotNames.length === 0 && <span style={{ color: "#999", fontSize: 12 }}>No call types configured</span>}
            {callSlotNames.map((slot) => (
              <label key={slot} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input type="checkbox" checked={linkedSlots.includes(slot)} onChange={() => toggleSlot(slot)} />
                {slot}
              </label>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        </div>

        <div className="form-group">
          <label>Card Colour</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 28px)", gap: 4, marginTop: 4 }}>
            <div
              onClick={() => setColor(null)}
              title="Reset to default"
              style={{
                width: 28, height: 28, borderRadius: 4, cursor: "pointer",
                background: "linear-gradient(135deg, #fff 45%, #f00 45%, #f00 55%, #fff 55%)",
                border: color === null ? "2px solid var(--primary)" : "1px solid #ccc",
              }}
            />
            {COLOR_PRESETS.map((c) => (
              <div
                key={c}
                title={c}
                onClick={() => setColor(c)}
                style={{
                  width: 28, height: 28, borderRadius: 4, backgroundColor: c, cursor: "pointer",
                  border: color === c ? "2px solid var(--primary)" : "1px solid #ccc",
                }}
              />
            ))}
          </div>
        </div>

        <div className="modal-actions">
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete} style={{ marginRight: "auto" }}>Delete</button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (room.trim()) {
                onSave({
                  resource_type: resourceType,
                  day_of_week: dow,
                  session,
                  room: room.trim(),
                  label: isOT ? "" : label.trim(),
                  consultant_id: isEmergency ? null : consId,
                  staff_required: staffRequired,
                  is_emergency: isOT ? isEmergency : false,
                  linked_manpower: linkedSlots.length > 0 ? linkedSlots.join(",") : null,
                  weeks: selectedWeeks.length > 0 ? selectedWeeks.join(",") : null,
                  color,
                  is_active: isActive,
                  sort_order: initial?.sort_order ?? 0,
                });
              }
            }}
          >Save</button>
        </div>
      </div>
    </div>
  );
}
```

Note: add `import { Fragment } from "react";` at the top alongside the other react imports.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/resources/ResourceTemplatesTab.tsx
git commit -m "feat: unified ResourceTemplatesTab with interleaved grid, duplicate, and drag-drop"
```

---

## Task 7: Update ResourcesView & CSS

**Files:**
- Modify: `frontend/src/pages/ResourcesView.tsx`
- Modify: `frontend/src/styles/app.css:722-810`
- Delete: `frontend/src/pages/resources/ClinicTemplatesTab.tsx`
- Delete: `frontend/src/pages/resources/OTTemplatesTab.tsx`

- [ ] **Step 1: Update ResourcesView.tsx**

Replace the full file:

```tsx
import { useState } from "react";
import { useConfig } from "../context/ConfigContext";
import SupplyDemandTab from "./resources/SupplyDemandTab";
import ResourceTemplatesTab from "./resources/ResourceTemplatesTab";
import ConsultantRosterTab from "./resources/ConsultantRosterTab";
import RegistrarRosterTab from "./resources/RegistrarRosterTab";

const TABS = [
  { key: "supply", label: "Supply / Demand", needsConfig: true },
  { key: "resources", label: "Resources", needsConfig: false },
  { key: "consultant", label: "Consultant Roster", needsConfig: true },
  { key: "registrar", label: "Registrar Roster", needsConfig: true },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default function ResourcesView() {
  const { active } = useConfig();
  const [tab, setTab] = useState<TabKey>("supply");

  const currentTab = TABS.find((t) => t.key === tab)!;
  const needsConfig = currentTab.needsConfig && !active;

  return (
    <>
      <div className="page-header">
        <h2>Resources {active ? `- ${MONTH_NAMES[active.month]} ${active.year}` : ""}</h2>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {needsConfig ? (
        <p style={{ color: "var(--text-muted)" }}>Select a month in the sidebar to configure this tab.</p>
      ) : (
        <>
          {tab === "supply" && active && <SupplyDemandTab configId={active.id} />}
          {tab === "resources" && <ResourceTemplatesTab />}
          {tab === "consultant" && active && (
            <ConsultantRosterTab configId={active.id} year={active.year} month={active.month} />
          )}
          {tab === "registrar" && active && (
            <RegistrarRosterTab configId={active.id} year={active.year} month={active.month} />
          )}
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: Update CSS for new grid layout**

Replace the clinic-grid styles (lines 722-810 in app.css) with:

```css
/* ── Resource Grid ────────────────────────────────────────────────────── */
.resource-grid-container {
  overflow-x: auto;
}

.resource-grid {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.resource-grid th {
  text-align: center;
  padding: 8px 4px;
  background: #f0f1f5;
  font-weight: 600;
  font-size: 14px;
  border: 1px solid var(--border);
}

.resource-grid th.sub-col-header {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  padding: 4px;
  background: #f7f8fa;
}

.resource-grid .session-label {
  text-align: center;
  font-weight: 700;
  font-size: 13px;
  color: var(--text-muted);
  vertical-align: top;
  padding-top: 12px;
  width: 50px;
}

.resource-cell {
  vertical-align: top;
  padding: 4px;
  min-height: 80px;
  border: 1px solid var(--border);
  white-space: normal;
}

.resource-cell.drop-highlight {
  background: #f0f4ff;
}

.resource-card {
  border: 1px solid #ccc;
  border-radius: 6px;
  padding: 4px 6px;
  margin-bottom: 3px;
  cursor: grab;
  transition: box-shadow 0.15s, transform 0.1s;
  font-size: 10px;
  line-height: 1.4;
  position: relative;
}

.resource-card:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  transform: translateY(-1px);
}

.resource-card.dragging {
  opacity: 0.4;
}

.resource-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.resource-card-label {
  font-weight: 700;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.resource-card-room {
  font-size: 10px;
  color: var(--text);
}

.resource-card-cons {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.resource-card-staff {
  font-size: 10px;
  font-weight: 600;
  color: var(--primary);
}

.resource-card-weeks {
  font-size: 9px;
  color: #6b7280;
  font-style: italic;
}

.resource-card-dup {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: #aaa;
  padding: 0 2px;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.15s;
}

.resource-card:hover .resource-card-dup {
  opacity: 1;
}

.resource-card-dup:hover {
  color: var(--primary);
}
```

- [ ] **Step 3: Delete old tab components**

```bash
rm frontend/src/pages/resources/ClinicTemplatesTab.tsx
rm frontend/src/pages/resources/OTTemplatesTab.tsx
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ResourcesView.tsx frontend/src/styles/app.css
git add frontend/src/pages/resources/ResourceTemplatesTab.tsx
git rm frontend/src/pages/resources/ClinicTemplatesTab.tsx
git rm frontend/src/pages/resources/OTTemplatesTab.tsx
git commit -m "feat: unified resource grid with Clinic/OT sub-columns, replacing separate tabs"
```

---

## Task 8: Clean Up Old Models

**Files:**
- Modify: `backend/app/models.py` — Remove `OTTemplate` and `ClinicTemplate` classes

- [ ] **Step 1: Remove old model classes from models.py**

Delete the `OTTemplate` class (lines 302-318) and `ClinicTemplate` class (lines 322-336).

- [ ] **Step 2: Remove old schemas from schemas.py**

Delete `OTTemplateCreate` (lines 255-266), `OTTemplateOut` (lines 268-283), `ClinicTemplateCreate` (lines 287-296), and `ClinicTemplateOut` (lines 298-311).

- [ ] **Step 3: Verify no remaining references**

```bash
cd backend && grep -rn "OTTemplate\|ClinicTemplate\|clinic_template\|ot_template" app/ --include="*.py" | grep -v "__pycache__" | grep -v "resource_template"
```

Expected: no matches (except possibly migration code in database.py which reads from old tables — that's fine, it only runs once).

```bash
cd frontend && grep -rn "OTTemplate\|ClinicTemplate\|getOTTemplates\|getClinicTemplates\|OTTemplatesTab\|ClinicTemplatesTab" src/ --include="*.ts" --include="*.tsx"
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py backend/app/schemas.py
git commit -m "chore: remove old OTTemplate and ClinicTemplate models and schemas"
```

---

## Task 9: Manual Testing

- [ ] **Step 1: Start backend and frontend**

Run `start.bat` or start manually:
```bash
cd backend && venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --reload
```
```bash
cd frontend && npx vite --host 127.0.0.1
```

- [ ] **Step 2: Verify migrated data appears**

Open http://127.0.0.1:5173, go to Resources tab → Resources sub-tab. Confirm:
- All previously existing clinic templates appear in Clinic columns
- All previously existing OT templates appear in OT columns
- Cards show correct labels, rooms, consultants, staff counts

- [ ] **Step 3: Test CRUD operations**

1. Click "+ Add Resource" → set type to Clinic → fill fields → Save → card appears in correct cell
2. Click "+ Add Resource" → set type to OT → fill fields → Save → card appears in OT column
3. Click a card → edit modal opens with correct data → change a field → Save → card updates
4. Click a card → Delete → confirm → card removed
5. Click duplicate icon on a card → new card appears with same data

- [ ] **Step 4: Test drag and drop**

1. Drag a clinic card from Mon/AM to Wed/PM → card moves to new cell
2. Drag an OT card from Tue/AM to Thu/PM → card moves
3. Try dragging a clinic card into an OT cell → should NOT move (type mismatch)

- [ ] **Step 5: Test form field greying**

1. Set type to Clinic → "Emergency" checkbox is greyed out, "Resource Label" is active
2. Set type to OT → "Resource Label" is greyed out, "Emergency" is active
3. Check Emergency → Consultant dropdown is greyed out

- [ ] **Step 6: Test weeks**

1. Add a resource with Wk1 and Wk3 ticked → card shows "Wk 1,3"
2. Edit it → checkboxes for Wk1 and Wk3 are pre-checked

- [ ] **Step 7: Test duty generation still works**

Navigate to Duties tab → Generate → confirm duties are generated without errors. Spot-check that OT and clinic assignments appear correctly.
