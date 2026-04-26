import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useConfig } from "../context/ConfigContext";
import { api } from "../api";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function Layout() {
  const { configs, active, setActiveId, reload } = useConfig();
  const [quitting, setQuitting] = useState(false);

  async function handleQuit() {
    if (!confirm("Quit Roster Monster? This will stop the backend and frontend servers.")) return;
    setQuitting(true);
    try {
      await api.quit();
    } catch {
      // Server killed itself before responding — that's fine
    }
    // Page will go blank once Vite stops; window.close() works when opened by script
    window.close();
  }

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
          <NavLink to="/resources">Resources</NavLink>
          <NavLink to="/config">Configuration</NavLink>
        </nav>

        <button
          className="btn-quit"
          onClick={handleQuit}
          disabled={quitting}
          title="Stop all servers and quit Roster Monster"
        >
          {quitting ? "Shutting down…" : "⏻  Quit"}
        </button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
