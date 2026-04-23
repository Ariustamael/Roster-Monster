import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../../api";
import type { ConsultantOnCall, ACOnCall, Staff } from "../../types";
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
}

type SlotType = "consultant" | "supervising" | "ac";

interface DragPayload {
  staffId: number;
  staffType: "consultant" | "ac";
}

function StaffCard({
  staff,
  staffType,
  onDragStart,
}: {
  staff: Staff;
  staffType: "consultant" | "ac";
  onDragStart: (payload: DragPayload) => void;
}) {
  return (
    <div
      className="team-card"
      draggable
      onDragStart={() => onDragStart({ staffId: staff.id, staffType })}
      title={staff.rank}
      style={{ marginBottom: 4, cursor: "grab" }}
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
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const dragPayload = useRef<DragPayload | null>(null);

  const numDays = new Date(year, month, 0).getDate();

  const load = useCallback(async () => {
    setLoading(true);
    const [consRows, acRows, allStaff] = await Promise.all([
      api.getConsultantOnCall(configId),
      api.getACOnCall(configId),
      api.getStaff(),
    ]);
    setStaff(allStaff);

    const consMap = new Map<string, ConsultantOnCall>();
    for (const r of consRows) consMap.set(r.date, r);
    const acMap = new Map<string, ACOnCall>();
    for (const r of acRows) acMap.set(r.date, r);

    const dayRows: DayRow[] = [];
    for (let d = 1; d <= numDays; d++) {
      const dt = new Date(year, month - 1, d);
      const dateStr = dt.toISOString().slice(0, 10);
      const cons = consMap.get(dateStr);
      const ac = acMap.get(dateStr);
      dayRows.push({
        date: dateStr,
        dayName: dt.toLocaleDateString("en", { weekday: "short" }),
        dayNum: d,
        dow: (dt.getDay() + 6) % 7,
        isWeekend: dt.getDay() === 0 || dt.getDay() === 6,
        consultantId: cons?.consultant_id ?? "",
        supervisingId: cons?.supervising_consultant_id ?? "",
        acId: ac?.ac_id ?? "",
      });
    }
    setRows(dayRows);
    setDirty(false);
    setLoading(false);
  }, [configId, year, month, numDays]);

  useEffect(() => { load(); }, [load]);

  const consultants = staff.filter((s) => CONS_RANKS.includes(s.rank) && !AC_RANKS.includes(s.rank));
  const acs = staff.filter((s) => AC_RANKS.includes(s.rank));
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

  function handleDrop(rowIdx: number, slotType: SlotType, e: React.DragEvent) {
    e.preventDefault();
    setDragOverSlot(null);
    const payload = dragPayload.current;
    if (!payload) return;

    if (slotType === "ac" && payload.staffType !== "ac") return;
    if ((slotType === "consultant" || slotType === "supervising") && payload.staffType !== "consultant") return;

    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIdx) return r;
        if (slotType === "consultant") return { ...r, consultantId: payload.staffId };
        if (slotType === "supervising") return { ...r, supervisingId: payload.staffId };
        return { ...r, acId: payload.staffId };
      })
    );
    setDirty(true);
    dragPayload.current = null;
  }

  function clearSlot(rowIdx: number, slotType: SlotType) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIdx) return r;
        if (slotType === "consultant") return { ...r, consultantId: "", supervisingId: "" };
        if (slotType === "supervising") return { ...r, supervisingId: "" };
        return { ...r, acId: "" };
      })
    );
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const consEntries = rows
        .filter((r) => r.consultantId !== "")
        .map((r) => ({
          date: r.date,
          consultant_id: r.consultantId as number,
          supervising_consultant_id: r.supervisingId || null,
        }));
      const acEntries = rows
        .filter((r) => r.acId !== "")
        .map((r) => ({ date: r.date, ac_id: r.acId as number }));

      await Promise.all([
        api.setConsultantOnCall(configId, consEntries),
        api.setACOnCall(configId, acEntries),
      ]);
      setDirty(false);
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
          <h3 style={{ fontSize: 11, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Consultants</h3>
          {consultants.length === 0 && (
            <div className="team-empty">No consultants</div>
          )}
          {consultants.map((s) => (
            <StaffCard key={s.id} staff={s} staffType="consultant" onDragStart={handleDragStart} />
          ))}
        </div>
        <div className="card">
          <h3 style={{ fontSize: 11, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>ACs</h3>
          {acs.length === 0 && (
            <div className="team-empty">No ACs</div>
          )}
          {acs.map((s) => (
            <StaffCard key={s.id} staff={s} staffType="ac" onDragStart={handleDragStart} />
          ))}
        </div>
      </div>

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
                          height: 90,
                        }}
                      />
                    );
                  }
                  const idx = rows.indexOf(cell);
                  const consName = cell.consultantId ? staffById.get(cell.consultantId as number)?.name : undefined;
                  const supName = cell.supervisingId ? staffById.get(cell.supervisingId as number)?.name : undefined;
                  const acName = cell.acId ? staffById.get(cell.acId as number)?.name : undefined;

                  return (
                    <td
                      key={ci}
                      style={{
                        background: cell.isWeekend ? "var(--weekend)" : "var(--surface)",
                        border: "1px solid var(--border)",
                        verticalAlign: "top",
                        padding: 4,
                        height: 90,
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{cell.dayNum}</div>
                      <DropSlot
                        label="Consultant"
                        slotType="consultant"
                        filledName={consName}
                        slotKey={`${cell.date}:consultant`}
                        dragOverSlot={dragOverSlot}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={(st, e) => handleDrop(idx, st, e)}
                        onClear={() => clearSlot(idx, "consultant")}
                      />
                      <DropSlot
                        label="Supervising"
                        slotType="supervising"
                        filledName={supName}
                        disabled={!cell.consultantId}
                        slotKey={`${cell.date}:supervising`}
                        dragOverSlot={dragOverSlot}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={(st, e) => handleDrop(idx, st, e)}
                        onClear={() => clearSlot(idx, "supervising")}
                      />
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
