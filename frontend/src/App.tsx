import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ConfigProvider } from "./context/ConfigContext";
import Layout from "./components/Layout";
import CallRosterView from "./pages/CallRosterView";
import DutyRosterView from "./pages/DutyRosterView";
import FairnessView from "./pages/FairnessView";
import StaffView from "./pages/StaffView";
import TeamsView from "./pages/TeamsView";
import ResourcesView from "./pages/ResourcesView";
import RulesView from "./pages/RulesView";
import "./styles/app.css";

export default function App() {
  return (
    <ConfigProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<CallRosterView />} />
            <Route path="/duties" element={<DutyRosterView />} />
            <Route path="/fairness" element={<FairnessView />} />
            <Route path="/staff" element={<StaffView />} />
            <Route path="/teams" element={<TeamsView />} />
            <Route path="/resources" element={<ResourcesView />} />
            <Route path="/rules" element={<RulesView />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}
