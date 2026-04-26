import { NavLink, Outlet } from "react-router-dom";

export default function ResourcesTabs() {
  return (
    <div>
      <div className="roster-tab-bar">
        <NavLink end to="/resources" className={({ isActive }) => "roster-tab" + (isActive ? " roster-tab--active" : "")}>Teams</NavLink>
        <NavLink to="/resources/staff" className={({ isActive }) => "roster-tab" + (isActive ? " roster-tab--active" : "")}>Staff</NavLink>
        <NavLink to="/resources/clinics" className={({ isActive }) => "roster-tab" + (isActive ? " roster-tab--active" : "")}>Clinic/OT Resources</NavLink>
      </div>
      <Outlet />
    </div>
  );
}
