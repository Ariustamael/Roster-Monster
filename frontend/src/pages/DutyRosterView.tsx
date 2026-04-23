import { useEffect, useState } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import type { DutyRosterResponse, DayDutyRoster, DutyAssignment } from "../types";

export default function DutyRosterView() {
  const { active } = useConfig();
  const [roster, setRoster] = useState<DutyRosterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  if (!active) return <p style={{ color: "var(--text-muted)" }}>Select a month in the sidebar.</p>;

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
          {roster.days
            .filter((d) => !d.is_weekend && !d.is_ph)
            .map((day) => (
              <DayCard key={day.date} day={day} />
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

function clinicRoomHeader(room: string, assignment: DutyAssignment): string {
  const parts: string[] = [];
  if (assignment.clinic_type) parts.push(assignment.clinic_type);
  parts.push(room);
  const label = parts.join(": ");
  return assignment.consultant_name ? `${label} (${assignment.consultant_name})` : label;
}

function DayCard({ day }: { day: DayDutyRoster }) {
  // OT groups (regular)
  const otGroups: Record<string, { consultant: string | null; staff: DutyAssignment[] }> = {};
  for (const a of day.ot_assignments) {
    const key = a.location || "OT";
    if (!otGroups[key]) otGroups[key] = { consultant: a.consultant_name, staff: [] };
    otGroups[key].staff.push(a);
  }

  // EOT groups — merged into the OT column
  const eotGroups: Record<string, { staff: DutyAssignment[] }> = {};
  for (const a of day.eot_assignments) {
    const key = a.location || "EOT";
    if (!eotGroups[key]) eotGroups[key] = { staff: [] };
    eotGroups[key].staff.push(a);
  }

  const clinicAm = day.am_clinics.filter((a) => a.duty_type !== "MOPD");
  const mopdAm = day.am_clinics.filter((a) => a.duty_type === "MOPD");
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

  // MO list for the call team column
  const moList: Array<{ label: string; name: string }> = [
    { label: "MO1", name: day.mo1 ?? "" },
    { label: "MO2", name: day.mo2 ?? "" },
    { label: "MO3", name: day.mo3 ?? "" },
    { label: "MO4", name: day.mo4 ?? "" },
    { label: "MO5", name: day.mo5 ?? "" },
  ].filter((m) => m.name);

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>{day.date.slice(5)} {day.day_name}</h3>
        {day.post_call.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Post-call:</span>
            {day.post_call.map((n) => (
              <span key={n} className="duty-tag" style={{ background: "#fee2e2", color: "#991b1b" }}>{n}</span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr 1fr 1fr", gap: 12 }}>
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
          {!day.consultant_oncall && !day.ac_oncall && moList.length === 0 && <EmptyNote />}
        </div>

        {/* Column 2: OT / EOT */}
        <div>
          <SectionLabel label="OT / EOT (Full Day)" color="var(--ot-bg)" />
          {Object.keys(otGroups).length === 0 && Object.keys(eotGroups).length === 0 && <EmptyNote />}
          {Object.entries(otGroups).map(([room, g]) => (
            <div key={room} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#1e40af" }}>
                {room} {g.consultant && <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>({g.consultant})</span>}
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {g.staff.map((a) => (
                  <span key={a.staff_id} className="duty-tag ot">{a.staff_name}</span>
                ))}
              </div>
            </div>
          ))}
          {Object.entries(eotGroups).map(([room, g]) => (
            <div key={room} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e" }}>⚡{room}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {g.staff.map((a) => (
                  <span key={a.staff_id} className="duty-tag" style={{ background: "#fef3c7", color: "#92400e" }}>{a.staff_name}</span>
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
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#065f46" }}>
                    {clinicRoomHeader(room, staff[0])}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {staff.map((a) => (
                      <span key={a.staff_id} className="duty-tag clinic">{a.staff_name}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {mopdAm.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>MOPD</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {mopdAm.map((a) => <span key={a.staff_id} className="duty-tag mopd">{a.staff_name}</span>)}
              </div>
            </div>
          )}
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>ADMIN</div>
            {day.am_admin.length === 0 && <EmptyNote />}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {day.am_admin.map((n) => <span key={n} className="duty-tag admin">{n}</span>)}
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
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#065f46" }}>
                    {clinicRoomHeader(room, staff[0])}
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {staff.map((a) => (
                      <span key={a.staff_id} className="duty-tag clinic">{a.staff_name}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {mopdPm.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>MOPD</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {mopdPm.map((a) => <span key={a.staff_id} className="duty-tag mopd">{a.staff_name}</span>)}
              </div>
            </div>
          )}
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 4 }}>ADMIN</div>
            {day.pm_admin.length === 0 && <EmptyNote />}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {day.pm_admin.map((n) => <span key={n} className="duty-tag admin">{n}</span>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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
