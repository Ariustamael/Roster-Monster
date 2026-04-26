import { useState, useEffect, useMemo } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import type { RosterResponse } from "../types";

type SortDir = "asc" | "desc";
type CallSortKey = "name" | "total_24h" | "total_all" | "weekend_ph" | "difficulty_points";

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
  { label, k, sort }: { label: string; k: T; sort: ReturnType<typeof useSort<T>> }
) {
  const active = sort.key === k;
  const arrow = !active ? "⇅" : sort.dir === "asc" ? "↑" : "↓";
  return (
    <th onClick={() => sort.toggle(k)} style={{ cursor: "pointer", userSelect: "none" }} title={`Sort by ${label}`}>
      {label} <span style={{ opacity: active ? 1 : 0.4, fontSize: 10 }}>{arrow}</span>
    </th>
  );
}

export default function CallDistributionView() {
  const { active } = useConfig();
  const [data, setData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const sort = useSort<CallSortKey>("name");
  const configId = active?.id ?? 0;

  useEffect(() => {
    if (!configId) return;
    setData(null);
    setLoading(true);
    api.generateCallRoster(configId)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [configId]);

  if (!active) return <p style={{ color: "var(--text-muted)" }}>Select a month in the sidebar.</p>;

  const fairness = data?.fairness ?? null;
  const callColumns = data?.call_type_columns ?? [];

  const sortedRows = useMemo(() => {
    if (!fairness) return [];
    const rows = Object.entries(fairness).filter(([, s]) => (s as any).total_all > 0);
    const filtered = filter.trim()
      ? rows.filter(([name]) => name.toLowerCase().includes(filter.toLowerCase()))
      : rows;
    filtered.sort(([an, a], [bn, b]) => {
      const k = sort.key;
      const av = k === "name" ? an : (a as any)[k] ?? 0;
      const bv = k === "name" ? bn : (b as any)[k] ?? 0;
      let cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return filtered;
  }, [fairness, sort.key, sort.dir, filter]);

  const monthLabel = new Date(active.year, active.month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <>
      <div className="page-header" style={{ marginBottom: 14 }}>
        <h2>Call Distribution - {monthLabel}</h2>
        {loading && <span style={{ fontSize: 13, color: "var(--text-muted)" }}><span className="spinner" /> Loading...</span>}
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

      {fairness && (
        <div className="card">
          <div className="table-wrap">
            <table className="fairness-table">
              <thead>
                <tr>
                  <SortHeader label="Name" k="name" sort={sort} />
                  <SortHeader label="24h Calls" k="total_24h" sort={sort} />
                  <SortHeader label="All Calls" k="total_all" sort={sort} />
                  {callColumns.map((col) => <th key={col}>{col}</th>)}
                  <SortHeader label="Weekend/PH" k="weekend_ph" sort={sort} />
                  <SortHeader label="Difficulty" k="difficulty_points" sort={sort} />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const peers = Object.values(fairness).filter(
                    (v: any) => v.total_all > 0 && v.total_24h / v.total_all >= 0.3,
                  ) as any[];
                  const peerTotals = peers.map((v) => v.total_24h).filter((v) => v > 0);
                  const avg = peerTotals.length > 0
                    ? peerTotals.reduce((a, b) => a + b, 0) / peerTotals.length
                    : 0;
                  return sortedRows.map(([name, s]: [string, any]) => {
                    const inCohort = s.total_all > 0 && s.total_24h / s.total_all >= 0.3;
                    const hiLo = !inCohort ? "" : s.total_24h > avg + 1 ? "high" : s.total_24h < avg - 1 ? "low" : "";
                    return (
                      <tr key={name}>
                        <td>{name}</td>
                        <td className={hiLo}>{s.total_24h}</td>
                        <td>{s.total_all}</td>
                        {callColumns.map((col) => <td key={col}>{s.per_type[col] ?? 0}</td>)}
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
    </>
  );
}
