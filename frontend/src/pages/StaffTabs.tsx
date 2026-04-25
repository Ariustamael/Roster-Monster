import { NavLink, Outlet } from "react-router-dom";

const tabStyle: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-muted)",
  textDecoration: "none",
  borderBottom: "2px solid transparent",
};
const activeTabStyle: React.CSSProperties = {
  color: "var(--primary)",
  borderBottomColor: "var(--primary)",
};

export default function StaffTabs() {
  return (
    <div>
      <div style={{
        display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 14,
      }}>
        <NavLink end to="/staff" style={({ isActive }) => ({ ...tabStyle, ...(isActive ? activeTabStyle : {}) })}>Staff</NavLink>
        <NavLink to="/staff/teams" style={({ isActive }) => ({ ...tabStyle, ...(isActive ? activeTabStyle : {}) })}>Teams</NavLink>
      </div>
      <Outlet />
    </div>
  );
}
