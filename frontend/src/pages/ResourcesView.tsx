import { useState } from "react";
import { useConfig } from "../context/ConfigContext";
import SupplyDemandTab from "./resources/SupplyDemandTab";
import OTTemplatesTab from "./resources/OTTemplatesTab";
import ClinicTemplatesTab from "./resources/ClinicTemplatesTab";
import ConsultantRosterTab from "./resources/ConsultantRosterTab";
import RegistrarRosterTab from "./resources/RegistrarRosterTab";

const TABS = [
  { key: "supply", label: "Supply / Demand", needsConfig: true },
  { key: "ot", label: "OT Templates", needsConfig: false },
  { key: "clinics", label: "Clinic Templates", needsConfig: false },
  { key: "consultant", label: "Consultant Roster", needsConfig: true },
  { key: "registrar", label: "Registrar Roster", needsConfig: true },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default function ResourcesView() {
  const { active } = useConfig();
  const [tab, setTab] = useState<TabKey>("supply");

  const currentTab = TABS.find((t) => t.key === tab)!;
  const needsConfig = currentTab.needsConfig && !active;

  return (
    <>
      <div className="page-header">
        <h2>Resources {active ? `- ${MONTH_NAMES[active.month]} ${active.year}` : ""}</h2>
      </div>

      <div className="tabs" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? "active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {needsConfig ? (
        <p style={{ color: "var(--text-muted)" }}>Select a month in the sidebar to configure this tab.</p>
      ) : (
        <>
          {tab === "supply" && active && <SupplyDemandTab configId={active.id} />}
          {tab === "ot" && <OTTemplatesTab />}
          {tab === "clinics" && <ClinicTemplatesTab />}
          {tab === "consultant" && active && (
            <ConsultantRosterTab configId={active.id} year={active.year} month={active.month} />
          )}
          {tab === "registrar" && active && (
            <RegistrarRosterTab configId={active.id} year={active.year} month={active.month} />
          )}
        </>
      )}
    </>
  );
}
