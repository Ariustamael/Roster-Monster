import { NavLink, Outlet } from "react-router-dom";

export default function Layout() {
  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Roster Monster</h1>
        <nav>
          <NavLink to="/" end>Call Roster</NavLink>
          <NavLink to="/duties">Duty Roster</NavLink>
          <NavLink to="/fairness">Fairness</NavLink>
          <NavLink to="/staff">Staff</NavLink>
        </nav>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
