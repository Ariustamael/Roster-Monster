import { useState } from "react";
import { api } from "../../api";
import type { ResourceDay } from "../../types";

export default function SupplyDemandTab({ configId }: { configId: number }) {
  const [days, setDays] = useState<ResourceDay[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api.getResources(configId);
      setDays(data.days);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={load} disabled={loading}>
          {loading ? <><span className="spinner" /> Loading...</> : "Load Resources"}
        </button>
      </div>

      {days && (
        <>
          <SummaryCards days={days} />
          <div className="card" style={{ marginTop: 16 }}>
            <div className="table-wrap">
              <table className="resources-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th>OT Rooms</th>
                    <th>OT Asst</th>
                    <th>Clinic Slots</th>
                    <th>Call Slots</th>
                    <th>Total MOs</th>
                    <th>On Leave</th>
                    <th>On Call</th>
                    <th>Post-Call</th>
                    <th>Available</th>
                    <th>Duty Need</th>
                    <th>Surplus</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr
                      key={d.date}
                      className={`${d.is_weekend ? "weekend" : ""} ${d.is_ph ? "ph" : ""}`}
                    >
                      <td>{d.date.slice(5)}</td>
                      <td>{d.day_name}{d.is_ph ? " (PH)" : ""}</td>
                      <td>{d.ot_rooms || "-"}</td>
                      <td>{d.ot_assistants_needed || "-"}</td>
                      <td>{d.clinic_slots || "-"}</td>
                      <td>{d.call_slots}</td>
                      <td>{d.total_mos}</td>
                      <td className={d.on_leave > 0 ? "leave-cell" : ""}>{d.on_leave || "-"}</td>
                      <td>{d.on_call || "-"}</td>
                      <td>{d.post_call || "-"}</td>
                      <td style={{ fontWeight: 600 }}>{d.available}</td>
                      <td>{d.needed_for_duties || "-"}</td>
                      <td className={d.surplus < 0 ? "deficit" : d.surplus <= 2 ? "tight" : "surplus"}>
                        {d.is_weekend || d.is_ph ? "-" : d.surplus}
                      </td>
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

function SummaryCards({ days }: { days: ResourceDay[] }) {
  const weekdays = days.filter((d) => !d.is_weekend && !d.is_ph);
  const shortDays = weekdays.filter((d) => d.surplus < 0);
  const tightDays = weekdays.filter((d) => d.surplus >= 0 && d.surplus <= 2);
  const totalOTRooms = weekdays.reduce((s, d) => s + d.ot_rooms, 0);
  const avgAvailable = weekdays.length > 0
    ? (weekdays.reduce((s, d) => s + d.available, 0) / weekdays.length).toFixed(1)
    : "0";

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <div className="summary-card">
        <div className="summary-value">{weekdays.length}</div>
        <div className="summary-label">Weekdays</div>
      </div>
      <div className="summary-card">
        <div className="summary-value">{totalOTRooms}</div>
        <div className="summary-label">OT Room-Days</div>
      </div>
      <div className="summary-card">
        <div className="summary-value">{avgAvailable}</div>
        <div className="summary-label">Avg Available MOs</div>
      </div>
      <div className={`summary-card ${shortDays.length > 0 ? "summary-danger" : ""}`}>
        <div className="summary-value">{shortDays.length}</div>
        <div className="summary-label">Short-Staffed Days</div>
      </div>
      <div className={`summary-card ${tightDays.length > 3 ? "summary-warn" : ""}`}>
        <div className="summary-value">{tightDays.length}</div>
        <div className="summary-label">Tight Days (&le;2)</div>
      </div>
    </div>
  );
}
