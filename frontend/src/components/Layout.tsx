import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useConfig } from "../context/ConfigContext";
import { api } from "../api";
import LegendModal from "./LegendModal";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function Layout() {
  const { configs, active, setActiveId, reload } = useConfig();
  const [legendOpen, setLegendOpen] = useState(false);

  async function addMonth() {
    const input = prompt("Enter year and month (e.g. 2026-05):");
    if (!input) return;
    const [y, m] = input.split("-").map(Number);
    if (!y || !m || m < 1 || m > 12) {
      alert("Invalid format. Use YYYY-MM");
      return;
    }
    try {
      const cfg = await api.createConfig(y, m);
      await reload();
      setActiveId(cfg.id);
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function deleteMonth() {
    if (!active) return;
    if (!confirm(`Delete ${MONTH_NAMES[active.month]} ${active.year} and all its data?`)) return;
    try {
      await api.deleteConfig(active.id);
      await reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Roster Monster</h1>

        <div className="config-picker">
          <select
            value={active?.id ?? ""}
            onChange={(e) => setActiveId(Number(e.target.value))}
          >
            {configs.map((c) => (
              <option key={c.id} value={c.id}>
                {MONTH_NAMES[c.month]} {c.year}
              </option>
            ))}
          </select>
          <button className="btn-add-month" onClick={addMonth} title="Add month">+</button>
          {active && configs.length > 1 && (
            <button className="btn-add-month" onClick={deleteMonth} title="Delete month"
              style={{ background: "rgba(220,38,38,0.3)" }}>-</button>
          )}
        </div>

        <nav>
          <NavLink to="/roster">Roster</NavLink>
          <NavLink to="/staff">Staff</NavLink>
          <NavLink to="/resources">Resources</NavLink>
          <NavLink to="/config">Config</NavLink>
        </nav>
      </aside>
      <main className="main" style={{ position: "relative" }}>
        <button
          onClick={() => setLegendOpen(true)}
          title="Legend / help"
          style={{
            position: "absolute", top: 12, right: 16, zIndex: 50,
            width: 28, height: 28, borderRadius: "50%",
            border: "1px solid #e1e4e8", background: "white",
            color: "#1a1a2e", fontSize: 14, fontWeight: 700,
            cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >?</button>
        <Outlet />
        {legendOpen && <LegendModal onClose={() => setLegendOpen(false)} />}
      </main>
    </div>
  );
}
