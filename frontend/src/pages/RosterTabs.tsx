import { NavLink, Outlet } from "react-router-dom";

export default function RosterTabs() {
  return (
    <div>
      <div className="roster-tab-bar">
        <NavLink end to="/roster" className={({ isActive }) => "roster-tab" + (isActive ? " roster-tab--active" : "")}>Call Roster</NavLink>
        <NavLink to="/roster/duty" className={({ isActive }) => "roster-tab" + (isActive ? " roster-tab--active" : "")}>Duty Roster</NavLink>
        <NavLink to="/roster/conreg" className={({ isActive }) => "roster-tab" + (isActive ? " roster-tab--active" : "")}>Con/Reg Roster</NavLink>
        <NavLink to="/roster/supply" className={({ isActive }) => "roster-tab" + (isActive ? " roster-tab--active" : "")}>Supply / Demand</NavLink>
        <NavLink to="/roster/call-distribution" className={({ isActive }) => "roster-tab" + (isActive ? " roster-tab--active" : "")}>Call Distribution</NavLink>
        <NavLink to="/roster/duty-distribution" className={({ isActive }) => "roster-tab" + (isActive ? " roster-tab--active" : "")}>Duty Distribution</NavLink>
      </div>
      <Outlet />
    </div>
  );
}
