# System Tray Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three visible terminal windows with a silent Windows system tray app (`Launcher.vbs` + `Launcher.pyw`) that starts both servers invisibly, shows a tray icon, and lets the user open the app or quit via a right-click menu.

**Architecture:** `Launcher.vbs` is the user-facing entry point — it checks Python is installed, ensures `pystray` and `Pillow` are in the system Python, then silently launches `Launcher.pyw` via `pythonw`. `Launcher.pyw` (stdlib + pystray + Pillow) checks the venv, pip-installs backend deps, npm-installs frontend deps, starts both servers as hidden subprocesses, opens the browser, and hands off to pystray's blocking loop. `start.bat` is untouched.

**Tech Stack:** Python 3.13 (system), pystray 0.19.5, Pillow 10.4.0, VBScript (WScript.Shell), subprocess.Popen with CREATE_NO_WINDOW

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `Launcher.vbs` | Create | Entry point — Python check, dep install, hidden launch |
| `Launcher.pyw` | Create | Tray app — venv setup, server launch, pystray loop |
| `tray-icon.png` | Create | 64×64 brand-coloured PNG for the tray |
| `generate_icon.py` | Create (temp) | One-off script to produce tray-icon.png; delete after use |
| `backend/requirements.txt` | Modify | Add pystray and Pillow for venv completeness |

---

## Task 1: Generate tray-icon.png

**Files:**
- Create: `generate_icon.py` (root, temporary)
- Create: `tray-icon.png` (root, committed)

- [ ] **Step 1: Install Pillow in system Python**

```bash
py -m pip install pillow
```

Expected output: `Successfully installed Pillow-...` or `Requirement already satisfied`.

- [ ] **Step 2: Create generate_icon.py**

Create `generate_icon.py` in the project root:

```python
from PIL import Image, ImageDraw, ImageFont

SIZE = 64
BG = (18, 18, 30, 255)       # near-black navy
PURPLE = (134, 59, 255, 255)  # brand #863bff
WHITE = (255, 255, 255, 255)

img = Image.new("RGBA", (SIZE, SIZE), BG)
draw = ImageDraw.Draw(img)

draw.rounded_rectangle([2, 2, SIZE - 3, SIZE - 3], radius=12, fill=PURPLE)

try:
    font = ImageFont.truetype("arialbd.ttf", 24)
except OSError:
    try:
        font = ImageFont.truetype("arial.ttf", 24)
    except OSError:
        font = ImageFont.load_default()

text = "RM"
bbox = draw.textbbox((0, 0), text, font=font)
w = bbox[2] - bbox[0]
h = bbox[3] - bbox[1]
x = (SIZE - w) // 2 - bbox[0]
y = (SIZE - h) // 2 - bbox[1]
draw.text((x, y), text, fill=WHITE, font=font)

img.save("tray-icon.png")
print("Generated tray-icon.png")
```

- [ ] **Step 3: Run the generator**

```bash
py generate_icon.py
```

Expected: `Generated tray-icon.png` and a 64×64 file appears in the project root.

- [ ] **Step 4: Delete generate_icon.py**

```bash
del generate_icon.py
```

- [ ] **Step 5: Commit tray-icon.png**

```bash
git add tray-icon.png
git commit -m "feat: add tray icon for system tray launcher"
```

---

## Task 2: Add pystray and Pillow to backend/requirements.txt

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add dependencies**

Open `backend/requirements.txt` and add these two lines after the `greenlet` line:

```
pystray==0.19.5
Pillow==10.4.0
```

Final relevant section of the file:

```
aiosqlite==0.20.0
greenlet==3.4.0
pystray==0.19.5
Pillow==10.4.0
```

- [ ] **Step 2: Install into the venv**

```bash
backend\venv\Scripts\pip install pystray==0.19.5 Pillow==10.4.0
```

Expected: `Successfully installed pystray-0.19.5 Pillow-10.4.0` (or already satisfied).

- [ ] **Step 3: Commit**

```bash
git add backend/requirements.txt
git commit -m "feat: add pystray and Pillow to requirements"
```

---

## Task 3: Create Launcher.pyw

**Files:**
- Create: `Launcher.pyw`

`Launcher.pyw` runs under `pythonw.exe` (system Python, no console). It uses only the system Python's stdlib plus `pystray` and `Pillow` (installed there by `Launcher.vbs`). It calls the **venv** Python as a subprocess to run uvicorn.

- [ ] **Step 1: Create Launcher.pyw**

Create `Launcher.pyw` in the project root with the full content below:

```python
import os
import shutil
import subprocess
import threading
import time
import webbrowser
from pathlib import Path

import pystray
from PIL import Image

ROOT = Path(__file__).parent.resolve()
VENV_PY = ROOT / "backend" / "venv" / "Scripts" / "python.exe"
VENV_DIR = ROOT / "backend" / "venv"
REQUIREMENTS = ROOT / "backend" / "requirements.txt"
FRONTEND_DIR = ROOT / "frontend"
ICON_PATH = ROOT / "tray-icon.png"

CREATE_NO_WINDOW = 0x08000000

_si = subprocess.STARTUPINFO()
_si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
_si.wShowWindow = 0  # SW_HIDE


def _run_hidden(args, **kwargs):
    return subprocess.run(
        args,
        startupinfo=_si,
        creationflags=CREATE_NO_WINDOW,
        **kwargs,
    )


def ensure_venv():
    need_rebuild = not VENV_PY.exists()
    if not need_rebuild:
        result = subprocess.run(
            [str(VENV_PY), "--version"],
            capture_output=True,
        )
        if result.returncode != 0:
            need_rebuild = True

    if need_rebuild:
        if VENV_DIR.exists():
            shutil.rmtree(VENV_DIR)
        subprocess.run(["py", "-3.13", "-m", "venv", str(VENV_DIR)], check=True)

    _run_hidden(
        [str(VENV_PY), "-m", "pip", "install", "-r", str(REQUIREMENTS), "-q"],
        check=True,
    )


def ensure_node_modules():
    if not (FRONTEND_DIR / "node_modules").exists():
        _run_hidden(
            "npm install -q",
            cwd=str(FRONTEND_DIR),
            shell=True,
            check=True,
        )


def start_backend():
    return subprocess.Popen(
        [
            str(VENV_PY), "-m", "uvicorn", "app.main:app",
            "--host", "127.0.0.1", "--reload",
        ],
        cwd=str(ROOT / "backend"),
        startupinfo=_si,
        creationflags=CREATE_NO_WINDOW,
    )


def start_frontend():
    return subprocess.Popen(
        "npx --yes vite --host 127.0.0.1",
        cwd=str(FRONTEND_DIR),
        shell=True,
        startupinfo=_si,
        creationflags=CREATE_NO_WINDOW,
    )


def _quit(icon, backend_proc, frontend_proc):
    for proc in [backend_proc, frontend_proc]:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
    icon.stop()


def _make_menu(backend_proc, frontend_proc):
    def backend_label(item):
        ok = backend_proc.poll() is None
        return f"Backend:  {'✓ Running' if ok else '✗ Stopped'}"

    def frontend_label(item):
        ok = frontend_proc.poll() is None
        return f"Frontend: {'✓ Running' if ok else '✗ Stopped'}"

    return pystray.Menu(
        pystray.MenuItem(
            "Open Roster Monster",
            lambda icon, item: webbrowser.open("http://127.0.0.1:5173"),
            default=True,
        ),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(
            "Status",
            pystray.Menu(
                pystray.MenuItem(backend_label, None, enabled=False),
                pystray.MenuItem(frontend_label, None, enabled=False),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem(
                    "Quit",
                    lambda icon, item: _quit(icon, backend_proc, frontend_proc),
                ),
            ),
        ),
    )


def main():
    ensure_venv()
    ensure_node_modules()

    backend_proc = start_backend()
    frontend_proc = start_frontend()

    def _open_browser():
        time.sleep(4)
        webbrowser.open("http://127.0.0.1:5173")

    threading.Thread(target=_open_browser, daemon=True).start()

    image = Image.open(str(ICON_PATH))
    menu = _make_menu(backend_proc, frontend_proc)
    icon = pystray.Icon("Roster Monster", image, "Roster Monster", menu)
    icon.run()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify the file parses correctly (syntax check)**

```bash
py -c "import ast; ast.parse(open('Launcher.pyw').read()); print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add Launcher.pyw
git commit -m "feat: create Launcher.pyw system tray app"
```

---

## Task 4: Create Launcher.vbs

**Files:**
- Create: `Launcher.vbs`

`Launcher.vbs` is the file the user double-clicks. It runs entirely via `wscript.exe` (always available on Windows). It:
1. Checks `py` is on PATH
2. Silently installs `pystray` and `Pillow` into the system Python
3. Launches `pythonw Launcher.pyw` with a hidden window

- [ ] **Step 1: Create Launcher.vbs**

Create `Launcher.vbs` in the project root:

```vbs
Set sh = CreateObject("WScript.Shell")
root = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)

' Check Python is installed
If sh.Run("py --version", 0, True) <> 0 Then
    MsgBox "Python 3 is required to run Roster Monster." & vbCrLf & _
           "Download it from https://python.org", 16, "Roster Monster"
    WScript.Quit
End If

' Ensure pystray and Pillow are available in system Python
sh.Run "py -m pip install pystray==0.19.5 Pillow==10.4.0 -q", 0, True

' Launch the tray app silently (window style 0 = hidden)
sh.Run "pythonw """ & root & "\Launcher.pyw""", 0, False
```

- [ ] **Step 2: Commit**

```bash
git add Launcher.vbs
git commit -m "feat: create Launcher.vbs entry point with Python check"
```

---

## Task 5: End-to-End Test and Final Commit

- [ ] **Step 1: Confirm all files are present**

```bash
ls Launcher.vbs Launcher.pyw tray-icon.png
```

Expected: all three files listed.

- [ ] **Step 2: Test Launcher.vbs by double-clicking it in File Explorer**

Expected sequence:
1. No console window appears
2. After ~5–10 seconds (venv + npm checks on first run), a tray icon appears in the Windows system tray (bottom-right)
3. The browser opens to `http://127.0.0.1:5173` automatically

- [ ] **Step 3: Test left-click**

Left-click the tray icon.

Expected: browser opens / focuses `http://127.0.0.1:5173`.

- [ ] **Step 4: Test Status submenu**

Right-click the tray icon → hover over **Status**.

Expected submenu:
```
Backend:  ✓ Running
Frontend: ✓ Running
──────────────────
Quit
```

- [ ] **Step 5: Test Quit**

Right-click → Status → **Quit**.

Expected: tray icon disappears. Verify both processes are gone:

```bash
tasklist | findstr "uvicorn"
tasklist | findstr "node"
```

Expected: no results (or only unrelated processes).

- [ ] **Step 6: Push to remote**

```bash
git push origin main
```

---

## Notes

- **First launch delay:** On a fresh machine, `ensure_venv()` and `ensure_node_modules()` may take 60–120 seconds silently before the tray icon appears. This is expected.
- **start.bat is untouched:** It remains the terminal fallback. Both launchers can coexist — they start the same servers on the same ports, so do not run both at once.
- **pythonw vs py:** `Launcher.vbs` uses `pythonw` to run `Launcher.pyw`, which means no console. The internal `subprocess.Popen` calls use `CREATE_NO_WINDOW` to suppress child consoles.
