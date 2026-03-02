"""Tests for strategies module."""

from echo.compose.strategies import (
    DEFAULT_WEIGHTS,
    STRATEGIES,
    order_strategies_by_weight,
)


class TestStrategies:
    def test_all_five_strategies_defined(self):
        expected = {"contrarian", "experience", "additive", "question", "pattern_interrupt"}
        assert set(STRATEGIES.keys()) == expected

    def test_default_weights_equal(self):
        for weight in DEFAULT_WEIGHTS.values():
            assert weight == 0.20

    def test_default_weights_cover_all_strategies(self):
        assert set(DEFAULT_WEIGHTS.keys()) == set(STRATEGIES.keys())


class TestOrderStrategies:
    def test_equal_weights_returns_all(self):
        result = order_strategies_by_weight(DEFAULT_WEIGHTS)
        assert len(result) == 5
        assert set(result) == set(STRATEGIES.keys())

    def test_highest_weight_first(self):
        weights = {
            "contrarian": 0.10,
            "experience": 0.50,
            "additive": 0.15,
            "question": 0.20,
            "pattern_interrupt": 0.05,
        }
        result = order_strategies_by_weight(weights)
        assert result[0] == "experience"
        assert result[-1] == "pattern_interrupt"

    def test_missing_weight_treated_as_zero(self):
        weights = {"contrarian": 0.30}
        result = order_strategies_by_weight(weights)
        assert result[0] == "contrarian"
