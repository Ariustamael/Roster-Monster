# Combined Consultant/Registrar Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the consultant and registrar roster tabs into a single calendar-grid view with drag-and-drop for both consultant-tier and registrar-tier staff, with R1/R2/R1+2 slots that appear conditionally based on call_type_config rules.

**Architecture:** Extend the existing `ConsultantRosterTab` component to include registrar slots in each calendar cell. The sidebar gains a "Registrar Staff" section. Slot visibility is driven by `call_type_config` (applicable_days + required_conditions), making it fully config-driven. R1+2 is mutually exclusive with R1+R2. The backend already has registrar duty CRUD — we wire it into the same save flow. The tab is renamed from "Consultant Roster" to "On-Call Roster".

**Tech Stack:** React 19/TypeScript (frontend), Python/FastAPI/SQLAlchemy (backend), SQLite

---

## File Structure

### Modify
- `frontend/src/pages/resources/ConsultantRosterTab.tsx` — Rename to combined roster, add registrar slots + sidebar section
- `frontend/src/pages/ResourcesView.tsx` — Rename tab label, remove registrar tab
- `frontend/src/api.ts` — Add `getCallTypes` import if not already used here (it's used in ResourceTemplatesTab)
- `frontend/src/types.ts` — Ensure `CallTypeConfig` has `applicable_days` and `required_conditions` fields

### Delete
- `frontend/src/pages/resources/RegistrarRosterTab.tsx` — Replaced by combined view

---

## Task 1: Verify Frontend Types

**Files:**
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Check CallTypeConfig interface has needed fields**

Read `frontend/src/types.ts` and find the `CallTypeConfig` interface. It needs `applicable_days: string | null` and `required_conditions: string | null` fields. If missing, add them.

The backend `CallTypeConfig` model has these columns:
- `applicable_days` — String, e.g. "Mon,Tue,Wed,Thu,Fri"
- `required_conditions` — String, e.g. "Not Stepdown"

Also check that `RegistrarDuty` type exists with: `id, date, registrar_id, registrar_name, duty_type, shift`.

- [ ] **Step 2: Add RegistrarDuty type if missing**

```typescript
export interface RegistrarDuty {
  id: number;
  date: string;
  registrar_id: number;
  registrar_name: string;
  duty_type: string;
  shift: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types.ts
git commit -m "feat: ensure CallTypeConfig and RegistrarDuty types have all needed fields"
```

---

## Task 2: Add Registrar API Functions

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Check if registrar duty API functions exist**

Read `frontend/src/api.ts` and search for `registrar`. If `getRegistrarDuties` and `setRegistrarDuties` already exist, skip this task. If not, add them:

```typescript
  getRegistrarDuties: (configId: number) =>
    request<import("./types").RegistrarDuty[]>(`/monthly-config/${configId}/registrar-duties`),
  setRegistrarDuties: (configId: number, entries: { date: string; registrar_id: number; duty_type: string; shift: string }[]) =>
    request<{ ok: boolean }>(`/monthly-config/${configId}/registrar-duties`, { method: "POST", body: JSON.stringify(entries) }),
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add registrar duty API functions"
```

---

## Task 3: Extend ConsultantRosterTab with Registrar Slots

**Files:**
- Modify: `frontend/src/pages/resources/ConsultantRosterTab.tsx`

This is the main task. The existing component (617 lines) needs these changes:

- [ ] **Step 1: Update imports and add registrar constants**

Add to imports:
```typescript
import type { ..., CallTypeConfig, RegistrarDuty } from "../../types";
import { CONS_RANKS, AC_RANKS, REG_RANKS } from "./constants";
```

- [ ] **Step 2: Extend DayRow interface to include registrar slots**

Add registrar fields to the `DayRow` interface (around line 6):

```typescript
interface DayRow {
  date: string;
  dayName: string;
  dayNum: number;
  dow: number;
  isWeekend: boolean;
  consultantId: number | "";
  supervisingId: number | "";
  acId: number | "";
  isStepdown: boolean;
  isEveningOT: boolean;
  isPH: boolean;
  phName: string;
  // Registrar slots — keyed by call type name (R1, R2, R1+2)
  registrarSlots: Record<string, number | "">;
}
```

- [ ] **Step 3: Add registrar slot type to SlotType**

Change the `SlotType` definition to support registrar slots:

```typescript
type SlotType = "consultant" | "supervising" | "ac" | `reg:${string}`;
```

- [ ] **Step 4: Load call types and registrar data**

In the main component, add state for call types and registrar data. Update the `load` function to fetch `api.getCallTypes()` and `api.getRegistrarDuties(configId)`.

```typescript
const [callTypes, setCallTypes] = useState<CallTypeConfig[]>([]);
```

In the `load` callback, add to the Promise.all:
```typescript
api.getCallTypes(),
api.getRegistrarDuties(configId),
```

Build registrar assignment map:
```typescript
// Group registrar duties by date+duty_type
const regMap = new Map<string, number>(); // key: "date:R1" -> staff_id
for (const r of regRows) {
  regMap.set(`${r.date}:${r.duty_type}`, r.registrar_id);
}
```

When building `dayRows`, populate `registrarSlots`:
```typescript
// For each R-type call type, check if there's an assignment
const registrarSlots: Record<string, number | ""> = {};
for (const ct of rCallTypes) {
  registrarSlots[ct.name] = regMap.get(`${dateStr}:${ct.name}`) ?? "";
}
```

Filter R-type call types (names starting with "R"):
```typescript
const rCallTypes = callTypes.filter(ct => ct.is_active && ct.name.startsWith("R"));
```

- [ ] **Step 5: Add helper to determine which R-slots are visible for a given day**

```typescript
function getVisibleRegSlots(row: DayRow, rCallTypes: CallTypeConfig[]): CallTypeConfig[] {
  const dayName = row.dayName; // "Mon", "Tue", etc.
  return rCallTypes.filter(ct => {
    // Check applicable_days
    if (ct.applicable_days) {
      const days = ct.applicable_days.split(",").map(d => d.trim());
      if (!days.includes(dayName) && !(row.isPH && days.includes("PH"))) return false;
    }
    // Check required_conditions
    if (ct.required_conditions) {
      for (const cond of ct.required_conditions.split(",").map(c => c.trim())) {
        if (cond === "Not Stepdown" && row.isStepdown) return false;
        if (cond === "Stepdown" && !row.isStepdown) return false;
        if (cond === "PH" && !row.isPH) return false;
        if (cond === "Not PH" && row.isPH) return false;
      }
    }
    return true;
  });
}
```

- [ ] **Step 6: Add mutual exclusivity logic for R1+2 vs R1+R2**

After determining visible slots, apply the mutual exclusion rule:

```typescript
function getActiveRegSlots(row: DayRow, rCallTypes: CallTypeConfig[]): CallTypeConfig[] {
  const visible = getVisibleRegSlots(row, rCallTypes);
  const r1 = visible.find(ct => ct.name === "R1");
  const r2 = visible.find(ct => ct.name === "R2");
  const r12 = visible.find(ct => ct.name === "R1+2");

  if (!r12) return visible; // No R1+2 configured or not visible today

  const r1Filled = r1 && row.registrarSlots["R1"] !== "";
  const r2Filled = r2 && row.registrarSlots["R2"] !== "";
  const r12Filled = r12 && row.registrarSlots["R1+2"] !== "";

  if (r12Filled) {
    // R1+2 filled → hide R1 and R2
    return visible.filter(ct => ct.name !== "R1" && ct.name !== "R2");
  }
  if (r1Filled && r2Filled) {
    // Both R1 and R2 filled → hide R1+2
    return visible.filter(ct => ct.name !== "R1+2");
  }
  return visible;
}
```

- [ ] **Step 7: Add registrar drag-drop handling**

In `handleDrop`, add handling for registrar slot types (slots with `reg:` prefix):

```typescript
if (slotType.startsWith("reg:")) {
  const callType = slotType.slice(4); // e.g. "R1", "R2", "R1+2"
  const droppedStaff = staffById.get(payload.staffId);
  if (!droppedStaff || !REG_RANKS.includes(droppedStaff.rank)) return;
  setRows((prev) =>
    prev.map((r, i) => {
      if (i !== rowIdx) return r;
      const newSlots = { ...r.registrarSlots, [callType]: payload.staffId };
      // Mutual exclusivity: if filling R1+2, clear R1 and R2
      if (callType === "R1+2") {
        newSlots["R1"] = "";
        newSlots["R2"] = "";
      }
      // If filling R1 or R2 and both are now filled, clear R1+2
      if ((callType === "R1" || callType === "R2") && newSlots["R1"] !== "" && newSlots["R2"] !== "") {
        newSlots["R1+2"] = "";
      }
      return { ...r, registrarSlots: newSlots };
    })
  );
  setDirty(true);
  dragPayload.current = null;
  return;
}
```

In `clearSlot`, add handling for registrar slots:

```typescript
if (slotType.startsWith("reg:")) {
  const callType = slotType.slice(4);
  setRows((prev) =>
    prev.map((r, i) => {
      if (i !== rowIdx) return r;
      return { ...r, registrarSlots: { ...r.registrarSlots, [callType]: "" } };
    })
  );
  setDirty(true);
  return;
}
```

- [ ] **Step 8: Add registrar section to sidebar**

After the "Consultant Staff" card in the sidebar, add:

```tsx
<div className="card" style={{ marginBottom: 12 }}>
  <h3 style={{ fontSize: 11, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Registrar Staff</h3>
  {registrarStaff.length === 0 && (
    <div className="team-empty">No registrar-tier staff</div>
  )}
  {registrarStaff.map((s) => (
    <StaffCard key={s.id} staff={s} onDragStart={handleDragStart} color="#f59e0b" />
  ))}
</div>
```

Where `registrarStaff` is:
```typescript
const registrarStaff = staff.filter((s) => REG_RANKS.includes(s.rank) && s.active);
```

Update `StaffCard` to accept an optional `color` prop for the left border (default blue for consultants, green for AC, orange for registrars).

- [ ] **Step 9: Render registrar slots in calendar cells**

After the consultant/AC slots and before the stepdown checkboxes, add:

```tsx
{/* Registrar slots */}
{activeRegSlots.length > 0 && (
  <div style={{ borderTop: "1px solid var(--border)", marginTop: 2, paddingTop: 2 }}>
    {activeRegSlots.map((ct) => (
      <DropSlot
        key={ct.name}
        label={ct.name}
        slotType={`reg:${ct.name}` as SlotType}
        filledName={cell.registrarSlots[ct.name]
          ? staffById.get(cell.registrarSlots[ct.name] as number)?.name
          : undefined}
        slotKey={`${cell.date}:reg:${ct.name}`}
        dragOverSlot={dragOverSlot}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(st, e) => handleDrop(idx, st, e)}
        onClear={() => clearSlot(idx, `reg:${ct.name}` as SlotType)}
      />
    ))}
  </div>
)}
```

Where `activeRegSlots` is computed per cell:
```typescript
const activeRegSlots = getActiveRegSlots(cell, rCallTypes);
```

- [ ] **Step 10: Rename "On Call" to "Consultant In Charge"**

Find the `DropSlot` usage with `label="On Call"` and change it to `label="Consultant In Charge"`. It's on the line:
```tsx
<DropSlot label="On Call" ...
```
Change to:
```tsx
<DropSlot label="CIC" ...
```
Use "CIC" as the short label since calendar cells are narrow. The title tooltip can show the full name.

- [ ] **Step 11: Update DropSlot to handle registrar coloring**

The `DropSlot` component uses `slotType` to determine colors. Add registrar coloring:

```typescript
// In DropSlot, determine colors:
const isReg = slotType.startsWith("reg:");
if (isFilled) {
  if (isReg) bg = "#fef3c7";       // amber for registrar
  else if (slotType === "consultant") bg = "#dbeafe";
  else if (slotType === "supervising") bg = "#eff6ff";
  else bg = "#d1fae5";             // green for AC
}
if (isOver) bg = isReg ? "#fde68a" : slotType === "ac" ? "#a7f3d0" : "#bfdbfe";
```

And the text color for filled registrar slots:
```typescript
color: isReg ? "#92400e" : slotType === "ac" ? "#065f46" : "#1e40af"
```

- [ ] **Step 12: Update save function to include registrar duties**

In the `save()` function, build registrar entries and include in the save:

```typescript
// Build registrar duty entries
const regEntries: { date: string; registrar_id: number; duty_type: string; shift: string }[] = [];
for (const r of rows) {
  for (const [callType, staffId] of Object.entries(r.registrarSlots)) {
    if (staffId !== "") {
      // Determine shift from call type config
      const ct = rCallTypes.find(c => c.name === callType);
      const shift = ct?.is_overnight ? (callType === "R1+2" ? "combined" : "night") : "day";
      regEntries.push({
        date: r.date,
        registrar_id: staffId as number,
        duty_type: callType,
        shift,
      });
    }
  }
}
```

Add to the Promise.all in save:
```typescript
api.setRegistrarDuties(configId, regEntries),
```

- [ ] **Step 13: Increase cell height**

The cells are currently 120px. With registrar slots added, increase to 160px or use `minHeight` instead of fixed `height`.

- [ ] **Step 14: Commit**

```bash
git add frontend/src/pages/resources/ConsultantRosterTab.tsx
git commit -m "feat: combined consultant/registrar roster with config-driven R1/R2/R1+2 slots"
```

---

## Task 4: Update ResourcesView and Clean Up

**Files:**
- Modify: `frontend/src/pages/ResourcesView.tsx`
- Delete: `frontend/src/pages/resources/RegistrarRosterTab.tsx`

- [ ] **Step 1: Update ResourcesView.tsx**

Remove the `RegistrarRosterTab` import and its tab entry. Rename the "Consultant Roster" tab to "On-Call Roster":

```typescript
const TABS = [
  { key: "supply", label: "Supply / Demand", needsConfig: true },
  { key: "resources", label: "Resources", needsConfig: false },
  { key: "oncall", label: "On-Call Roster", needsConfig: true },
] as const;
```

Update the render to use `"oncall"` key instead of `"consultant"`, and remove the registrar render block.

- [ ] **Step 2: Delete RegistrarRosterTab.tsx**

```bash
git rm frontend/src/pages/resources/RegistrarRosterTab.tsx
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ResourcesView.tsx
git rm frontend/src/pages/resources/RegistrarRosterTab.tsx
git commit -m "feat: rename to On-Call Roster tab, remove separate registrar tab"
```

---

## Task 5: Manual Testing

- [ ] **Step 1: Verify calendar loads with correct slots**

Navigate to Resources → On-Call Roster. Confirm:
- Calendar grid renders with day cells
- Sidebar has both "Consultant Staff" and "Registrar Staff" sections
- Consultant slots show "CIC" label
- R1/R2/R1+2 slots appear on correct days based on config

- [ ] **Step 2: Verify stepdown hides R1 and R1+2**

Check a stepdown day checkbox on a weekday. Confirm:
- R1 slot disappears
- R1+2 slot disappears
- R2 slot remains (if Tue-Fri)

- [ ] **Step 3: Verify R2 only on Tue-Fri**

Check Monday cells: should show R1 and R1+2 but NOT R2.
Check Tuesday cells: should show R1, R2, and R1+2.

- [ ] **Step 4: Verify mutual exclusivity**

1. Drag a registrar into R1+2 → R1 and R2 slots should hide
2. Clear R1+2, then fill both R1 and R2 → R1+2 should hide
3. Clear one of R1/R2 → R1+2 should reappear

- [ ] **Step 5: Verify drag constraints**

1. Drag a consultant into a registrar slot → should be rejected
2. Drag a registrar into a consultant slot → should be rejected
3. Drag a registrar into R1 slot → should work

- [ ] **Step 6: Verify save and reload**

Fill some consultant and registrar slots, save, reload page. All assignments should persist.
