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

export default function ConfigTabs() {
  return (
    <div>
      <div style={{
        display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 14,
      }}>
        <NavLink end to="/config" style={({ isActive }) => ({ ...tabStyle, ...(isActive ? activeTabStyle : {}) })}>Config</NavLink>
        <NavLink to="/config/rules" style={({ isActive }) => ({ ...tabStyle, ...(isActive ? activeTabStyle : {}) })}>Rules</NavLink>
      </div>
      <Outlet />
    </div>
  );
}
