import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../../api";
import type { ConsultantOnCall, ACOnCall, Staff, PublicHoliday, StepdownDay, EveningOTDate } from "../../types";
import { CONS_RANKS, AC_RANKS } from "./constants";

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
}

type SlotType = "consultant" | "supervising" | "ac";

interface DragPayload {
  staffId: number;
}

function StaffCard({
  staff,
  onDragStart,
}: {
  staff: Staff;
  onDragStart: (payload: DragPayload) => void;
}) {
  const isAC = AC_RANKS.includes(staff.rank);
  return (
    <div
      className="team-card"
      draggable
      onDragStart={() => onDragStart({ staffId: staff.id })}
      title={staff.rank}
      style={{
        marginBottom: 4,
        cursor: "grab",
        borderLeft: `3px solid ${isAC ? "#10b981" : "#3b82f6"}`,
      }}
    >
      <span className="card-name">{staff.name}</span>
      <span className="card-grade">{staff.rank}</span>
    </div>
  );
}

function DropSlot({
  label,
  slotType,
  filledName,
  disabled,
  dragOverSlot,
  slotKey,
  onDragOver,
  onDragLeave,
  onDrop,
  onClear,
}: {
  label: string;
  slotType: SlotType;
  filledName: string | undefined;
  disabled?: boolean;
  dragOverSlot: string | null;
  slotKey: string;
  onDragOver: (key: string, e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (slotType: SlotType, e: React.DragEvent) => void;
  onClear: () => void;
}) {
  const isOver = dragOverSlot === slotKey;
  const isFilled = !!filledName;

  let bg = "transparent";
  if (isFilled) {
    if (slotType === "consultant") bg = "#dbeafe";
    else if (slotType === "supervising") bg = "#eff6ff";
    else bg = "#d1fae5";
  }
  if (isOver) bg = slotType === "ac" ? "#a7f3d0" : "#bfdbfe";

  if (disabled) return null;

  return (
    <div
      onDragOver={(e) => onDragOver(slotKey, e)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(slotType, e)}
      style={{
        background: bg,
        border: `1px dashed ${isOver ? "var(--primary)" : isFilled ? "transparent" : "var(--border)"}`,
        borderRadius: 3,
        padding: "2px 4px",
        minHeight: 22,
        fontSize: 11,
        marginBottom: 2,
        cursor: isFilled ? "pointer" : "default",
        transition: "background 0.1s",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
      }}
      onClick={isFilled ? onClear : undefined}
      title={isFilled ? `${filledName} — click to clear` : label}
    >
      {isFilled ? (
        <>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, color: slotType === "ac" ? "#065f46" : "#1e40af", fontWeight: 500 }}>
            {filledName}
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: 10, flexShrink: 0 }}>✕</span>
        </>
      ) : (
        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{label}</span>
      )}
    </div>
  );
}

const DOW_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function ConsultantRosterTab({ configId, year, month }: { configId: number; year: number; month: number }) {
  const [rows, setRows] = useState<DayRow[]>([]);
  const [publicHolidays, setPublicHolidays] = useState<PublicHoliday[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const dragPayload = useRef<DragPayload | null>(null);

  const numDays = new Date(year, month, 0).getDate();

  const load = useCallback(async () => {
    setLoading(true);
    const [consRows, acRows, allStaff, stepdownDays, eveningOTDates, holidays] = await Promise.all([
      api.getConsultantOnCall(configId),
      api.getACOnCall(configId),
      api.getStaff(),
      api.getStepdownDays(configId),
      api.getEveningOTDates(configId),
      api.getPublicHolidays(),
    ]);
    setStaff(allStaff);
    setPublicHolidays(holidays);

    const consMap = new Map<string, ConsultantOnCall>();
    for (const r of consRows) consMap.set(r.date, r);
    const acMap = new Map<string, ACOnCall>();
    for (const r of acRows) acMap.set(r.date, r);
    const stepdownSet = new Set<string>(stepdownDays.map((s: StepdownDay) => s.date));
    const eotSet = new Set<string>(eveningOTDates.map((e: EveningOTDate) => e.date));
    const phMap = new Map<string, PublicHoliday>();
    for (const h of holidays) phMap.set(h.date, h);

    const dayRows: DayRow[] = [];
    for (let d = 1; d <= numDays; d++) {
      const dt = new Date(year, month - 1, d);
      const dateStr = dt.toISOString().slice(0, 10);
      const cons = consMap.get(dateStr);
      const ac = acMap.get(dateStr);
      const ph = phMap.get(dateStr);
      dayRows.push({
        date: dateStr,
        dayName: dt.toLocaleDateString("en", { weekday: "short" }),
        dayNum: d,
        dow: (dt.getDay() + 6) % 7,
        isWeekend: dt.getDay() === 0 || dt.getDay() === 6,
        consultantId: cons?.consultant_id ?? "",
        supervisingId: cons?.supervising_consultant_id ?? "",
        acId: ac?.ac_id ?? "",
        isStepdown: stepdownSet.has(dateStr),
        isEveningOT: eotSet.has(dateStr),
        isPH: !!ph,
        phName: ph?.name ?? "",
      });
    }
    setRows(dayRows);
    setDirty(false);
    setLoading(false);
  }, [configId, year, month, numDays]);

  useEffect(() => { load(); }, [load]);

  // One unified list: all consultant-tier staff (SC, C, AC)
  const allConsultantTier = staff.filter((s) => CONS_RANKS.includes(s.rank));
  const staffById = new Map<number, Staff>(staff.map((s) => [s.id, s]));

  function handleDragStart(payload: DragPayload) {
    dragPayload.current = payload;
  }

  function handleDragOver(slotKey: string, e: React.DragEvent) {
    e.preventDefault();
    setDragOverSlot(slotKey);
  }

  function handleDragLeave() {
    setDragOverSlot(null);
  }

  function getSecondarySlotType(row: DayRow): "supervising" | "ac" | null {
    if (row.consultantId === "") return null;
    const primaryStaff = staffById.get(row.consultantId as number);
    if (!primaryStaff) return null;
    if (AC_RANKS.includes(primaryStaff.rank)) return "supervising";
    return "ac";
  }

  function handleDrop(rowIdx: number, slotType: SlotType, e: React.DragEvent) {
    e.preventDefault();
    setDragOverSlot(null);
    const payload = dragPayload.current;
    if (!payload) return;

    const droppedStaff = staffById.get(payload.staffId);
    if (!droppedStaff) return;
    const isAC = AC_RANKS.includes(droppedStaff.rank);

    if (slotType === "consultant") {
      // Primary slot: accept any consultant-tier staff
      setRows((prev) =>
        prev.map((r, i) => {
          if (i !== rowIdx) return r;
          // Clear secondary slot when changing primary (since secondary type depends on primary)
          return { ...r, consultantId: payload.staffId, supervisingId: "", acId: "" };
        })
      );
    } else if (slotType === "supervising") {
      // Supervising slot: only SC/C (not AC)
      if (isAC) return;
      setRows((prev) =>
        prev.map((r, i) => {
          if (i !== rowIdx) return r;
          return { ...r, supervisingId: payload.staffId };
        })
      );
    } else {
      // AC slot: only AC
      if (!isAC) return;
      setRows((prev) =>
        prev.map((r, i) => {
          if (i !== rowIdx) return r;
          return { ...r, acId: payload.staffId };
        })
      );
    }
    setDirty(true);
    dragPayload.current = null;
  }

  function clearSlot(rowIdx: number, slotType: SlotType) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIdx) return r;
        if (slotType === "consultant") return { ...r, consultantId: "", supervisingId: "", acId: "" };
        if (slotType === "supervising") return { ...r, supervisingId: "" };
        return { ...r, acId: "" };
      })
    );
    setDirty(true);
  }

  function toggleStepdown(rowIdx: number) {
    setRows((prev) =>
      prev.map((r, i) => (i === rowIdx ? { ...r, isStepdown: !r.isStepdown } : r))
    );
    setDirty(true);
  }

  function toggleEveningOT(rowIdx: number) {
    setRows((prev) =>
      prev.map((r, i) => (i === rowIdx ? { ...r, isEveningOT: !r.isEveningOT } : r))
    );
    setDirty(true);
  }

  function addPH(rowIdx: number) {
    const name = prompt("Public Holiday name:");
    if (!name || !name.trim()) return;
    setRows((prev) =>
      prev.map((r, i) => (i === rowIdx ? { ...r, isPH: true, phName: name.trim() } : r))
    );
    setDirty(true);
  }

  function removePH(rowIdx: number) {
    setRows((prev) =>
      prev.map((r, i) => (i === rowIdx ? { ...r, isPH: false, phName: "" } : r))
    );
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      // Build consultant on-call entries:
      // consultant_id = whoever is in the primary slot
      // supervising_consultant_id = whoever is in the supervising slot (only when AC is primary)
      const consEntries: { date: string; consultant_id: number; supervising_consultant_id?: number | null }[] = [];
      const acEntries: { date: string; ac_id: number }[] = [];

      for (const r of rows) {
        if (r.consultantId !== "") {
          const primaryStaff = staffById.get(r.consultantId as number);
          const primaryIsAC = primaryStaff ? AC_RANKS.includes(primaryStaff.rank) : false;

          // Primary always goes into consultant_oncall as consultant_id
          consEntries.push({
            date: r.date,
            consultant_id: r.consultantId as number,
            supervising_consultant_id: primaryIsAC && r.supervisingId ? (r.supervisingId as number) : null,
          });

          // AC on-call entries: only when AC is in the secondary (AC) slot
          if (!primaryIsAC && r.acId !== "") {
            acEntries.push({ date: r.date, ac_id: r.acId as number });
          }
        }
      }

      // Build stepdown entries
      const stepdownEntries = rows
        .filter((r) => r.isStepdown)
        .map((r) => ({ date: r.date }));

      // Build evening OT entries
      const eotEntries = rows
        .filter((r) => r.isEveningOT)
        .map((r) => ({ date: r.date }));

      // Handle PH changes: compare current rows against loaded publicHolidays
      const currentPHDates = new Set(rows.filter((r) => r.isPH).map((r) => r.date));
      const existingPHMap = new Map<string, PublicHoliday>();
      for (const ph of publicHolidays) existingPHMap.set(ph.date, ph);

      // PHs to delete: were in loaded data but user removed them
      const phToDelete: number[] = [];
      for (const ph of publicHolidays) {
        if (!currentPHDates.has(ph.date)) {
          phToDelete.push(ph.id);
        }
      }

      // PHs to create: user added them (not in loaded data)
      const phToCreate: { date: string; name: string }[] = [];
      for (const r of rows) {
        if (r.isPH && !existingPHMap.has(r.date)) {
          phToCreate.push({ date: r.date, name: r.phName });
        }
      }

      await Promise.all([
        api.setConsultantOnCall(configId, consEntries),
        api.setACOnCall(configId, acEntries),
        api.setStepdownDays(configId, stepdownEntries),
        api.setEveningOTDates(configId, eotEntries),
        ...phToDelete.map((id) => api.deletePublicHoliday(id)),
        ...phToCreate.map((ph) => api.createPublicHoliday(ph.date, ph.name)),
      ]);

      // Reload to get fresh PH data (with IDs for future deletes)
      await load();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  const weeks: (DayRow | null)[][] = [];
  let currentWeek: (DayRow | null)[] = [];
  if (rows.length > 0) {
    for (let i = 0; i < rows[0].dow; i++) currentWeek.push(null);
    for (const r of rows) {
      currentWeek.push(r);
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push(null);
      weeks.push(currentWeek);
    }
  }

  return (
    <div style={{ display: "flex", gap: 0, alignItems: "flex-start", minHeight: 0 }}>
      {/* Sidebar: unified list of all consultant-tier staff */}
      <div
        style={{
          width: 180,
          flexShrink: 0,
          marginRight: 16,
          position: "sticky",
          top: 0,
          maxHeight: "calc(100vh - 120px)",
          overflowY: "auto",
        }}
      >
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 11, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Consultant Staff</h3>
          {allConsultantTier.length === 0 && (
            <div className="team-empty">No consultant-tier staff</div>
          )}
          {allConsultantTier.map((s) => (
            <StaffCard key={s.id} staff={s} onDragStart={handleDragStart} />
          ))}
        </div>
      </div>

      {/* Calendar grid */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? <><span className="spinner" /> Saving...</> : "Save Changes"}
          </button>
          {dirty && <span style={{ fontSize: 12, color: "var(--warning)" }}>Unsaved changes</span>}
        </div>

        <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
          <thead>
            <tr>
              {DOW_HEADERS.map((d, i) => (
                <th
                  key={d}
                  style={{
                    background: i >= 5 ? "var(--weekend)" : "#f0f1f5",
                    border: "1px solid var(--border)",
                    padding: "6px 4px",
                    textAlign: "center",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((cell, ci) => {
                  if (!cell) {
                    return (
                      <td
                        key={ci}
                        style={{
                          background: "#f8f9fa",
                          border: "1px solid var(--border)",
                          verticalAlign: "top",
                          padding: 4,
                          height: 120,
                        }}
                      />
                    );
                  }
                  const idx = rows.indexOf(cell);
                  const primaryName = cell.consultantId ? staffById.get(cell.consultantId as number)?.name : undefined;
                  const supName = cell.supervisingId ? staffById.get(cell.supervisingId as number)?.name : undefined;
                  const acName = cell.acId ? staffById.get(cell.acId as number)?.name : undefined;

                  const secondaryType = getSecondarySlotType(cell);

                  return (
                    <td
                      key={ci}
                      style={{
                        background: cell.isPH
                          ? "#fef3c7"
                          : cell.isWeekend
                            ? "var(--weekend)"
                            : "var(--surface)",
                        border: "1px solid var(--border)",
                        verticalAlign: "top",
                        padding: 4,
                        height: 120,
                      }}
                    >
                      {/* Row 1: Day number + PH badge + stepdown/eot indicators */}
                      <div style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 3, minHeight: 18 }}>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{cell.dayNum}</span>
                        {cell.isPH ? (
                          <span
                            onClick={() => removePH(idx)}
                            title={`${cell.phName} — click to remove`}
                            style={{
                              fontSize: 9,
                              background: "#f59e0b",
                              color: "#fff",
                              borderRadius: 3,
                              padding: "0 3px",
                              cursor: "pointer",
                              fontWeight: 600,
                              maxWidth: 60,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              lineHeight: "16px",
                            }}
                          >
                            {cell.phName}
                          </span>
                        ) : (
                          <span
                            onClick={() => addPH(idx)}
                            title="Add Public Holiday"
                            style={{
                              fontSize: 10,
                              color: "var(--text-muted)",
                              cursor: "pointer",
                              lineHeight: "16px",
                              width: 14,
                              height: 14,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 2,
                              border: "1px solid var(--border)",
                            }}
                          >
                            +
                          </span>
                        )}
                        <span style={{ flex: 1 }} />
                        {cell.isStepdown && (
                          <span title="Stepdown" style={{ fontSize: 9, color: "#7c3aed", fontWeight: 700 }}>Stepdown</span>
                        )}
                        {cell.isEveningOT && (
                          <span title="Extended OT" style={{ fontSize: 9, color: "#dc2626", fontWeight: 700 }}>Extended OT</span>
                        )}
                      </div>

                      {/* Row 2: Primary On-Call slot */}
                      <DropSlot
                        label="On Call"
                        slotType="consultant"
                        filledName={primaryName}
                        slotKey={`${cell.date}:consultant`}
                        dragOverSlot={dragOverSlot}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={(st, e) => handleDrop(idx, st, e)}
                        onClear={() => clearSlot(idx, "consultant")}
                      />

                      {/* Row 3: Secondary slot — Supervising or AC depending on primary */}
                      {secondaryType === "supervising" && (
                        <DropSlot
                          label="Supervising"
                          slotType="supervising"
                          filledName={supName}
                          slotKey={`${cell.date}:supervising`}
                          dragOverSlot={dragOverSlot}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={(st, e) => handleDrop(idx, st, e)}
                          onClear={() => clearSlot(idx, "supervising")}
                        />
                      )}
                      {secondaryType === "ac" && (
                        <DropSlot
                          label="AC"
                          slotType="ac"
                          filledName={acName}
                          slotKey={`${cell.date}:ac`}
                          dragOverSlot={dragOverSlot}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={(st, e) => handleDrop(idx, st, e)}
                          onClear={() => clearSlot(idx, "ac")}
                        />
                      )}

                      {/* Row 4: Stepdown + Evening OT checkboxes */}
                      <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 3, fontSize: 9, color: "var(--text-muted)" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 2, cursor: "pointer" }} title="Stepdown day">
                          <input
                            type="checkbox"
                            checked={cell.isStepdown}
                            onChange={() => toggleStepdown(idx)}
                            style={{ width: 11, height: 11, margin: 0 }}
                          />
                          Stepdown
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 2, cursor: "pointer" }} title="Extended OT">
                          <input
                            type="checkbox"
                            checked={cell.isEveningOT}
                            onChange={() => toggleEveningOT(idx)}
                            style={{ width: 11, height: 11, margin: 0 }}
                          />
                          Extended OT
                        </label>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
