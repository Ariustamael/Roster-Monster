import { useState } from "react";
import RankConfigTab from "./config/RankConfigTab";
import CallTypeConfigTab from "./config/CallTypeConfigTab";

export default function ConfigView() {
  const [tab, setTab] = useState<"ranks" | "call-types">("ranks");

  return (
    <>
      <div className="page-header">
        <h2>Configuration</h2>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === "ranks" ? "active" : ""}`} onClick={() => setTab("ranks")}>
          Ranks
        </button>
        <button className={`tab ${tab === "call-types" ? "active" : ""}`} onClick={() => setTab("call-types")}>
          Call Types
        </button>
      </div>

      {tab === "ranks" && <RankConfigTab />}
      {tab === "call-types" && <CallTypeConfigTab />}
    </>
  );
}
