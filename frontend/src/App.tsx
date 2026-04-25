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
import ConfigView from "./pages/ConfigView";
import RosterTabs from "./pages/RosterTabs";
import StaffTabs from "./pages/StaffTabs";
import ConfigTabs from "./pages/ConfigTabs";
import "./styles/app.css";

export default function App() {
  return (
    <ConfigProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<RosterTabs />}>
              <Route index element={<CallRosterView />} />
              <Route path="duty" element={<DutyRosterView />} />
              <Route path="fairness" element={<FairnessView />} />
            </Route>
            <Route path="/roster" element={<RosterTabs />}>
              <Route index element={<CallRosterView />} />
              <Route path="duty" element={<DutyRosterView />} />
              <Route path="fairness" element={<FairnessView />} />
            </Route>
            <Route path="/staff" element={<StaffTabs />}>
              <Route index element={<StaffView />} />
              <Route path="teams" element={<TeamsView />} />
            </Route>
            <Route path="/resources" element={<ResourcesView />} />
            <Route path="/config" element={<ConfigTabs />}>
              <Route index element={<ConfigView />} />
              <Route path="rules" element={<RulesView />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}
