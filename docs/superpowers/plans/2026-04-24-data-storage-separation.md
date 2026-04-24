# Data Storage Separation & Change Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add change-tracking timestamps to all major entities (resources, staff, rosters) so the frontend can display "last updated" dates. Keep the single SQLite database but add `updated_at` columns across tables with automatic update on modification.

**Architecture:** Add `updated_at` columns (with default `CURRENT_TIMESTAMP`) to the key tables. Track the latest modification timestamp per category (resources, staff, monthly roster) and expose it via API endpoints. The frontend displays these timestamps on relevant pages. This is a simpler, more pragmatic approach than splitting into separate databases — SQLite handles concurrent reads well, and OneDrive sync conflicts are better solved at the application layer than by splitting files.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), React 19/TypeScript (frontend), SQLite

---

## File Structure

### Backend — Modify
- `backend/app/models.py` — Add `updated_at` columns to key models
- `backend/app/database.py` — Add migration for new columns
- `backend/app/routers/duties.py` — Touch `updated_at` on resource template CRUD
- `backend/app/routers/staff.py` — Touch `updated_at` on staff CRUD
- `backend/app/routers/monthly_config.py` — Touch `updated_at` on roster save operations
- `backend/app/routers/roster.py` — Add endpoint to get last-modified timestamps

### Frontend — Modify
- `frontend/src/api.ts` — Add API call for timestamps
- `frontend/src/types.ts` — Add timestamp type
- `frontend/src/pages/resources/ResourceTemplatesTab.tsx` — Display last-updated
- `frontend/src/pages/StaffView.tsx` — Display last-updated (if exists)
- `frontend/src/pages/ResourcesView.tsx` — Display last-updated per section

---

## Task 1: Add updated_at Columns to Models

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/database.py`

- [ ] **Step 1: Add updated_at to ResourceTemplate model**

In `backend/app/models.py`, add to the `ResourceTemplate` class:

```python
from sqlalchemy import func

# In ResourceTemplate class:
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
```

- [ ] **Step 2: Add updated_at to Staff model**

```python
# In Staff class:
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
```

- [ ] **Step 3: Add updated_at to MonthlyConfig model**

This timestamp represents when any roster data for that month was last modified:

```python
# In MonthlyConfig class:
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
```

- [ ] **Step 4: Add migration in database.py**

Add a migration block in `_migrate()` to add `updated_at` columns to existing tables:

```python
    # ── Add updated_at timestamps ────────────────────────────────────────
    for tbl in ["resource_template", "staff", "monthly_config"]:
        cols = [c["name"] for c in insp.get_columns(tbl)]
        if "updated_at" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    f"ALTER TABLE {tbl} ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
                ))
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/database.py
git commit -m "feat: add updated_at timestamp columns to resource_template, staff, monthly_config"
```

---

## Task 2: Add Timestamps API Endpoint

**Files:**
- Modify: `backend/app/routers/roster.py` (or create a small dedicated router)

- [ ] **Step 1: Add endpoint to return last-modified timestamps**

Add a new endpoint that returns the most recent `updated_at` for each category:

```python
@router.get("/api/timestamps")
def get_timestamps(db: DBSession = Depends(get_db)):
    from ..models import ResourceTemplate, Staff, MonthlyConfig
    
    resource_ts = db.query(func.max(ResourceTemplate.updated_at)).scalar()
    staff_ts = db.query(func.max(Staff.updated_at)).scalar()
    
    return {
        "resources": resource_ts.isoformat() if resource_ts else None,
        "staff": staff_ts.isoformat() if staff_ts else None,
    }


@router.get("/api/timestamps/{config_id}")
def get_config_timestamp(config_id: int, db: DBSession = Depends(get_db)):
    config = db.query(MonthlyConfig).get(config_id)
    if not config:
        raise HTTPException(404)
    return {
        "roster": config.updated_at.isoformat() if config.updated_at else None,
    }
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/routers/roster.py
git commit -m "feat: add timestamps API endpoints"
```

---

## Task 3: Touch updated_at on Roster Modifications

**Files:**
- Modify: `backend/app/routers/monthly_config.py`

- [ ] **Step 1: Update monthly_config.updated_at on roster saves**

In each endpoint that modifies roster data (set_consultant_oncall, set_ac_oncall, set_registrar_duties, set_stepdown_days, set_evening_ot_dates), add a line to touch the config's `updated_at`:

```python
    cfg.updated_at = func.now()
```

before the `db.commit()` call. This requires importing `func` from sqlalchemy.

The resource template and staff models already have `onupdate=func.now()` so they auto-update on any modification via SQLAlchemy.

- [ ] **Step 2: Commit**

```bash
git add backend/app/routers/monthly_config.py
git commit -m "feat: touch monthly_config.updated_at on roster modifications"
```

---

## Task 4: Frontend Timestamp Display

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/pages/resources/ResourceTemplatesTab.tsx`
- Modify: `frontend/src/pages/ResourcesView.tsx`

- [ ] **Step 1: Add API function and type**

In `types.ts`:
```typescript
export interface Timestamps {
  resources: string | null;
  staff: string | null;
}
```

In `api.ts`:
```typescript
  getTimestamps: () =>
    request<import("./types").Timestamps>("/timestamps"),
  getConfigTimestamp: (configId: number) =>
    request<{ roster: string | null }>(`/timestamps/${configId}`),
```

- [ ] **Step 2: Display timestamp in ResourceTemplatesTab**

Add a small "Last updated" line below the "+ Add Resource" button:

```tsx
const [lastUpdated, setLastUpdated] = useState<string | null>(null);

// In the useEffect or after loading:
api.getTimestamps().then(ts => setLastUpdated(ts.resources));

// In the render, next to the Add button:
{lastUpdated && (
  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
    Last updated: {new Date(lastUpdated).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })}
  </span>
)}
```

- [ ] **Step 3: Display timestamp in ResourcesView for roster tabs**

When the on-call roster tab is active and a config is selected, fetch and display the roster timestamp similarly.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git add frontend/src/pages/resources/ResourceTemplatesTab.tsx
git add frontend/src/pages/ResourcesView.tsx
git commit -m "feat: display last-updated timestamps on resources and roster pages"
```

---

## Task 5: Manual Testing

- [ ] **Step 1: Verify timestamps appear**

Navigate to Resources → Resources tab. Confirm "Last updated" shows with a date.

- [ ] **Step 2: Verify timestamp updates on modification**

Edit a resource template (change room name), save. Refresh the page. Confirm "Last updated" timestamp has advanced.

- [ ] **Step 3: Verify roster timestamp**

Go to On-Call Roster tab, make a change, save. Confirm the roster timestamp updates.

- [ ] **Step 4: Verify migration is idempotent**

Restart the backend. Confirm no errors and timestamps are preserved.
