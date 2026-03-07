"""Integration tests for docker-compose.yml structure."""
import pathlib

import yaml
import pytest


COMPOSE_PATH = pathlib.Path(__file__).resolve().parents[2] / "docker-compose.yml"


@pytest.fixture
def compose():
    return yaml.safe_load(COMPOSE_PATH.read_text())


def test_compose_file_exists():
    assert COMPOSE_PATH.exists()


def test_surrealdb_service(compose):
    sdb = compose["services"]["surrealdb"]
    assert sdb["image"] == "surrealdb/surrealdb:v2.2.1"
    assert "8000:8000" in sdb["ports"]
    assert sdb["healthcheck"] is not None


def test_surrealdb_healthcheck(compose):
    hc = compose["services"]["surrealdb"]["healthcheck"]
    assert "curl" in hc["test"]
    assert hc["interval"] == "5s"
    assert hc["retries"] == 5


def test_backend_service(compose):
    be = compose["services"]["backend"]
    assert "8080:8080" in be["ports"]
    assert be["depends_on"]["surrealdb"]["condition"] == "service_healthy"


def test_backend_env_vars(compose):
    env = compose["services"]["backend"]["environment"]
    env_dict = {e.split("=")[0]: e.split("=")[1] for e in env}
    assert env_dict["SURREAL_NS"] == "faultline"
    assert env_dict["SURREAL_DB"] == "faultline"
    assert "surrealdb:8000" in env_dict["SURREAL_URL"]


def test_volume_defined(compose):
    assert "surreal_data" in compose["volumes"]
