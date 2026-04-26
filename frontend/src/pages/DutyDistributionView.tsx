import { useState, useEffect, useMemo } from "react";
import { api } from "../api";
import { useConfig } from "../context/ConfigContext";
import type { DutyRosterResponse } from "../types";

type SortDir = "asc" | "desc";
type DutySortKey = "name" | "ward_mo" | "ot" | "clinic" | "admin";

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

export default function DutyDistributionView() {
  const { active } = useConfig();
  const [data, setData] = useState<DutyRosterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const sort = useSort<DutySortKey>("name");
  const configId = active?.id ?? 0;

  useEffect(() => {
    if (!configId) return;
    setData(null);
    setLoading(true);
    api.generateDutyRoster(configId)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [configId]);

  if (!active) return <p style={{ color: "var(--text-muted)" }}>Select a month in the sidebar.</p>;

  const dutyStats = data?.duty_stats ?? null;

  const sortedRows = useMemo(() => {
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
      const k = sort.key;
      const av = (a as any)[k];
      const bv = (b as any)[k];
      let cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return filtered;
  }, [dutyStats, sort.key, sort.dir, filter]);

  const monthLabel = new Date(active.year, active.month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <>
      <div className="page-header" style={{ marginBottom: 14 }}>
        <h2>Duty Distribution - {monthLabel}</h2>
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

      {dutyStats && (
        <div className="card">
          <div className="table-wrap">
            <table className="fairness-table">
              <thead>
                <tr>
                  <SortHeader label="Name" k="name" sort={sort} />
                  <SortHeader label="Ward MO" k="ward_mo" sort={sort} />
                  <SortHeader label="OT" k="ot" sort={sort} />
                  <SortHeader label="Clinic" k="clinic" sort={sort} />
                  <SortHeader label="Admin" k="admin" sort={sort} />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
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
