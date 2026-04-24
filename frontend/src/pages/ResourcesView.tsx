import { useState } from "react";
import { useConfig } from "../context/ConfigContext";
import SupplyDemandTab from "./resources/SupplyDemandTab";
import ResourceTemplatesTab from "./resources/ResourceTemplatesTab";
import ConsultantRosterTab from "./resources/ConsultantRosterTab";

const TABS = [
  { key: "supply", label: "Supply / Demand", needsConfig: true },
  { key: "resources", label: "Resources", needsConfig: false },
  { key: "oncall", label: "Con/Reg Roster", needsConfig: true },
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
          {tab === "resources" && <ResourceTemplatesTab />}
          {tab === "oncall" && active && (
            <ConsultantRosterTab configId={active.id} year={active.year} month={active.month} />
          )}
        </>
      )}
    </>
  );
}
