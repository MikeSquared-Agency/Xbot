def test_health_returns_200(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_method_not_allowed(client):
    response = client.post("/health")
    assert response.status_code == 405
