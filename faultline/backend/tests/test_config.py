from app.config import Settings


def test_settings_defaults():
    s = Settings(
        _env_file=None,
        anthropic_api_key="",
        opik_api_key="",
        langchain_api_key="",
    )
    assert s.surreal_url == "ws://localhost:8000/rpc"
    assert s.surreal_user == "root"
    assert s.surreal_pass == "root"
    assert s.surreal_ns == "faultline"
    assert s.surreal_db == "faultline"
    assert s.opik_project_name == "faultline"
    assert s.langchain_project == "faultline"
    assert s.rate_limit_requests_per_hour == 20
    assert s.rate_limit_tokens_per_hour == 100000


def test_settings_override_from_env(monkeypatch):
    monkeypatch.setenv("SURREAL_URL", "ws://custom:9999/rpc")
    monkeypatch.setenv("RATE_LIMIT_REQUESTS_PER_HOUR", "50")
    s = Settings(_env_file=None)
    assert s.surreal_url == "ws://custom:9999/rpc"
    assert s.rate_limit_requests_per_hour == 50
