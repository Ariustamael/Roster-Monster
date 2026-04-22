import { NavLink, Outlet } from "react-router-dom";
import { useConfig } from "../context/ConfigContext";
import { api } from "../api";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function Layout() {
  const { configs, active, setActiveId, reload } = useConfig();

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
        </div>

        <nav>
          <NavLink to="/" end>Call Roster</NavLink>
          <NavLink to="/duties">Duty Roster</NavLink>
          <NavLink to="/fairness">Fairness</NavLink>
          <NavLink to="/staff">Staff</NavLink>
          <NavLink to="/teams">Teams</NavLink>
        </nav>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
