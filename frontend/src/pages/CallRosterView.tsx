import { useState } from "react";
import { api } from "../api";
import type { RosterResponse } from "../types";

export default function CallRosterView() {
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const data = await api.generateCallRoster(1);
      setRoster(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>Call Roster {roster ? `- ${monthName(roster.month)} ${roster.year}` : ""}</h2>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={generate} disabled={loading}>
            {loading ? <><span className="spinner" /> Generating...</> : "Generate Call Roster"}
          </button>
        </div>
      </div>

      {error && <div className="violations"><h4>Error</h4><p>{error}</p></div>}

      {roster && (
        <>
          {roster.violations.length === 0 ? (
            <span className="success-badge">0 violations</span>
          ) : (
            <div className="violations">
              <h4>{roster.violations.length} Violations</h4>
              <ul>{roster.violations.map((v, i) => <li key={i}>{v}</li>)}</ul>
            </div>
          )}

          <div className="card" style={{ marginTop: 12 }}>
            <div className="table-wrap">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th>Consultant</th>
                    <th>AC</th>
                    <th>MO1</th>
                    <th>MO2</th>
                    <th>MO3</th>
                    <th>MO4</th>
                    <th>MO5</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.days.map((day) => (
                    <tr
                      key={day.date}
                      className={`${day.is_weekend ? "weekend" : ""} ${day.is_ph ? "ph" : ""}`}
                    >
                      <td>{day.date.slice(5)}</td>
                      <td>{day.day_name}</td>
                      <td>{day.consultant_oncall || "-"}</td>
                      <td>{day.ac_oncall || "-"}</td>
                      <td className="mo1">{day.mo1 || "-"}</td>
                      <td>{day.mo2 || "-"}</td>
                      <td className={day.mo3 ? "" : "empty"}>
                        {day.mo3 || (day.is_weekend && !day.is_stepdown ? "-" : "-")}
                      </td>
                      <td className={day.mo4 ? "" : "empty"}>{day.mo4 || "-"}</td>
                      <td className={day.mo5 ? "" : "empty"}>{day.mo5 || "-"}</td>
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

function monthName(m: number) {
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m];
}
