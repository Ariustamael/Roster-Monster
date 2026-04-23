import { useEffect, useState } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import type { DutyRosterResponse, DayDutyRoster } from "../types";

export default function DutyRosterView() {
  const { active } = useConfig();
  const [roster, setRoster] = useState<DutyRosterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const configId = active?.id ?? 0;

  useEffect(() => {
    setRoster(null);
    if (!configId) return;
    api.viewDutyRoster(configId)
      .then((data) => setRoster(data))
      .catch(() => {});
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
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Day</th>
                  <th>OT</th>
                  <th>Supervised AM</th>
                  <th>MOPD AM</th>
                  <th>Admin AM</th>
                  <th>Supervised PM</th>
                  <th>MOPD PM</th>
                  <th>Admin PM</th>
                </tr>
              </thead>
              <tbody>
                {roster.days
                  .filter((d) => !d.is_weekend && !d.is_ph)
                  .map((day) => (
                    <DutyRow key={day.date} day={day} />
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function DutyRow({ day }: { day: DayDutyRoster }) {
  const otGroups: Record<string, string[]> = {};
  for (const a of day.ot_assignments) {
    const key = `${a.location} (${a.consultant_name})`;
    if (!otGroups[key]) otGroups[key] = [];
    otGroups[key].push(a.staff_name);
  }

  const supAm = day.am_clinics
    .filter((a) => a.duty_type !== "MOPD")
    .map((a) => `${a.staff_name}`);
  const mopdAm = day.am_clinics
    .filter((a) => a.duty_type === "MOPD")
    .map((a) => a.staff_name);
  const supPm = day.pm_clinics
    .filter((a) => a.duty_type !== "MOPD")
    .map((a) => `${a.staff_name}`);
  const mopdPm = day.pm_clinics
    .filter((a) => a.duty_type === "MOPD")
    .map((a) => a.staff_name);

  return (
    <tr>
      <td>{day.date.slice(5)}</td>
      <td>{day.day_name}</td>
      <td>
        {Object.entries(otGroups).map(([room, names]) => (
          <div key={room}>
            <span className="duty-tag ot">{room}</span>{" "}
            {names.join(", ")}
          </div>
        ))}
      </td>
      <td>{supAm.map((n) => <span key={n} className="duty-tag clinic">{n}</span>)}</td>
      <td>{mopdAm.map((n) => <span key={n} className="duty-tag mopd">{n}</span>)}</td>
      <td>{day.am_admin.map((n) => <span key={n} className="duty-tag admin">{n}</span>)}</td>
      <td>{supPm.map((n) => <span key={n} className="duty-tag clinic">{n}</span>)}</td>
      <td>{mopdPm.map((n) => <span key={n} className="duty-tag mopd">{n}</span>)}</td>
      <td>{day.pm_admin.map((n) => <span key={n} className="duty-tag admin">{n}</span>)}</td>
    </tr>
  );
}

function monthName(m: number) {
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m];
}
