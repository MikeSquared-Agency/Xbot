"""Verify all module stubs are importable."""
import importlib

import pytest

STUB_MODULES = [
    "app",
    "app.agents",
    "app.agents.intake",
    "app.agents.legal",
    "app.agents.technical",
    "app.agents.mitigation",
    "app.agents.pricing",
    "app.graph",
    "app.graph.workflow",
    "app.graph.state",
    "app.db",
    "app.db.client",
    "app.db.queries",
    "app.db.seed",
    "app.middleware",
    "app.middleware.auth",
    "app.middleware.rate_limit",
    "app.middleware.validation",
    "app.middleware.audit",
    "app.tracing",
    "app.tracing.opik_setup",
    "app.tracing.opik_evaluator",
    "app.tracing.langsmith_setup",
    "app.tracing.cost_tracker",
    "app.prompts",
    "app.prompts.manager",
    "app.routes",
    "app.routes.assess",
    "app.routes.scenario",
    "app.routes.knowledge",
    "app.routes.feedback",
]


@pytest.mark.parametrize("module_path", STUB_MODULES)
def test_stub_importable(module_path):
    mod = importlib.import_module(module_path)
    assert mod is not None
