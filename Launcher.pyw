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
