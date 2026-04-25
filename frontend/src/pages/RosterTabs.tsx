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

export default function RosterTabs() {
  return (
    <div>
      <div style={{
        display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 14,
      }}>
        <NavLink end to="/roster" style={({ isActive }) => ({ ...tabStyle, ...(isActive ? activeTabStyle : {}) })}>Call Roster</NavLink>
        <NavLink to="/roster/duty" style={({ isActive }) => ({ ...tabStyle, ...(isActive ? activeTabStyle : {}) })}>Duty Roster</NavLink>
        <NavLink to="/roster/fairness" style={({ isActive }) => ({ ...tabStyle, ...(isActive ? activeTabStyle : {}) })}>Fairness</NavLink>
      </div>
      <Outlet />
    </div>
  );
}
