import { useEscClose } from "../hooks/useEscClose";

interface Props {
  onClose: () => void;
}

const pillBase: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 6px",
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  color: "white",
  minWidth: 18,
  textAlign: "center",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  margin: "14px 0 6px",
  color: "#1a1a2e",
  borderBottom: "1px solid #e1e4e8",
  paddingBottom: 3,
};

const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "90px 1fr",
  gap: 10,
  alignItems: "center",
  padding: "4px 0",
  fontSize: 13,
};

const sampleBox: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 22,
};

export default function LegendModal({ onClose }: Props) {
  useEscClose(onClose);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white", borderRadius: 8, padding: "20px 24px",
          maxWidth: 520, width: "90%", maxHeight: "85vh", overflowY: "auto",
          boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Legend</h2>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", fontSize: 22, cursor: "pointer",
            color: "#6b7280", lineHeight: 1,
          }}>×</button>
        </div>

        <div style={sectionTitle}>Status pills</div>
        <div style={row}>
          <div style={sampleBox}><span style={{ ...pillBase, background: "#94a3b8" }}>PC</span></div>
          <div>Post-call — staff just came off an overnight call and is unavailable.</div>
        </div>
        <div style={row}>
          <div style={sampleBox}><span style={{ ...pillBase, background: "#ef4444" }}>L</span></div>
          <div>Leave — staff is on annual / sick / other leave that day.</div>
        </div>
        <div style={row}>
          <div style={sampleBox}><span style={{ ...pillBase, background: "#d1fae5", color: "#065f46" }}>R</span></div>
          <div>Request — staff requested this date for call.</div>
        </div>
        <div style={row}>
          <div style={sampleBox}><span style={{ ...pillBase, background: "#fee2e2", color: "#991b1b" }}>B</span></div>
          <div>Block — staff requested NOT to be on call this date.</div>
        </div>

        <div style={sectionTitle}>Day card header</div>
        <div style={row}>
          <div style={sampleBox}>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 3,
              background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d",
            }}>✎ edited</span>
          </div>
          <div>This day's resources have been customised from the weekly default — per-day overrides are active. Use <em>Edit Resources</em> on the day card to view or revert them.</div>
        </div>

        <div style={sectionTitle}>Action icons</div>
        <div style={row}>
          <div style={sampleBox}><span style={{ fontSize: 16 }}>⧉</span></div>
          <div>Drag this handle to duplicate a name into another slot (multi-roster).</div>
        </div>
        <div style={row}>
          <div style={sampleBox}><span style={{ fontSize: 16 }}>×</span></div>
          <div>Clear this assignment. On the duty roster, free duty-eligible MOs auto-appear in the Admin column.</div>
        </div>
        <div style={row}>
          <div style={sampleBox}><span style={{ fontSize: 14 }}>✎</span></div>
          <div>Manual override marker — this individual assignment was set by hand, not produced by the solver.</div>
        </div>

        <div style={sectionTitle}>Call roster actions</div>
        <div style={row}>
          <div style={sampleBox}>
            <span style={{
              padding: "2px 8px", background: "#dc2626", color: "white",
              borderRadius: 4, fontSize: 11, fontWeight: 600,
            }}>Clear Slot</span>
          </div>
          <div>In the Call Roster click-to-edit modal — empties the selected call slot for that day.</div>
        </div>

        <div style={sectionTitle}>Outlines & highlights</div>
        <div style={row}>
          <div style={sampleBox}>
            <span style={{ padding: "2px 8px", border: "2px solid var(--sem-multi)", borderRadius: 4, fontSize: 12 }}>Name</span>
          </div>
          <div><strong style={{ color: "var(--sem-multi)" }}>Violet</strong> — legitimate multi-roster (same person assigned to more than one slot intentionally).</div>
        </div>
        <div style={row}>
          <div style={sampleBox}>
            <span style={{ padding: "2px 8px", border: "2px solid #f59e0b", borderRadius: 4, fontSize: 12 }}>Name</span>
          </div>
          <div><strong style={{ color: "#f59e0b" }}>Amber</strong> — constraint conflict (assigned while on leave or post-call).</div>
        </div>
        <div style={row}>
          <div style={sampleBox}>
            <span style={{ padding: "2px 8px", border: "2px dashed #6366f1", borderRadius: 4, fontSize: 12 }}>drop</span>
          </div>
          <div>Active drag-drop target.</div>
        </div>

        <div style={sectionTitle}>Day backgrounds</div>
        <div style={row}>
          <div style={sampleBox}>
            <span style={{ padding: "2px 10px", background: "#fef3c7", borderRadius: 3, fontSize: 12 }}>Sat</span>
          </div>
          <div>Weekend or public holiday — different background band on the date column.</div>
        </div>
        <div style={row}>
          <div style={sampleBox}>
            <span style={{
              padding: "2px 6px", background: "#fecaca", color: "#991b1b",
              border: "1px dashed #991b1b", borderRadius: 3, fontSize: 12,
              opacity: 0.55,
            }}>
              Name<span style={{
                fontSize: 9, fontWeight: 700, padding: "1px 4px", marginLeft: 4,
                borderRadius: 3, background: "#ef4444", color: "white",
              }}>L</span>
            </span>
          </div>
          <div>Unavailable column — staff on leave / post-call, draggable back into a slot if needed.</div>
        </div>
        <div style={row}>
          <div style={sampleBox}>
            <span style={{
              padding: "2px 6px", background: "transparent", color: "#991b1b",
              border: "1px dashed #991b1b", borderRadius: 3, fontSize: 12,
              opacity: 0.4,
            }}>
              Name<span style={{
                fontSize: 9, fontWeight: 700, padding: "1px 4px", marginLeft: 4,
                borderRadius: 3, background: "#94a3b8", color: "white",
              }}>PC</span>
            </span>
          </div>
          <div>Ghost chip in a session column — staff who'd normally be in this slot but is unavailable today.</div>
        </div>
      </div>
    </div>
  );
}
