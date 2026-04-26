import ctypes
import shutil
import subprocess
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import pystray
from PIL import Image

# ── Single-instance guard ──────────────────────────────────────────────────────
_mutex = ctypes.windll.kernel32.CreateMutexW(None, False, "RosterMonsterLauncher")
if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
    raise SystemExit(0)

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.resolve()
VENV_PY = ROOT / "backend" / "venv" / "Scripts" / "python.exe"
VENV_DIR = ROOT / "backend" / "venv"
REQUIREMENTS = ROOT / "backend" / "requirements.txt"
FRONTEND_DIR = ROOT / "frontend"
VITE_JS = FRONTEND_DIR / "node_modules" / "vite" / "bin" / "vite.js"
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
    # Call node directly with vite.js — bypasses vite.cmd which breaks
    # when the path contains '&' (e.g. "30-39 Career & Professional")
    return subprocess.Popen(
        ["node", str(VITE_JS), "--host", "127.0.0.1"],
        cwd=str(FRONTEND_DIR),
        startupinfo=_si,
        creationflags=CREATE_NO_WINDOW,
    )


def _wait_for_server(url, timeout=30):
    """Poll until the server responds or timeout is reached."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False


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
        # Wait until the frontend is actually serving before opening the browser
        _wait_for_server("http://127.0.0.1:5173", timeout=30)
        webbrowser.open("http://127.0.0.1:5173")

    threading.Thread(target=_open_browser, daemon=True).start()

    image = Image.open(str(ICON_PATH))
    menu = _make_menu(backend_proc, frontend_proc)
    icon = pystray.Icon("Roster Monster", image, "Roster Monster", menu)
    icon.run()


if __name__ == "__main__":
    main()
