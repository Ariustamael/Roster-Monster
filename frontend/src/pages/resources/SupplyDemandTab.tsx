import { useEffect, useState } from "react";
import { api } from "../../api";
import { useConfig } from "../../context/ConfigContext";
import type { ResourceDay } from "../../types";

export default function SupplyDemandTab({ configId }: { configId: number }) {
  const { active } = useConfig();
  const [days, setDays] = useState<ResourceDay[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getResources(configId)
      .then((data) => setDays(data.days))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [configId]);

  if (loading) return <div className="loading"><span className="spinner" /> Loading...</div>;

  const monthLabel = active
    ? new Date(active.year, active.month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : "";

  return (
    <>
      <div className="page-header" style={{ marginBottom: 14 }}>
        <h2>Supply / Demand{monthLabel ? ` - ${monthLabel}` : ""}</h2>
      </div>

      {days && (
        <>
          <SummaryCards days={days} />

          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "12px 0 8px" }}>
            <strong>Available</strong> = active MOs minus leave / on-call / post-call.&nbsp;
            <strong>Capacity</strong> = Available × 2 (each MO covers an AM <em>and</em> a PM session).&nbsp;
            <strong>Balance</strong> = Capacity − Duty Slots; negative means sessions cannot be covered.
          </p>

          <div className="card" style={{ marginTop: 4 }}>
            <div className="table-wrap">
              <table className="resources-table">
                <thead>
                  <tr>
                    {/* Day identity */}
                    <th>Date</th>
                    <th>Day</th>
                    {/* Demand side */}
                    <th style={{ borderLeft: "2px solid var(--border)" }} title="OT rooms running that day">OT Rooms</th>
                    <th title="Session slots needed to staff OT rooms">OT Slots</th>
                    <th title="Session slots needed to staff clinics">Clinic Slots</th>
                    <th
                      style={{ fontWeight: 700, background: "var(--bg)" }}
                      title="Total session slots needed (OT + Clinic)"
                    >
                      Duty Slots
                    </th>
                    {/* Supply side */}
                    <th style={{ borderLeft: "2px solid var(--border)" }}>Total MOs</th>
                    <th title="MOs absent on leave">On Leave</th>
                    <th title="MOs assigned to overnight call">On Call</th>
                    <th title="MOs resting after overnight call">Post-Call</th>
                    <th style={{ fontWeight: 700, background: "var(--bg)" }} title="MO bodies free for duty">Available</th>
                    <th title="Available MOs × 2 (AM + PM sessions each)">Capacity (slots)</th>
                    {/* Balance */}
                    <th style={{ borderLeft: "2px solid var(--border)" }} title="Capacity minus Duty Slots">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => {
                    const isOff = d.is_weekend || d.is_ph;
                    const bal = d.balance_slots;
                    const balClass = isOff ? "" : bal == null ? "" : bal < 0 ? "deficit" : bal <= 2 ? "tight" : "surplus";

                    return (
                      <tr
                        key={d.date}
                        className={`${d.is_weekend ? "weekend" : ""} ${d.is_ph ? "ph" : ""}`}
                      >
                        <td>{d.date.slice(5)}</td>
                        <td>{d.day_name}{d.is_ph ? " (PH)" : ""}</td>

                        {/* Demand */}
                        <td style={{ borderLeft: "2px solid var(--border)" }}>{d.ot_rooms || "-"}</td>
                        <td>{d.ot_assistants_needed || "-"}</td>
                        <td>{d.clinic_slots || "-"}</td>
                        <td style={{ fontWeight: 600, background: "var(--bg)" }}>
                          {isOff ? "-" : d.duty_slots || "-"}
                        </td>

                        {/* Supply */}
                        <td style={{ borderLeft: "2px solid var(--border)" }}>{d.total_mos}</td>
                        <td className={d.on_leave > 0 ? "leave-cell" : ""}>{d.on_leave || "-"}</td>
                        <td>{d.on_call || "-"}</td>
                        <td>{d.post_call || "-"}</td>
                        <td style={{ fontWeight: 600, background: "var(--bg)" }}>{d.available}</td>
                        <td>{isOff ? "-" : d.capacity_slots}</td>

                        {/* Balance */}
                        <td
                          style={{ borderLeft: "2px solid var(--border)", fontWeight: 700 }}
                          className={balClass}
                        >
                          {isOff || bal == null ? "-" : bal > 0 ? `+${bal}` : bal}
                        </td>
                      </tr>
                    );
                  })}
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
  const shortDays  = weekdays.filter((d) => (d.balance_slots ?? 0) < 0);
  const tightDays  = weekdays.filter((d) => (d.balance_slots ?? 0) >= 0 && (d.balance_slots ?? 0) <= 2);
  const totalOTRooms = weekdays.reduce((s, d) => s + d.ot_rooms, 0);
  const avgAvailable = weekdays.length > 0
    ? (weekdays.reduce((s, d) => s + d.available, 0) / weekdays.length).toFixed(1)
    : "0";
  const totalShortfall = shortDays.reduce((s, d) => s + Math.abs(d.balance_slots ?? 0), 0);

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
        <div className="summary-label">Tight Days (≤2 slots)</div>
      </div>
      {totalShortfall > 0 && (
        <div className="summary-card summary-danger">
          <div className="summary-value">{totalShortfall}</div>
          <div className="summary-label">Total Slot Shortfall</div>
        </div>
      )}
    </div>
  );
}
