"""Integration tests for key API endpoints using FastAPI TestClient + in-memory async SQLite."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import Base, get_db

# ── Test database setup ───────────────────────────────────────────────────────
# StaticPool + check_same_thread=False ensures all async connections share
# the same in-memory SQLite database across the test session.

_engine = create_async_engine(
    "sqlite+aiosqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingAsyncSession = async_sessionmaker(_engine, expire_on_commit=False)


async def override_get_db():
    async with TestingAsyncSession() as session:
        yield session


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    import asyncio

    loop = asyncio.new_event_loop()

    async def _create():
        async with _engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    loop.run_until_complete(_create())
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()

    async def _drop():
        async with _engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)

    loop.run_until_complete(_drop())
    loop.close()


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


# ── Health ────────────────────────────────────────────────────────────────────

def test_health(client: TestClient):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


# ── Staff CRUD ────────────────────────────────────────────────────────────────

def test_create_and_list_staff(client: TestClient):
    payload = {"name": "Dr Test", "rank": "Medical Officer"}
    r = client.post("/api/staff", json=payload)
    assert r.status_code == 200
    created = r.json()
    assert created["name"] == "Dr Test"
    assert created["rank"] == "Medical Officer"
    assert "id" in created

    r2 = client.get("/api/staff")
    assert r2.status_code == 200
    names = [s["name"] for s in r2.json()]
    assert "Dr Test" in names


def test_create_staff_returns_id(client: TestClient):
    payload = {"name": "Dr Second", "rank": "Consultant"}
    r = client.post("/api/staff", json=payload)
    assert r.status_code == 200
    assert isinstance(r.json()["id"], int)


def test_update_staff(client: TestClient):
    payload = {"name": "Dr Update", "rank": "Medical Officer"}
    r = client.post("/api/staff", json=payload)
    staff_id = r.json()["id"]

    r2 = client.put(f"/api/staff/{staff_id}", json={"name": "Dr Updated", "rank": "Medical Officer"})
    assert r2.status_code == 200
    assert r2.json()["name"] == "Dr Updated"


def test_delete_staff(client: TestClient):
    payload = {"name": "Dr Delete", "rank": "Medical Officer"}
    r = client.post("/api/staff", json=payload)
    staff_id = r.json()["id"]

    r2 = client.delete(f"/api/staff/{staff_id}")
    assert r2.status_code == 200

    r3 = client.get("/api/staff")
    ids = [s["id"] for s in r3.json()]
    assert staff_id not in ids


# ── Leave overlap validation ──────────────────────────────────────────────────

def test_leave_duplicate_rejected(client: TestClient):
    payload = {"name": "Dr Leave", "rank": "Medical Officer"}
    staff_id = client.post("/api/staff", json=payload).json()["id"]

    leave_payload = {"staff_id": staff_id, "date": "2026-05-10", "leave_type": "AL"}
    r1 = client.post("/api/staff/leave", json=leave_payload)
    assert r1.status_code == 200

    r2 = client.post("/api/staff/leave", json=leave_payload)
    assert r2.status_code == 409


# ── Monthly config ────────────────────────────────────────────────────────────

def test_create_monthly_config(client: TestClient):
    r = client.post("/api/config", json={"year": 2026, "month": 9})
    assert r.status_code in (200, 201)
    data = r.json()
    assert data["year"] == 2026
    assert data["month"] == 9


def test_list_monthly_configs(client: TestClient):
    r = client.get("/api/config")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
