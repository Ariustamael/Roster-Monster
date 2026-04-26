import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider, useConfig } from "./context/ConfigContext";
import { RosterSyncProvider } from "./context/RosterSyncContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Layout from "./components/Layout";
import { api } from "./api";
import CallRosterView from "./pages/CallRosterView";
import DutyRosterView from "./pages/DutyRosterView";
import CallDistributionView from "./pages/CallDistributionView";
import DutyDistributionView from "./pages/DutyDistributionView";
import StaffView from "./pages/StaffView";
import TeamsView from "./pages/TeamsView";
import RulesView from "./pages/RulesView";
import RosterTabs from "./pages/RosterTabs";
import StaffTabs from "./pages/StaffTabs";
import ConfigTabs from "./pages/ConfigTabs";
import RankConfigTab from "./pages/config/RankConfigTab";
import CallTypeConfigTab from "./pages/config/CallTypeConfigTab";
import ResourceTemplatesTab from "./pages/resources/ResourceTemplatesTab";
import ConsultantRosterTab from "./pages/resources/ConsultantRosterTab";
import SupplyDemandTab from "./pages/resources/SupplyDemandTab";
import "./styles/app.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

function ConRegRoute() {
  const { active } = useConfig();
  if (!active) return <p style={{ color: "var(--text-muted)" }}>Select a month in the sidebar.</p>;
  return <ConsultantRosterTab configId={active.id} year={active.year} month={active.month} />;
}

function SupplyDemandRoute() {
  const { active } = useConfig();
  if (!active) return <p style={{ color: "var(--text-muted)" }}>Select a month in the sidebar.</p>;
  return <SupplyDemandTab configId={active.id} />;
}

function Heartbeat() {
  useEffect(() => {
    // Ping the backend every 5 s so it knows the tab is still open.
    // If pings stop for 30 s the backend watchdog writes a quit sentinel
    // and the Launcher shuts everything down — i.e. closing the tab quits
    // the whole application.
    api.heartbeat();
    const id = setInterval(() => api.heartbeat(), 5_000);
    return () => clearInterval(id);
  }, []);
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <RosterSyncProvider>
          <BrowserRouter>
            <Heartbeat />
            <ErrorBoundary>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/" element={<RosterTabs />}>
                    <Route index element={<CallRosterView />} />
                    <Route path="duty" element={<DutyRosterView />} />
                    <Route path="conreg" element={<ConRegRoute />} />
                    <Route path="supply" element={<SupplyDemandRoute />} />
                    <Route path="call-distribution" element={<CallDistributionView />} />
                    <Route path="duty-distribution" element={<DutyDistributionView />} />
                  </Route>
                  <Route path="/roster" element={<RosterTabs />}>
                    <Route index element={<CallRosterView />} />
                    <Route path="duty" element={<DutyRosterView />} />
                    <Route path="conreg" element={<ConRegRoute />} />
                    <Route path="supply" element={<SupplyDemandRoute />} />
                    <Route path="call-distribution" element={<CallDistributionView />} />
                    <Route path="duty-distribution" element={<DutyDistributionView />} />
                  </Route>
                  <Route path="/resources" element={<StaffTabs />}>
                    <Route index element={<TeamsView />} />
                    <Route path="staff" element={<StaffView />} />
                    <Route path="clinics" element={<ResourceTemplatesTab />} />
                  </Route>
                  <Route path="/config" element={<ConfigTabs />}>
                    <Route index element={<RankConfigTab />} />
                    <Route path="call-types" element={<CallTypeConfigTab />} />
                    <Route path="rules" element={<RulesView />} />
                  </Route>
                </Route>
              </Routes>
            </ErrorBoundary>
          </BrowserRouter>
        </RosterSyncProvider>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
