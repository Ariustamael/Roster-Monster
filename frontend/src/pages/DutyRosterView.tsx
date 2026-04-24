import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import type { DutyRosterResponse, DayDutyRoster, DutyAssignment } from "../types";

interface DragState {
  assignmentId: number;
  staffId: number;
  staffName: string;
  date: string;
}

export default function DutyRosterView() {
  const { active } = useConfig();
  const [roster, setRoster] = useState<DutyRosterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dragRef = useRef<DragState | null>(null);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());

  const configId = active?.id ?? 0;

  useEffect(() => {
    setRoster(null);
    if (!configId) return;
    api.viewDutyRoster(configId).catch(() => null).then((data) => {
      if (data) setRoster(data);
    });
  }, [configId]);

  async function generate() {
    if (!configId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.generateDutyRoster(configId);
      setRoster(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function exportFile(format: "original" | "clean") {
    try {
      await api.exportRoster(configId, format);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDrop(
    targetDutyType: string,
    targetSession: string,
    targetLocation: string | null,
    targetConsultantId: number | null,
    targetDate: string,
  ) {
    const drag = dragRef.current;
    if (!drag || drag.date !== targetDate) return;

    try {
      await api.setDutyOverride(configId, {
        date: targetDate,
        staff_id: drag.staffId,
        session: targetSession,
        duty_type: targetDutyType,
        location: targetLocation,
        consultant_id: targetConsultantId,
        old_assignment_id: drag.assignmentId,
      });
      const data = await api.viewDutyRoster(configId);
      setRoster(data);
    } catch (e: any) {
      setError(e.message);
    }
    dragRef.current = null;
  }

  async function handleRemoveToAdmin(assignmentId: number, staffId: number, date: string, currentSession: string) {
    try {
      await api.setDutyOverride(configId, {
        date,
        staff_id: staffId,
        session: currentSession,
        duty_type: "Admin",
        location: null,
        consultant_id: null,
        old_assignment_id: assignmentId,
      });
      const data = await api.viewDutyRoster(configId);
      setRoster(data);
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (!active) return <p style={{ color: "var(--text-muted)" }}>Select a month in the sidebar.</p>;

  const callColumns = roster?.call_type_columns ?? [];

  return (
    <>
      <div className="page-header">
        <h2>Duty Roster {roster ? `- ${monthName(roster.month)} ${roster.year}` : ""}</h2>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={generate} disabled={loading}>
            {loading ? <><span className="spinner" /> Generating...</> : "Generate Duty Roster"}
          </button>
          {roster && (
            <>
              <button className="btn btn-secondary" onClick={() => exportFile("original")}>
                Export Original
              </button>
              <button className="btn btn-secondary" onClick={() => exportFile("clean")}>
                Export Clean
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className="violations"><h4>Error</h4><p>{error}</p></div>}

      {roster && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              Drag any name tag to reassign. Right-click to remove.
            </p>
            <span style={{ flex: 1 }} />
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: "2px 8px" }}
              onClick={() => {
                const weekdays = roster.days.filter(d => !d.is_weekend && !d.is_ph).map(d => d.date);
                setCollapsedDays(new Set(weekdays));
              }}>Collapse All</button>
            <button className="btn btn-secondary" style={{ fontSize: 11, padding: "2px 8px" }}
              onClick={() => setCollapsedDays(new Set())}>Expand All</button>
          </div>

          {roster.days
            .filter((d) => !d.is_weekend && !d.is_ph)
            .map((day) => (
              <DayCard
                key={day.date}
                day={day}
                callColumns={callColumns}
                dragRef={dragRef}
                onDrop={handleDrop}
                onRemove={handleRemoveToAdmin}
                collapsed={collapsedDays.has(day.date)}
                onToggleCollapse={() => setCollapsedDays(prev => {
                  const next = new Set(prev);
                  if (next.has(day.date)) next.delete(day.date); else next.add(day.date);
                  return next;
                })}
              />
            ))}

          <div className="card" style={{ marginTop: 20 }}>
            <h3>Duty Statistics</h3>
            <div className="table-wrap">
              <table className="fairness-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>OT Days</th>
                    <th>EOT Days</th>
                    <th>Ward MO</th>
                    <th>EOT MO</th>
                    <th>Supervised</th>
                    <th>MOPD</th>
                    <th>Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(roster.duty_stats)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([name, s]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td>{s.ot_days}</td>
                        <td>{s.eot_days}</td>
                        <td>{(s as any).ward_mo_sessions ?? 0}</td>
                        <td>{(s as any).eot_mo_sessions ?? 0}</td>
                        <td>{s.supervised_sessions}</td>
                        <td>{s.mopd_sessions}</td>
                        <td>{s.admin_sessions}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function DayCard({
  day, callColumns, dragRef, onDrop, onRemove, collapsed, onToggleCollapse,
}: {
  day: DayDutyRoster;
  callColumns: string[];
  dragRef: React.MutableRefObject<DragState | null>;
  onDrop: (dutyType: string, session: string, location: string | null, consultantId: number | null, date: string) => void;
  onRemove: (assignmentId: number, staffId: number, date: string, session: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);

  const otGroups: Record<string, { consultant: string | null; consultantId: number | null; staff: DutyAssignment[] }> = {};
  for (const a of day.ot_assignments) {
    const key = a.location || "OT";
    if (!otGroups[key]) otGroups[key] = { consultant: a.consultant_name, consultantId: a.consultant_id, staff: [] };
    otGroups[key].staff.push(a);
  }

  const eotGroups: Record<string, { consultantId: number | null; staff: DutyAssignment[] }> = {};
  for (const a of day.eot_assignments) {
    if (a.duty_type === "EOT MO" || a.duty_type === "Ward MO") continue;
    const key = a.location || "EOT";
    if (!eotGroups[key]) eotGroups[key] = { consultantId: a.consultant_id, staff: [] };
    eotGroups[key].staff.push(a);
  }

  const clinicAm = day.am_clinics.filter((a) => a.duty_type !== "MOPD");
  const mopdAm = day.am_clinics.filter((a) => a.duty_type === "MOPD");
  const wardMo = [...day.ot_assignments, ...day.eot_assignments].filter((a) => a.duty_type === "Ward MO");
  const eotMo = [...day.ot_assignments, ...day.eot_assignments].filter((a) => a.duty_type === "EOT MO");
  const clinicPm = day.pm_clinics.filter((a) => a.duty_type !== "MOPD");
  const mopdPm = day.pm_clinics.filter((a) => a.duty_type === "MOPD");

  const clinicAmByRoom: Record<string, DutyAssignment[]> = {};
  for (const a of clinicAm) {
    const key = a.location || "Clinic";
    if (!clinicAmByRoom[key]) clinicAmByRoom[key] = [];
    clinicAmByRoom[key].push(a);
  }
  const clinicPmByRoom: Record<string, DutyAssignment[]> = {};
  for (const a of clinicPm) {
    const key = a.location || "Clinic";
    if (!clinicPmByRoom[key]) clinicPmByRoom[key] = [];
    clinicPmByRoom[key].push(a);
  }

  const moList = callColumns
    .map((col) => ({ label: col, name: day.call_slots[col] ?? "" }))
    .filter((m) => m.name);

  function dropProps(zoneKey: string, dutyType: string, session: string, location: string | null, consultantId: number | null) {
    return {
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(zoneKey); },
      onDragLeave: () => setDragOver(null),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(null);
        onDrop(dutyType, session, location, consultantId, day.date);
      },
      style: {
        outline: dragOver === zoneKey ? "2px dashed #6366f1" : undefined,
        borderRadius: 4,
        minHeight: 24,
      },
    };
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: collapsed ? 0 : 10, cursor: "pointer" }}
        onClick={onToggleCollapse}
      >
        <span style={{ fontSize: 12, color: "var(--text-muted)", width: 16, textAlign: "center" }}>{collapsed ? "▶" : "▼"}</span>
        <h3 style={{ margin: 0 }}>{day.date.slice(5)} {day.day_name}</h3>
        {day.unavailable.length > 0 && (
          <span style={{ fontSize: 10, color: "#991b1b", fontWeight: 600 }}>{day.unavailable.length} unavailable</span>
        )}
      </div>

      {!collapsed && <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 1fr 1fr 140px", gap: 12 }}>
        {/* Column 1: Call Team */}
        <div>
          <SectionLabel label="Call Team" color="#ede9fe" />
          {day.consultant_oncall && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>Consultant </span>
              <span className="duty-tag" style={{ background: "#ddd6fe", color: "#4c1d95" }}>{day.consultant_oncall}</span>
            </div>
          )}
          {day.ac_oncall && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>AC </span>
              <span className="duty-tag" style={{ background: "#e9d5ff", color: "#6b21a8" }}>{day.ac_oncall}</span>
            </div>
          )}
          {moList.map((m) => (
            <div key={m.label} style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>{m.label} </span>
              <span className="duty-tag" style={{ background: "#f3e8ff", color: "#7e22ce" }}>{m.name}</span>
            </div>
          ))}
          {wardMo.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>Ward MO </span>
              <div {...dropProps("ward_mo", "Ward MO", "AM", null, null)} style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
                {wardMo.map((a) => (
                  <DragTag key={a.id} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                    color={{ bg: "#fef3c7", fg: "#92400e" }} />
                ))}
              </div>
            </div>
          )}
          {eotMo.length > 0 && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>EOT MO </span>
              <div {...dropProps("eot_mo", "EOT MO", "Full Day", null, null)} style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
                {eotMo.map((a) => (
                  <DragTag key={a.id} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                    color={{ bg: "#fed7aa", fg: "#c2410c" }} />
                ))}
              </div>
            </div>
          )}
          {!day.consultant_oncall && !day.ac_oncall && moList.length === 0 && wardMo.length === 0 && eotMo.length === 0 && <EmptyNote />}
        </div>

        {/* Column 2: OT / EOT */}
        <div>
          <SectionLabel label="OT / EOT (Full Day)" color="var(--ot-bg)" />
          {Object.keys(otGroups).length === 0 && Object.keys(eotGroups).length === 0 && <EmptyNote />}
          {Object.entries(otGroups).map(([room, g]) => (
            <div key={room} style={{ marginBottom: 6 }}>
              <div
                style={{ fontSize: 11, fontWeight: 700, color: "#1e40af", cursor: "default" }}
                {...dropProps(`ot_${room}`, "OT", "Full Day", room, g.consultantId)}
              >
                {room} {g.consultant && <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>({g.consultant})</span>}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {g.staff.map((a) => (
                  <DragTag key={a.id} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                    color={{ bg: undefined, fg: undefined }} className="duty-tag ot" />
                ))}
              </div>
            </div>
          ))}
          {Object.entries(eotGroups).map(([room, g]) => (
            <div key={room} style={{ marginBottom: 6 }}>
              <div
                style={{ fontSize: 11, fontWeight: 700, color: "#92400e", cursor: "default" }}
                {...dropProps(`eot_${room}`, "EOT", "Full Day", room, g.consultantId)}
              >
                ⚡{room}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {g.staff.map((a) => (
                  <DragTag key={a.id} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                    color={{ bg: "#fef3c7", fg: "#92400e" }} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Column 3: AM */}
        <div>
          <SectionLabel label="AM" color="#d1fae5" />
          {Object.keys(clinicAmByRoom).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>CLINICS</div>
              {Object.entries(clinicAmByRoom).map(([room, staff]) => (
                <div key={room} style={{ marginBottom: 4 }}>
                  <div
                    style={{ fontSize: 11, fontWeight: 600, color: "#065f46" }}
                    {...dropProps(`am_clinic_${room}`, staff[0]?.duty_type || "Clinic", "AM", room, staff[0]?.consultant_id ?? null)}
                  >
                    {clinicRoomHeader(room, staff[0])}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {staff.map((a) => (
                      <DragTag key={a.id} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                        color={{ bg: undefined, fg: undefined }} className="duty-tag clinic" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {mopdAm.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div
                style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}
                {...dropProps("am_mopd", "MOPD", "AM", "MOPD", null)}
              >
                MOPD
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {mopdAm.map((a) => <DragTag key={a.id} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                  color={{ bg: undefined, fg: undefined }} className="duty-tag mopd" />)}
              </div>
            </div>
          )}
          <div style={{ marginBottom: 4 }}>
            <div
              style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}
              {...dropProps("am_admin", "Admin", "AM", null, null)}
            >
              ADMIN
            </div>
            {day.am_admin.length === 0 && <EmptyNote />}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {day.am_admin.map((a) => (
                <DragTag key={a.id} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                  color={{ bg: undefined, fg: undefined }} className="duty-tag admin" />
              ))}
            </div>
          </div>
        </div>

        {/* Column 4: PM */}
        <div>
          <SectionLabel label="PM" color="#dbeafe" />
          {Object.keys(clinicPmByRoom).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>CLINICS</div>
              {Object.entries(clinicPmByRoom).map(([room, staff]) => (
                <div key={room} style={{ marginBottom: 4 }}>
                  <div
                    style={{ fontSize: 11, fontWeight: 600, color: "#065f46" }}
                    {...dropProps(`pm_clinic_${room}`, staff[0]?.duty_type || "Clinic", "PM", room, staff[0]?.consultant_id ?? null)}
                  >
                    {clinicRoomHeader(room, staff[0])}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {staff.map((a) => (
                      <DragTag key={a.id} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                        color={{ bg: undefined, fg: undefined }} className="duty-tag clinic" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {mopdPm.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div
                style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}
                {...dropProps("pm_mopd", "MOPD", "PM", "MOPD", null)}
              >
                MOPD
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {mopdPm.map((a) => <DragTag key={a.id} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                  color={{ bg: undefined, fg: undefined }} className="duty-tag mopd" />)}
              </div>
            </div>
          )}
          <div style={{ marginBottom: 4 }}>
            <div
              style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}
              {...dropProps("pm_admin", "Admin", "PM", null, null)}
            >
              ADMIN
            </div>
            {day.pm_admin.length === 0 && <EmptyNote />}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {day.pm_admin.map((a) => (
                <DragTag key={a.id} a={a} date={day.date} dragRef={dragRef} onRemove={onRemove}
                  color={{ bg: undefined, fg: undefined }} className="duty-tag admin" />
              ))}
            </div>
          </div>
        </div>

        {/* Column 5: Unavailable */}
        <div>
          <SectionLabel label="Unavailable" color="#fee2e2" />
          {day.unavailable.length === 0 && <EmptyNote />}
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {day.unavailable.map((u) => (
              <span
                key={`${u.staff_id}-${u.reason}`}
                className="duty-tag"
                draggable
                style={{ background: "#fecaca", color: "#991b1b", cursor: "grab", userSelect: "none" }}
                onDragStart={() => {
                  dragRef.current = {
                    assignmentId: 0,
                    staffId: u.staff_id,
                    staffName: u.staff_name,
                    date: day.date,
                  };
                }}
                title={u.reason}
              >
                {u.staff_name}
                <sup style={{ fontSize: 8, marginLeft: 2 }}>{u.reason === "Post-call" ? "PC" : "L"}</sup>
              </span>
            ))}
          </div>
        </div>
      </div>}
    </div>
  );
}

function DragTag({
  a, date, dragRef, onRemove, color, className,
}: {
  a: DutyAssignment;
  date: string;
  dragRef: React.MutableRefObject<DragState | null>;
  onRemove: (id: number, staffId: number, date: string, session: string) => void;
  color: { bg?: string; fg?: string };
  className?: string;
}) {
  const session = a.session ?? "AM";
  return (
    <span
      draggable
      className={className || "duty-tag"}
      style={{
        background: color.bg,
        color: color.fg,
        cursor: "grab",
        userSelect: "none",
      }}
      onDragStart={() => {
        dragRef.current = {
          assignmentId: a.id,
          staffId: a.staff_id,
          staffName: a.staff_name,
          date,
        };
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onRemove(a.id, a.staff_id, date, session);
      }}
      title="Drag to move · Right-click to send to Admin"
    >
      {a.staff_name}
      {a.is_manual_override && <sup style={{ fontSize: 8, color: "#6366f1" }}>✎</sup>}
    </span>
  );
}

function clinicRoomHeader(room: string, assignment: DutyAssignment): string {
  const parts: string[] = [];
  if (assignment.clinic_type) parts.push(assignment.clinic_type);
  parts.push(room);
  const label = parts.join(": ");
  return assignment.consultant_name ? `${label} (${assignment.consultant_name})` : label;
}

function SectionLabel({ label, color }: { label: string; color: string }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 700, padding: "4px 8px",
      background: color, borderRadius: 4, marginBottom: 8,
      textTransform: "uppercase", letterSpacing: 0.5,
    }}>
      {label}
    </div>
  );
}

function EmptyNote() {
  return <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>—</div>;
}

function monthName(m: number) {
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m];
}
