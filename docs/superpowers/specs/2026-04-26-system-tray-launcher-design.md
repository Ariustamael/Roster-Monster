# System Tray Launcher — Design Spec

**Date:** 2026-04-26
**Status:** Approved

## Goal

Replace the three visible terminal windows produced by `start.bat` with a silent system tray application. The app starts both servers invisibly, puts an icon in the Windows system tray, and provides a minimal right-click menu. `start.bat` is preserved as a terminal fallback and is not modified.

---

## Files

| File | Change |
|------|--------|
| `Launcher.vbs` | New — entry point the user double-clicks |
| `Launcher.pyw` | New — system tray app logic (runs via pythonw, no console) |
| `tray-icon.png` | New — 64×64 PNG icon for the tray |
| `backend/requirements.txt` | Add `pystray==0.19.5` and `Pillow==10.4.0` |

`start.bat` is untouched.

---

## Entry Point

The user double-clicks **`Launcher.vbs`** in the project root. It first checks that Python is available by running `py --version` silently. If Python is not found, it shows a message box:

> "Python 3 is required to run Roster Monster. Download it from https://python.org"

If Python is present, it uses `WScript.Shell.Run` with window style `0` (hidden) to call `pythonw Launcher.pyw`, ensuring no console appears regardless of Python file associations on the machine.

---

## Launcher.pyw — Startup Sequence

1. **Venv check** — if `backend/venv/Scripts/python.exe` is missing or unresponsive, delete the stale venv and recreate it with `py -3.13 -m venv`.
2. **pip install** — run `pip install -r backend/requirements.txt -q` to ensure all packages (including `pystray`, `Pillow`, `greenlet`) are present.
3. **npm install** — if `frontend/node_modules` is absent, run `npm install -q` in `frontend/`.
4. **Start backend** — `subprocess.Popen` uvicorn with `creationflags=CREATE_NO_WINDOW`. Capture the process handle.
5. **Start frontend** — `subprocess.Popen` vite with `creationflags=CREATE_NO_WINDOW`. Capture the process handle.
6. **Wait and open browser** — sleep 4 seconds, then `webbrowser.open("http://127.0.0.1:5173")`.
7. **Hand off to pystray** — call `icon.run()`, which blocks until Quit is selected.

---

## Tray Icon

A pre-rasterised `tray-icon.png` (64×64) committed to the repo. Loaded at startup with `PIL.Image.open`. No runtime SVG conversion needed — keeps dependencies minimal.

---

## Menu Structure

```
Left-click              → webbrowser.open("http://127.0.0.1:5173")

Right-click:
  Open Roster Monster
  ────────────────────
  Status ▶
    Backend:  ✓ Running   (or ✗ Stopped)
    Frontend: ✓ Running   (or ✗ Stopped)
    ────────────────────
    Quit
```

Status items are computed dynamically each time the submenu is opened by calling `process.poll()` on both subprocess handles (`None` = still running).

---

## Quit Behaviour

1. Call `process.terminate()` on both subprocess handles.
2. Wait up to 3 seconds for each to exit (`process.wait(timeout=3)`).
3. If either is still alive, call `process.kill()`.
4. Call `icon.stop()` to exit pystray and end the Python process.

---

## Dependencies Added

- `pystray==0.19.5` — system tray icon and menu
- `Pillow==10.4.0` — image loading for the tray icon

Both added to `backend/requirements.txt` so the venv startup check installs them automatically.

---

## What Is Not Changed

- `start.bat` — untouched, still works as the terminal-based launcher
- All backend and frontend source code
- Database, config, and roster files
