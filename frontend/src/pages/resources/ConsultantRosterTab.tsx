import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../../api";
import type { ConsultantOnCall, ACOnCall, Staff } from "../../types";
import { CONS_GRADES, AC_GRADES } from "./constants";

interface DayRow {
  date: string;
  dayName: string;
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

// ── Sidebar staff card ─────────────────────────────────────────────────────

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
      title={staff.grade}
      style={{ marginBottom: 4, cursor: "grab" }}
    >
      <span className="card-name">{staff.name}</span>
      <span className="card-grade">{staff.grade}</span>
    </div>
  );
}

// ── Single drop zone inside a day cell ────────────────────────────────────

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

// ── Main component ─────────────────────────────────────────────────────────

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

  // Consultants sidebar: grades in CONS_GRADES but NOT in AC_GRADES (i.e. Senior Consultant, Consultant)
  const consultants = staff.filter((s) => CONS_GRADES.includes(s.grade) && !AC_GRADES.includes(s.grade));
  // ACs sidebar: grades in AC_GRADES (Associate Consultant)
  const acs = staff.filter((s) => AC_GRADES.includes(s.grade));

  // Build lookup maps for names
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

    // Validate drop: consultants go to consultant/supervising, acs go to ac
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

  return (
    <div style={{ display: "flex", gap: 0, alignItems: "flex-start", minHeight: 0 }}>
      {/* ── Staff sidebar ── */}
      <div
        style={{
          width: 200,
          flexShrink: 0,
          marginRight: 16,
          position: "sticky",
          top: 0,
          maxHeight: "calc(100vh - 120px)",
          overflowY: "auto",
        }}
      >
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 11, marginBottom: 8 }}>Consultants</h3>
          {consultants.length === 0 && (
            <div className="team-empty">No consultants</div>
          )}
          {consultants.map((s) => (
            <StaffCard key={s.id} staff={s} staffType="consultant" onDragStart={handleDragStart} />
          ))}
        </div>
        <div className="card">
          <h3 style={{ fontSize: 11, marginBottom: 8 }}>ACs</h3>
          {acs.length === 0 && (
            <div className="team-empty">No ACs</div>
          )}
          {acs.map((s) => (
            <StaffCard key={s.id} staff={s} staffType="ac" onDragStart={handleDragStart} />
          ))}
        </div>
      </div>

      {/* ── Calendar grid ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? <><span className="spinner" /> Saving...</> : "Save Changes"}
          </button>
          {dirty && <span style={{ fontSize: 12, color: "var(--warning)" }}>Unsaved changes</span>}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", tableLayout: "fixed", minWidth: numDays * 110 }}>
            <colgroup>
              {rows.map((r) => (
                <col key={r.date} style={{ width: 110 }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {rows.map((r) => (
                  <th
                    key={r.date}
                    style={{
                      background: r.isWeekend ? "var(--weekend)" : "#f0f1f5",
                      border: "1px solid var(--border)",
                      padding: "6px 4px",
                      textAlign: "center",
                      fontSize: 12,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <div>{r.date.slice(8)}</div>
                    <div style={{ fontSize: 10, fontWeight: 400, color: "var(--text-muted)" }}>{r.dayName}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {rows.map((r, idx) => {
                  const consName = r.consultantId ? staffById.get(r.consultantId as number)?.name : undefined;
                  const supName = r.supervisingId ? staffById.get(r.supervisingId as number)?.name : undefined;
                  const acName = r.acId ? staffById.get(r.acId as number)?.name : undefined;
                  const slotBase = `${r.date}`;

                  return (
                    <td
                      key={r.date}
                      style={{
                        background: r.isWeekend ? "var(--weekend)" : "var(--surface)",
                        border: "1px solid var(--border)",
                        verticalAlign: "top",
                        padding: "4px",
                        minHeight: 80,
                      }}
                    >
                      <DropSlot
                        label="Consultant"
                        slotType="consultant"
                        filledName={consName}
                        slotKey={`${slotBase}:consultant`}
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
                        disabled={!r.consultantId}
                        slotKey={`${slotBase}:supervising`}
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
                        slotKey={`${slotBase}:ac`}
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
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
