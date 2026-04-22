import { useState, useEffect } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import type { FairnessStats, DutyStats } from "../types";

export default function FairnessView() {
  const { active } = useConfig();
  const [callFairness, setCallFairness] = useState<Record<string, FairnessStats> | null>(null);
  const [dutyStats, setDutyStats] = useState<Record<string, DutyStats> | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"calls" | "duties">("calls");

  const configId = active?.id ?? 0;

  useEffect(() => {
    setCallFairness(null);
    setDutyStats(null);
  }, [active?.id]);

  async function loadAll() {
    if (!configId) return;
    setLoading(true);
    try {
      const [callData, dutyData] = await Promise.all([
        api.generateCallRoster(configId),
        api.generateDutyRoster(configId),
      ]);
      setCallFairness(callData.fairness);
      setDutyStats(dutyData.duty_stats);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  if (!active) return <p style={{ color: "var(--text-muted)" }}>Select a month in the sidebar.</p>;

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
                  <th>Total</th>
                  <th>MO1</th>
                  <th>MO2</th>
                  <th>MO3</th>
                  <th>MO4</th>
                  <th>MO5</th>
                  <th>Weekend/PH</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(callFairness)
                  .filter(([, s]) => s.total > 0)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([name, s]) => {
                    const totals = Object.values(callFairness).map((v) => v.total).filter((v) => v > 0);
                    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
                    return (
                      <tr key={name}>
                        <td>{name}</td>
                        <td className={s.total > avg + 1 ? "high" : s.total < avg - 1 ? "low" : ""}>
                          {s.total}
                        </td>
                        <td>{s.MO1}</td>
                        <td>{s.MO2}</td>
                        <td>{s.MO3}</td>
                        <td>{s.MO4}</td>
                        <td>{s.MO5}</td>
                        <td>{s.weekend_ph}</td>
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
