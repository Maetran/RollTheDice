"""Apply the same pytest worker policy to terminal, CI and IDE test runs."""

import pytest

from scripts import test_resources


@pytest.hookimpl(tryfirst=True)
def pytest_xdist_auto_num_workers(config: pytest.Config) -> int:
    # xdist calls this hook only for -n auto/logical. Explicit -n N/-n 0 wins.
    return test_resources.pytest_worker_count(config.args)
