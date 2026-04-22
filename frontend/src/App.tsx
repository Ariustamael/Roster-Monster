import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import CallRosterView from "./pages/CallRosterView";
import DutyRosterView from "./pages/DutyRosterView";
import FairnessView from "./pages/FairnessView";
import StaffView from "./pages/StaffView";
import "./styles/app.css";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<CallRosterView />} />
          <Route path="/duties" element={<DutyRosterView />} />
          <Route path="/fairness" element={<FairnessView />} />
          <Route path="/staff" element={<StaffView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
