import { useState, useEffect, useMemo } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import type { RosterResponse, DutyRosterResponse } from "../types";

type SortDir = "asc" | "desc";

function useSort<T extends string>(defaultKey: T, defaultDir: SortDir = "asc") {
  const [key, setKey] = useState<T>(defaultKey);
  const [dir, setDir] = useState<SortDir>(defaultDir);
  function toggle(k: T) {
    if (k === key) setDir(dir === "asc" ? "desc" : "asc");
    else { setKey(k); setDir("asc"); }
  }
  return { key, dir, toggle };
}

function SortHeader<T extends string>(
  { label, k, sort, align = "left" }:
  { label: string; k: T; sort: ReturnType<typeof useSort<T>>; align?: "left" | "right" | "center" }
) {
  const active = sort.key === k;
  const arrow = !active ? "⇅" : sort.dir === "asc" ? "↑" : "↓";
  return (
    <th
      onClick={() => sort.toggle(k)}
      style={{ cursor: "pointer", userSelect: "none", textAlign: align }}
      title={`Sort by ${label}`}
    >
      {label} <span style={{ opacity: active ? 1 : 0.4, fontSize: 10 }}>{arrow}</span>
    </th>
  );
}

type CallSortKey = "name" | "total_24h" | "total_all" | "weekend_ph" | "difficulty_points";
type DutySortKey = "name" | "ward_mo" | "ot" | "clinic" | "admin";

export default function FairnessView() {
  const { active } = useConfig();
  const [callData, setCallData] = useState<RosterResponse | null>(null);
  const [dutyData, setDutyData] = useState<DutyRosterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"calls" | "duties">("calls");
  const [filter, setFilter] = useState("");
  const callSort = useSort<CallSortKey>("name");
  const dutySort = useSort<DutySortKey>("name");

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

  const callFairness = callData?.fairness ?? null;
  const dutyStats = dutyData?.duty_stats ?? null;
  const callColumns = callData?.call_type_columns ?? [];

  const sortedCallRows = useMemo(() => {
    if (!callFairness) return [];
    const rows = Object.entries(callFairness).filter(([, s]) => (s as any).total_all > 0);
    const filtered = filter.trim()
      ? rows.filter(([name]) => name.toLowerCase().includes(filter.toLowerCase()))
      : rows;
    const getVal = (s: any, k: CallSortKey) => k === "name" ? "" : (s[k] ?? 0);
    filtered.sort(([an, a], [bn, b]) => {
      const k = callSort.key;
      const av = k === "name" ? an : getVal(a, k);
      const bv = k === "name" ? bn : getVal(b, k);
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return callSort.dir === "asc" ? cmp : -cmp;
    });
    return filtered;
  }, [callFairness, callSort.key, callSort.dir, filter]);

  const sortedDutyRows = useMemo(() => {
    if (!dutyStats) return [];
    const rows = Object.entries(dutyStats).map(([name, s]: [string, any]) => {
      const ward_mo = s.ward_mo_sessions ?? 0;
      const ot = (s.ot_days ?? 0) + (s.eot_days ?? 0);
      const clinic = (s.supervised_sessions ?? 0) + (s.mopd_sessions ?? 0);
      const admin = s.admin_sessions ?? 0;
      return { name, ward_mo, ot, clinic, admin, total: ward_mo + ot + clinic + admin };
    }).filter((r) => r.total > 0);
    const filtered = filter.trim()
      ? rows.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()))
      : rows;
    filtered.sort((a, b) => {
      const k = dutySort.key;
      const av = (a as any)[k];
      const bv = (b as any)[k];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return dutySort.dir === "asc" ? cmp : -cmp;
    });
    return filtered;
  }, [dutyStats, dutySort.key, dutySort.dir, filter]);

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

      <div style={{ margin: "8px 0" }}>
        <input
          type="text"
          placeholder="Filter by name..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ padding: "4px 8px", fontSize: 13, width: 220, border: "1px solid var(--border)", borderRadius: 4 }}
        />
      </div>

      {tab === "calls" && callFairness && (
        <div className="card">
          <h3>Call Assignments per MO</h3>
          <div className="table-wrap">
            <table className="fairness-table">
              <thead>
                <tr>
                  <SortHeader label="Name" k="name" sort={callSort} />
                  <SortHeader label="24h Calls" k="total_24h" sort={callSort} />
                  <SortHeader label="All Calls" k="total_all" sort={callSort} />
                  {callColumns.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                  <SortHeader label="Weekend/PH" k="weekend_ph" sort={callSort} />
                  <SortHeader label="Difficulty" k="difficulty_points" sort={callSort} />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Compute avg 24h only among people whose workload is
                  // primarily 24h-style (≥30% of their calls). This keeps
                  // night-float registrars (e.g. R2 holders with 0-1 real 24h
                  // calls) out of the comparison pool, so they don't get
                  // incorrectly flagged "low" against the MO cohort.
                  const peers = Object.values(callFairness).filter(
                    (v: any) => v.total_all > 0 && v.total_24h / v.total_all >= 0.3,
                  ) as any[];
                  const peerTotals = peers.map((v) => v.total_24h).filter((v) => v > 0);
                  const avg = peerTotals.length > 0
                    ? peerTotals.reduce((a, b) => a + b, 0) / peerTotals.length
                    : 0;
                  return sortedCallRows.map(([name, s]: [string, any]) => {
                    // Only apply hi/lo highlight if this person is in the 24h cohort
                    const inCohort = s.total_all > 0 && s.total_24h / s.total_all >= 0.3;
                    const hiLo = !inCohort
                      ? ""
                      : s.total_24h > avg + 1
                      ? "high"
                      : s.total_24h < avg - 1
                      ? "low"
                      : "";
                  return (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className={hiLo}>
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
                  });
                })()}
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
                  <SortHeader label="Name" k="name" sort={dutySort} />
                  <SortHeader label="Ward MO" k="ward_mo" sort={dutySort} />
                  <SortHeader label="OT" k="ot" sort={dutySort} />
                  <SortHeader label="Clinic" k="clinic" sort={dutySort} />
                  <SortHeader label="Admin" k="admin" sort={dutySort} />
                </tr>
              </thead>
              <tbody>
                {sortedDutyRows.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>{r.ward_mo}</td>
                    <td>{r.ot}</td>
                    <td>{r.clinic}</td>
                    <td>{r.admin}</td>
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
