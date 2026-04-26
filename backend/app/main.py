import logging
import logging.config
import os
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import init_db
from .routers import staff, teams, monthly_config, roster, duties, config

# Sentinel file written to signal the Launcher to quit everything cleanly.
# Launcher.pyw monitors this file and runs _kill_tree on all child processes.
_QUIT_FLAG = Path(__file__).parent.parent / "__quit__.flag"

# ── Heartbeat / tab-close watchdog ───────────────────────────────────────────
_heartbeat_armed = False   # True after first client heartbeat received
_last_heartbeat: float = 0.0
_HEARTBEAT_TIMEOUT = 30    # seconds of silence before triggering quit
_HEARTBEAT_POLL = 5        # how often the watchdog checks


def _heartbeat_watchdog():
    """Background thread: quit the app if no heartbeat for HEARTBEAT_TIMEOUT s."""
    while True:
        time.sleep(_HEARTBEAT_POLL)
        if _heartbeat_armed and (time.time() - _last_heartbeat) > _HEARTBEAT_TIMEOUT:
            logging.getLogger(__name__).info(
                "No heartbeat for %ds — writing quit sentinel", _HEARTBEAT_TIMEOUT
            )
            _QUIT_FLAG.write_text("quit")
            break  # watchdog done; Launcher will handle the rest


threading.Thread(target=_heartbeat_watchdog, daemon=True).start()

logging.config.dictConfig(
    {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "json": {
                "format": '{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": "%(message)s"}',
                "datefmt": "%Y-%m-%dT%H:%M:%S",
            }
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "json",
            }
        },
        "root": {"level": settings.LOG_LEVEL, "handlers": ["console"]},
    }
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Roster Monster — initialising database")
    await init_db()
    logger.info("Database ready")
    yield


app = FastAPI(title="Roster Monster", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(staff.router)
app.include_router(teams.router)
app.include_router(config.router)
app.include_router(monthly_config.router)
app.include_router(roster.router)
app.include_router(duties.router)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next) -> Response:
    request_id = str(uuid.uuid4())[:8]
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = round((time.perf_counter() - start) * 1000)
    logger.info(
        "%s %s %s %dms id=%s",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
        request_id,
    )
    return response


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/heartbeat")
async def heartbeat():
    """Frontend pings this every 5 s while a tab is open.
    Absence of pings for 30 s triggers a clean shutdown via the Launcher sentinel."""
    global _heartbeat_armed, _last_heartbeat
    _last_heartbeat = time.time()
    _heartbeat_armed = True
    return {"ok": True}


@app.post("/api/quit")
async def quit_app():
    """Write the quit sentinel — Launcher picks it up and kills all child processes."""
    _QUIT_FLAG.write_text("quit")
    return {"ok": True}
