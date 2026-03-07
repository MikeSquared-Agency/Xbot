from app.main import app


def test_app_title():
    assert app.title == "FaultLine"


def test_app_version():
    assert app.version == "0.1.0"


def test_cors_middleware_configured():
    middleware_classes = [m.cls.__name__ for m in app.user_middleware]
    assert "CORSMiddleware" in middleware_classes


def test_openapi_schema(client):
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert schema["info"]["title"] == "FaultLine"
    assert "/health" in schema["paths"]
