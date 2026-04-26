import logging
import logging.config
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import init_db
from .routers import staff, teams, monthly_config, roster, duties, config

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
