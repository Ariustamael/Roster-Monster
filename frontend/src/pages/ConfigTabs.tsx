import { NavLink, Outlet } from "react-router-dom";

export default function ConfigTabs() {
  return (
    <div>
      <div className="roster-tab-bar">
        <NavLink end to="/config" className={({ isActive }) => "roster-tab" + (isActive ? " roster-tab--active" : "")}>Ranks</NavLink>
        <NavLink to="/config/call-types" className={({ isActive }) => "roster-tab" + (isActive ? " roster-tab--active" : "")}>Call Types</NavLink>
        <NavLink to="/config/rules" className={({ isActive }) => "roster-tab" + (isActive ? " roster-tab--active" : "")}>Rules</NavLink>
      </div>
      <Outlet />
    </div>
  );
}
