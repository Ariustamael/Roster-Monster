import { useState, useEffect } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import type { FairnessStats, DutyStats, RosterResponse, DutyRosterResponse } from "../types";

export default function FairnessView() {
  const { active } = useConfig();
  const [callData, setCallData] = useState<RosterResponse | null>(null);
  const [dutyData, setDutyData] = useState<DutyRosterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"calls" | "duties">("calls");

  const configId = active?.id ?? 0;

  useEffect(() => {
    setCallData(null);
    setDutyData(null);
  }, [active?.id]);

  async function loadAll() {
    if (!configId) return;
    setLoading(true);
    try {
      const [cd, dd] = await Promise.all([
        api.generateCallRoster(configId),
        api.generateDutyRoster(configId),
      ]);
      setCallData(cd);
      setDutyData(dd);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  if (!active) return <p style={{ color: "var(--text-muted)" }}>Select a month in the sidebar.</p>;

  const callFairness = callData?.fairness ?? null;
  const dutyStats = dutyData?.duty_stats ?? null;
  const callColumns = callData?.call_type_columns ?? [];

  return (
    <>
      <div className="page-header">
        <h2>Fairness Dashboard</h2>
        <button className="btn btn-primary" onClick={loadAll} disabled={loading}>
          {loading ? <><span className="spinner" /> Loading...</> : "Generate & View Stats"}
        </button>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "calls" ? "active" : ""}`} onClick={() => setTab("calls")}>
          Call Distribution
        </button>
        <button className={`tab ${tab === "duties" ? "active" : ""}`} onClick={() => setTab("duties")}>
          Duty Distribution
        </button>
      </div>

      {tab === "calls" && callFairness && (
        <div className="card">
          <h3>Call Assignments per MO</h3>
          <div className="table-wrap">
            <table className="fairness-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>24h Calls</th>
                  <th>All Calls</th>
                  {callColumns.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                  <th>Weekend/PH</th>
                  <th>Difficulty</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(callFairness)
                  .filter(([, s]) => s.total_all > 0)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, s]) => {
                    const totals24h = Object.values(callFairness).map((v) => v.total_24h).filter((v) => v > 0);
                    const avg = totals24h.length > 0 ? totals24h.reduce((a, b) => a + b, 0) / totals24h.length : 0;
                    return (
                      <tr key={name}>
                        <td>{name}</td>
                        <td className={s.total_24h > avg + 1 ? "high" : s.total_24h < avg - 1 ? "low" : ""}>
                          {s.total_24h}
                        </td>
                        <td>{s.total_all}</td>
                        {callColumns.map((col) => (
                          <td key={col}>{s.per_type[col] ?? 0}</td>
                        ))}
                        <td>{s.weekend_ph}</td>
                        <td>{s.difficulty_points}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "duties" && dutyStats && (
        <div className="card">
          <h3>Duty Assignments per MO</h3>
          <div className="table-wrap">
            <table className="fairness-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>OT Days</th>
                  <th>Supervised</th>
                  <th>MOPD</th>
                  <th>Admin</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(dutyStats)
                  .filter(([, s]) => s.ot_days + s.supervised_sessions + s.mopd_sessions + s.admin_sessions > 0)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, s]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{s.ot_days}</td>
                      <td>{s.supervised_sessions}</td>
                      <td>{s.mopd_sessions}</td>
                      <td>{s.admin_sessions}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
