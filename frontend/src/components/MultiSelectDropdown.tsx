import { useState, useRef, useEffect } from "react";

interface Option {
  id: number;
  label: string;
}

export default function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder = "Select...",
}: {
  options: Option[];
  selected: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedLabels = options
    .filter((o) => selected.includes(o.id))
    .map((o) => o.label)
    .join(", ");

  function toggle(id: number) {
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id]
    );
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "5px 8px",
          fontSize: 12,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 30,
          background: "var(--surface, #fff)",
        }}
      >
        <span style={{ color: selectedLabels ? "var(--text)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selectedLabels || placeholder}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 8, flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 100,
            background: "var(--surface, #fff)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            maxHeight: 180,
            overflowY: "auto",
            marginTop: 2,
          }}
        >
          {options.map((o) => (
            <label
              key={o.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 10px",
                cursor: "pointer",
                fontSize: 12,
                borderBottom: "1px solid var(--border)",
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggle(o.id)}
            >
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={() => {}}
                style={{ margin: 0 }}
              />
              {o.label}
            </label>
          ))}
          {options.length === 0 && (
            <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-muted)" }}>No options</div>
          )}
        </div>
      )}
    </div>
  );
}
