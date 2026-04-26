import React, { useEffect, useRef, useState } from "react";

interface ExportButtonProps {
  onExport: (format: "full" | "clean") => void;
  disabled?: boolean;
}

export default function ExportButton({ onExport, disabled }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="export-btn-wrap" ref={ref}>
      <button
        className="btn btn-secondary export-btn-main"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="Export roster"
        aria-haspopup="true"
        aria-expanded={open}
      >
        Export&nbsp;
        <span className="export-chevron">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="export-dropdown" role="menu">
          <button
            role="menuitem"
            className="export-dropdown-item"
            onClick={() => { setOpen(false); onExport("full"); }}
          >
            <span className="export-icon">📋</span>
            <span>
              <strong>Full</strong>
              <span className="export-desc">All sheets — daily roster, clinic &amp; unavailability</span>
            </span>
          </button>
          <button
            role="menuitem"
            className="export-dropdown-item"
            onClick={() => { setOpen(false); onExport("clean"); }}
          >
            <span className="export-icon">✨</span>
            <span>
              <strong>Clean</strong>
              <span className="export-desc">Presentation-ready call &amp; clinic sheets</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
