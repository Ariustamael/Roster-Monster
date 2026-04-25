# Call Type Config Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `is_registrar_tier` to rank config, `mutually_exclusive_with`, `linked_to`, and `is_duty_only` fields to call type config, replace hardcoded R1/R2/R1+2 logic with config-driven mutual exclusivity, and make call type sort order drag-and-drop.

**Architecture:** Extend existing `RankConfig` and `CallTypeConfig` models with new columns. New fields are stored as comma-separated call type IDs (linking to other call types). The frontend edit modal gains multi-select dropdowns for mutual exclusivity and linked call types. The Con/Reg Roster reads these fields instead of hardcoded logic. Ward MO and EOT MO become `is_duty_only` call types linked to MO1/MO2.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend), React 19/TypeScript (frontend), SQLite

---

## File Structure

### Backend — Modify
- `backend/app/models.py` — Add `is_registrar_tier` to RankConfig; add `mutually_exclusive_with`, `linked_to`, `is_duty_only` to CallTypeConfig
- `backend/app/database.py` — Migration for new columns + seed Ward MO / EOT MO call types
- `backend/app/schemas.py` — Add new fields to CallTypeConfigCreate/Out, add `is_registrar_tier` to RankConfig schemas

### Frontend — Modify
- `frontend/src/types.ts` — Add new fields to CallTypeConfig and RankConfig interfaces
- `frontend/src/pages/config/CallTypeConfigTab.tsx` — Multi-select dropdowns for mutual exclusivity and linked_to; drag-and-drop sort order; is_duty_only checkbox
- `frontend/src/pages/resources/ConsultantRosterTab.tsx` — Replace hardcoded R1/R2/R1+2 logic with config-driven; replace `name.startsWith("R")` with `is_registrar_tier` check
- `frontend/src/pages/resources/constants.ts` — Remove hardcoded `REG_RANKS` (replaced by config-driven)

---

## Task 1: Add is_registrar_tier to RankConfig

**Files:**
- Modify: `backend/app/models.py` — Add column to RankConfig
- Modify: `backend/app/database.py` — Migration + seed SSR and SR as registrar tier
- Modify: `backend/app/schemas.py` — Add to RankConfig schemas
- Modify: `frontend/src/types.ts` — Add to RankConfig interface

- [ ] **Step 1: Add column to RankConfig model**

In `backend/app/models.py`, add to the `RankConfig` class after `is_consultant_tier`:

```python
    is_registrar_tier = Column(Boolean, default=False)
```

- [ ] **Step 2: Add migration in database.py**

Add in `_migrate()`:

```python
    # ── Add is_registrar_tier to rank_config ──────────────────────────────
    if "rank_config" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("rank_config")]
        if "is_registrar_tier" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE rank_config ADD COLUMN is_registrar_tier BOOLEAN DEFAULT 0"))
                conn.execute(text("UPDATE rank_config SET is_registrar_tier = 1 WHERE name IN ('Senior Staff Registrar', 'Senior Resident')"))
```

- [ ] **Step 3: Add to schemas**

In `backend/app/schemas.py`, find the RankConfig schemas and add `is_registrar_tier: bool = False` to both Create and Out.

Search for `RankConfigCreate` and `RankConfigOut` — add the field to each.

- [ ] **Step 4: Add to frontend type**

In `frontend/src/types.ts`, find `RankConfig` interface and add:

```typescript
  is_registrar_tier: boolean;
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/database.py backend/app/schemas.py frontend/src/types.ts
git commit -m "feat: add is_registrar_tier to rank config with migration"
```

---

## Task 2: Add New Fields to CallTypeConfig

**Files:**
- Modify: `backend/app/models.py` — Add columns
- Modify: `backend/app/database.py` — Migration
- Modify: `backend/app/schemas.py` — Add fields
- Modify: `frontend/src/types.ts` — Add fields

- [ ] **Step 1: Add columns to CallTypeConfig model**

In `backend/app/models.py`, add to the `CallTypeConfig` class after `is_active`:

```python
    is_duty_only = Column(Boolean, default=False)
    linked_to = Column(String(100), nullable=True)
    mutually_exclusive_with = Column(String(100), nullable=True)
```

These store comma-separated call type IDs (e.g. "1,2" for MO1 and MO2).

- [ ] **Step 2: Add migration in database.py**

Add in `_migrate()`:

```python
    # ── Add is_duty_only, linked_to, mutually_exclusive_with to call_type_config ──
    if "call_type_config" in insp.get_table_names():
        cols = [c["name"] for c in insp.get_columns("call_type_config")]
        for col_name, col_def in [
            ("is_duty_only", "BOOLEAN DEFAULT 0"),
            ("linked_to", "TEXT"),
            ("mutually_exclusive_with", "TEXT"),
        ]:
            if col_name not in cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE call_type_config ADD COLUMN {col_name} {col_def}"))
```

- [ ] **Step 3: Add to schemas**

In `backend/app/schemas.py`, add to `CallTypeConfigCreate`:

```python
    is_duty_only: bool = False
    linked_to: Optional[str] = None
    mutually_exclusive_with: Optional[str] = None
```

Add to `CallTypeConfigOut`:

```python
    is_duty_only: bool = False
    linked_to: Optional[str] = None
    mutually_exclusive_with: Optional[str] = None
```

- [ ] **Step 4: Add to frontend type**

In `frontend/src/types.ts`, add to `CallTypeConfig`:

```typescript
  is_duty_only: boolean;
  linked_to: string | null;
  mutually_exclusive_with: string | null;
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/database.py backend/app/schemas.py frontend/src/types.ts
git commit -m "feat: add is_duty_only, linked_to, mutually_exclusive_with to call type config"
```

---

## Task 3: Seed Ward MO and EOT MO as Call Types

**Files:**
- Modify: `backend/app/database.py` — Add Ward MO and EOT MO call types, set R1+2 mutual exclusivity

- [ ] **Step 1: Add seed data in migration**

Add in `_migrate()` after the column additions:

```python
    # ── Seed Ward MO, EOT MO as is_duty_only call types ──────────────────
    if "call_type_config" in insp.get_table_names():
        with SessionLocal() as s:
            existing = {r[0] for r in s.execute(text("SELECT name FROM call_type_config")).fetchall()}

            if "Ward MO" not in existing:
                # Get MO1's ID for linked_to
                mo1_id = s.execute(text("SELECT id FROM call_type_config WHERE name = 'MO1'")).scalar()
                s.execute(text("""
                    INSERT INTO call_type_config
                    (name, display_order, is_overnight, post_call_type, max_consecutive_days,
                     min_gap_days, difficulty_points, counts_towards_fairness,
                     applicable_days, is_active, is_duty_only, linked_to)
                    VALUES ('Ward MO', 10, 0, 'none', 1, 0, 0, 0,
                            'Mon,Tue,Wed,Thu,Fri', 1, 1, :linked)
                """), {"linked": str(mo1_id) if mo1_id else None})

            if "EOT MO" not in existing:
                mo2_id = s.execute(text("SELECT id FROM call_type_config WHERE name = 'MO2'")).scalar()
                s.execute(text("""
                    INSERT INTO call_type_config
                    (name, display_order, is_overnight, post_call_type, max_consecutive_days,
                     min_gap_days, difficulty_points, counts_towards_fairness,
                     applicable_days, is_active, is_duty_only, linked_to)
                    VALUES ('EOT MO', 11, 0, 'none', 1, 0, 0, 0,
                            'Mon,Tue,Wed,Thu,Fri', 1, 1, :linked)
                """), {"linked": str(mo2_id) if mo2_id else None})

            # Set R1+2 mutually exclusive with R1 and R2
            r1_id = s.execute(text("SELECT id FROM call_type_config WHERE name = 'R1'")).scalar()
            r2_id = s.execute(text("SELECT id FROM call_type_config WHERE name = 'R2'")).scalar()
            r12_id = s.execute(text("SELECT id FROM call_type_config WHERE name = 'R1+2'")).scalar()
            if r12_id and r1_id and r2_id:
                s.execute(text(
                    "UPDATE call_type_config SET mutually_exclusive_with = :val WHERE id = :id"
                ), {"val": f"{r1_id},{r2_id}", "id": r12_id})

            # Set eligible ranks for Ward MO and EOT MO (SMO + MO)
            smo_id = s.execute(text("SELECT id FROM rank_config WHERE abbreviation = 'SMO'")).scalar()
            mo_id = s.execute(text("SELECT id FROM rank_config WHERE abbreviation = 'MO'")).scalar()
            for ct_name in ["Ward MO", "EOT MO"]:
                ct_id = s.execute(text("SELECT id FROM call_type_config WHERE name = :n"), {"n": ct_name}).scalar()
                if ct_id and smo_id:
                    s.execute(text(
                        "INSERT OR IGNORE INTO call_type_eligible_rank (call_type_id, rank_id) VALUES (:ct, :r)"
                    ), {"ct": ct_id, "r": smo_id})
                if ct_id and mo_id:
                    s.execute(text(
                        "INSERT OR IGNORE INTO call_type_eligible_rank (call_type_id, rank_id) VALUES (:ct, :r)"
                    ), {"ct": ct_id, "r": mo_id})

            s.commit()
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/database.py
git commit -m "feat: seed Ward MO and EOT MO as duty-only call types, set R1+2 mutual exclusivity"
```

---

## Task 4: Update Call Type Config Edit UI

**Files:**
- Modify: `frontend/src/pages/config/CallTypeConfigTab.tsx`

- [ ] **Step 1: Add new fields to DraftCallType interface**

Add to the `DraftCallType` interface:

```typescript
  is_duty_only: boolean;
  linked_to: number[];      // parsed from comma-separated IDs
  mutually_exclusive_with: number[];  // parsed from comma-separated IDs
```

- [ ] **Step 2: Update startEdit to parse new fields**

In `startEdit()`, add:

```typescript
is_duty_only: ct.is_duty_only ?? false,
linked_to: ct.linked_to ? ct.linked_to.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : [],
mutually_exclusive_with: ct.mutually_exclusive_with ? ct.mutually_exclusive_with.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n)) : [],
```

- [ ] **Step 3: Update startAdd defaults**

```typescript
is_duty_only: false,
linked_to: [],
mutually_exclusive_with: [],
```

- [ ] **Step 4: Update save to serialize back**

In the `save()` payload, add:

```typescript
is_duty_only: draft.is_duty_only,
linked_to: draft.linked_to.length > 0 ? draft.linked_to.join(",") : null,
mutually_exclusive_with: draft.mutually_exclusive_with.length > 0 ? draft.mutually_exclusive_with.join(",") : null,
```

- [ ] **Step 5: Add is_duty_only checkbox to form**

After the "Overnight (24h) call" checkbox:

```tsx
<div className="form-group">
  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <input type="checkbox" checked={draft.is_duty_only}
      onChange={(e) => setDraft({ ...draft, is_duty_only: e.target.checked })} />
    Duty only (appears in Duty Roster, not Call Roster)
  </label>
</div>
```

- [ ] **Step 6: Add linked_to multi-select**

After the is_duty_only checkbox, add a multi-select showing other call types:

```tsx
<div className="form-group">
  <label>Linked To (auto-fill from these call types' assignees)</label>
  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
    {callTypes.filter(ct => ct.id !== draft.id).map(ct => (
      <label key={ct.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox"
          checked={draft.linked_to.includes(ct.id)}
          onChange={() => {
            const ids = draft.linked_to.includes(ct.id)
              ? draft.linked_to.filter(id => id !== ct.id)
              : [...draft.linked_to, ct.id];
            setDraft({ ...draft, linked_to: ids });
          }} />
        {ct.name}
      </label>
    ))}
  </div>
</div>
```

- [ ] **Step 7: Add mutually_exclusive_with multi-select**

Same pattern:

```tsx
<div className="form-group">
  <label>Mutually Exclusive With (hide when these are filled, and vice versa)</label>
  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
    {callTypes.filter(ct => ct.id !== draft.id).map(ct => (
      <label key={ct.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox"
          checked={draft.mutually_exclusive_with.includes(ct.id)}
          onChange={() => {
            const ids = draft.mutually_exclusive_with.includes(ct.id)
              ? draft.mutually_exclusive_with.filter(id => id !== ct.id)
              : [...draft.mutually_exclusive_with, ct.id];
            setDraft({ ...draft, mutually_exclusive_with: ids });
          }} />
        {ct.name}
      </label>
    ))}
  </div>
</div>
```

- [ ] **Step 8: Add is_duty_only and mutual exclusivity columns to the table**

Add `Duty Only` and `Exclusive` columns to the table header and rows.

- [ ] **Step 9: Replace display_order number input with drag-and-drop**

Remove the `display_order` number input from the edit form. Add drag handles to each row in the table. On drop, update display_order for all rows and save via API.

This requires:
- Adding `draggable` to table rows
- Tracking drag state
- On drop: reorder the array, assign sequential display_order values, save each changed row

```tsx
// In the table row:
<tr
  key={ct.id}
  draggable
  onDragStart={() => setDragCtId(ct.id)}
  onDragOver={(e) => { e.preventDefault(); setDragOverCtId(ct.id); }}
  onDragLeave={() => setDragOverCtId(null)}
  onDrop={async () => {
    if (dragCtId === null || dragCtId === ct.id) return;
    const ordered = [...callTypes];
    const fromIdx = ordered.findIndex(c => c.id === dragCtId);
    const toIdx = ordered.findIndex(c => c.id === ct.id);
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].display_order !== i) {
        await api.updateCallType(ordered[i].id, { ...ordered[i], display_order: i, eligible_rank_ids: ordered[i].eligible_rank_ids });
      }
    }
    setDragCtId(null);
    setDragOverCtId(null);
    await load();
  }}
  style={{ opacity: ct.is_active ? 1 : 0.5, outline: dragOverCtId === ct.id ? "2px dashed var(--primary)" : undefined }}
>
  <td style={{ cursor: "grab" }}>☰</td>
  ...
</tr>
```

Add state variables:
```typescript
const [dragCtId, setDragCtId] = useState<number | null>(null);
const [dragOverCtId, setDragOverCtId] = useState<number | null>(null);
```

Replace the "Order" column header with a drag handle column.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/pages/config/CallTypeConfigTab.tsx
git commit -m "feat: call type config UI with mutual exclusivity, linked_to, is_duty_only, drag sort"
```

---

## Task 5: Replace Hardcoded R1/R2/R1+2 Logic in Con/Reg Roster

**Files:**
- Modify: `frontend/src/pages/resources/ConsultantRosterTab.tsx`

- [ ] **Step 1: Replace name.startsWith("R") with tier-based detection**

Currently the component filters registrar call types with:
```typescript
const rCallTypes = callTypes.filter(ct => ct.is_active && ct.name.startsWith("R"));
```

Replace with rank-based detection. Load ranks via API and determine which call types are registrar-tier:

```typescript
const [ranks, setRanks] = useState<RankConfig[]>([]);
// Add api.getRanks() to load function's Promise.all

const registrarRankIds = new Set(ranks.filter(r => r.is_registrar_tier).map(r => r.id));
const rCallTypes = callTypes.filter(ct =>
  ct.is_active &&
  !ct.is_duty_only &&
  ct.eligible_rank_ids.some(id => registrarRankIds.has(id)) &&
  !ct.eligible_rank_ids.some(id => !registrarRankIds.has(id)) // all eligible ranks must be registrar-tier
);
```

This means: a call type is "registrar" if ALL its eligible ranks are registrar-tier ranks. This correctly identifies R1, R2, R1+2 without hardcoding names.

- [ ] **Step 2: Replace hardcoded registrarStaff filter**

Currently:
```typescript
import { CONS_RANKS, AC_RANKS, REG_RANKS } from "./constants";
const registrarStaff = staff.filter((s) => REG_RANKS.includes(s.rank) && s.active);
```

Replace with:
```typescript
const registrarRankNames = new Set(ranks.filter(r => r.is_registrar_tier).map(r => r.name));
const registrarStaff = staff.filter((s) => registrarRankNames.has(s.rank) && s.active);
```

Remove `REG_RANKS` from the import (keep CONS_RANKS and AC_RANKS for consultant logic).

- [ ] **Step 3: Replace hardcoded mutual exclusivity with config-driven**

Replace `getActiveRegSlots`:

```typescript
function getActiveRegSlots(row: DayRow, rTypes: CallTypeConfig[]): CallTypeConfig[] {
  const visible = getVisibleRegSlots(row, rTypes);

  // Build exclusion map from config
  const ctById = new Map(visible.map(ct => [ct.id, ct]));
  const filledIds = new Set(
    visible.filter(ct => row.registrarSlots[ct.name] !== "").map(ct => ct.id)
  );

  const hiddenIds = new Set<number>();
  for (const ct of visible) {
    if (!filledIds.has(ct.id)) continue;
    if (!ct.mutually_exclusive_with) continue;
    const exclusiveIds = ct.mutually_exclusive_with.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    // If this filled call type excludes others, check if ALL excluded types should be hidden
    // Only hide if the current filled type fully replaces the exclusive ones
    for (const exId of exclusiveIds) {
      hiddenIds.add(exId);
    }
  }

  // Don't hide a type that is already filled
  for (const ct of visible) {
    if (filledIds.has(ct.id)) hiddenIds.delete(ct.id);
  }

  return visible.filter(ct => !hiddenIds.has(ct.id));
}
```

- [ ] **Step 4: Replace hardcoded clear logic in handleDrop**

Replace the hardcoded R1+2/R1/R2 clearing with config-driven:

```typescript
if (slotType.startsWith("reg:")) {
  const callType = slotType.slice(4);
  const droppedStaff = staffById.get(payload.staffId);
  if (!droppedStaff || !registrarRankNames.has(droppedStaff.rank)) return;

  const droppedCt = rCallTypes.find(ct => ct.name === callType);

  setRows(prev => prev.map((r, i) => {
    if (i !== rowIdx) return r;
    const newSlots = { ...r.registrarSlots, [callType]: payload.staffId };

    // Clear mutually exclusive slots
    if (droppedCt?.mutually_exclusive_with) {
      const exIds = droppedCt.mutually_exclusive_with.split(",").map(s => parseInt(s.trim()));
      for (const ct of rCallTypes) {
        if (exIds.includes(ct.id)) newSlots[ct.name] = "";
      }
    }

    // If filling a slot that is in someone else's exclusive list, and all exclusive peers are now filled, clear the excluder
    for (const ct of rCallTypes) {
      if (!ct.mutually_exclusive_with) continue;
      const exIds = ct.mutually_exclusive_with.split(",").map(s => parseInt(s.trim()));
      if (exIds.includes(droppedCt?.id ?? -1)) continue; // skip self-references
      const allExFilled = exIds.every(exId => {
        const exCt = rCallTypes.find(c => c.id === exId);
        return exCt && newSlots[exCt.name] !== "";
      });
      if (allExFilled) newSlots[ct.name] = "";
    }

    return { ...r, registrarSlots: newSlots };
  }));
  setDirty(true);
  dragPayload.current = null;
  return;
}
```

- [ ] **Step 5: Update isDragEligible to use rank tiers**

Replace:
```typescript
const isReg = REG_RANKS.includes(s.rank);
```
With:
```typescript
const isReg = registrarRankNames.has(s.rank);
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/resources/ConsultantRosterTab.tsx
git commit -m "feat: config-driven mutual exclusivity and registrar tier detection in Con/Reg roster"
```

---

## Task 6: Remove Hardcoded REG_RANKS

**Files:**
- Modify: `frontend/src/pages/resources/constants.ts` — Remove REG_RANKS export
- Modify: Any files importing REG_RANKS — Update to use rank config

- [ ] **Step 1: Check all REG_RANKS usages**

Search for `REG_RANKS` across the frontend. After Task 5 removes it from ConsultantRosterTab, remove any remaining usages and the export from constants.ts.

- [ ] **Step 2: Remove from constants.ts**

Remove the line:
```typescript
export const REG_RANKS = ["Senior Staff Registrar", "Senior Resident"];
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/resources/constants.ts
git commit -m "chore: remove hardcoded REG_RANKS, replaced by is_registrar_tier config"
```

---

## Task 7: Manual Testing

- [ ] **Step 1: Verify rank config**

Go to Config → Ranks. Confirm SSR and SR show `is_registrar_tier = true`.

- [ ] **Step 2: Verify new call type fields**

Go to Config → Call Types. Edit R1+2. Confirm:
- "Mutually Exclusive With" shows R1 and R2 checked
- Saving and reloading preserves the values

- [ ] **Step 3: Verify Ward MO and EOT MO exist**

Check Config → Call Types. Confirm Ward MO and EOT MO appear with:
- `is_duty_only = true`
- `linked_to` = MO1 and MO2 respectively

- [ ] **Step 4: Verify Con/Reg Roster still works**

Go to Resources → Con/Reg Roster. Confirm:
- Registrar slots still appear on correct days
- R1+2 mutual exclusivity works (fill R1+2 → R1 and R2 hide)
- Drag constraints still work (consultants can't drop in registrar slots)

- [ ] **Step 5: Test adding R3**

Create a new call type "R3" with:
- Eligible ranks: SSR, SR
- Applicable days: Mon-Fri
- Not overnight, no post-call

Go to Con/Reg Roster. Confirm R3 appears as a new registrar slot on weekdays. No code changes needed.

- [ ] **Step 6: Verify drag-and-drop sort order**

Go to Config → Call Types. Drag a row to reorder. Confirm the order persists after page reload.
