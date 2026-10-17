"""Choose test workers from usable resources without an extra dependency.

One GiB per pytest worker leaves room for Python, database fixtures, coverage
and production-strength Argon2 hashing. CPU quotas use ceiling division so a
fractional CPU allocation can still be fully used. Explicit worker counts are
deliberate overrides; only the automatic default uses these limits.
"""

from __future__ import annotations

import json
import os
import warnings
from collections.abc import Sequence
from pathlib import Path

PROC_ROOT = Path("/proc")
CGROUP_ROOT = Path("/sys/fs/cgroup")
PYTEST_WORKER_BYTES = 1024 ** 3


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return ""


def _nonnegative_int(value: str) -> int | None:
    try:
        number = int(value)
    except ValueError:
        return None
    return number if number >= 0 else None


def _cgroup_directories(controller: str, cgroup_root: Path, proc_root: Path) -> list[Path]:
    """Inspect standard v1/v2 mounts and the process's visible ancestors."""
    bases = [cgroup_root, cgroup_root / controller]
    if controller == "cpu":
        bases.append(cgroup_root / "cpu,cpuacct")
    relatives = [Path()]
    for line in _read_text(proc_root / "self/cgroup").splitlines():
        fields = line.split(":", 2)
        if len(fields) != 3 or (fields[1] and controller not in fields[1].split(",")):
            continue
        relative = Path(fields[2].lstrip("/"))
        if ".." in relative.parts:
            continue
        relatives.extend([relative, *relative.parents])
    return list(dict.fromkeys(base / relative for base in bases for relative in relatives))


def available_cpu_count(*, cgroup_root: Path = CGROUP_ROOT, proc_root: Path = PROC_ROOT) -> int:
    """Respect interpreter CPU limits, process affinity and Linux CPU quotas."""
    count = None
    for name in ("process_cpu_count", "cpu_count"):
        try:
            getter = getattr(os, name, lambda: None)
            count = getter()
        except (OSError, NotImplementedError):
            continue
        if count and count > 0:
            break
    limits = [max(1, count or 1)]
    try:
        affinity = os.sched_getaffinity(0)
        if affinity:
            limits.append(len(affinity))
    except (AttributeError, OSError, NotImplementedError):
        pass
    for directory in _cgroup_directories("cpu", cgroup_root, proc_root):
        quota_period = _read_text(directory / "cpu.max").split()
        if len(quota_period) == 2:
            quota, period = map(_nonnegative_int, quota_period)
            if quota and period:
                limits.append((quota + period - 1) // period)
        quota = _nonnegative_int(_read_text(directory / "cpu.cfs_quota_us"))
        period = _nonnegative_int(_read_text(directory / "cpu.cfs_period_us"))
        if quota and period:
            limits.append((quota + period - 1) // period)
    return min(limits)


def available_memory_bytes(*, cgroup_root: Path = CGROUP_ROOT, proc_root: Path = PROC_ROOT) -> int | None:
    """Use physical memory, Linux free memory and remaining container budget."""
    limits = []
    try:
        pages, page_size = os.sysconf("SC_PHYS_PAGES"), os.sysconf("SC_PAGE_SIZE")
        if pages > 0 and page_size > 0:
            limits.append(pages * page_size)
    except (AttributeError, OSError, ValueError):
        pass
    for line in _read_text(proc_root / "meminfo").splitlines():
        fields = line.split()
        if len(fields) == 3 and fields[0] == "MemAvailable:" and fields[2] == "kB":
            available = _nonnegative_int(fields[1])
            if available is not None:
                limits.append(available * 1024)
    for directory in _cgroup_directories("memory", cgroup_root, proc_root):
        for limit_file, usage_file in (("memory.max", "memory.current"),
                                       ("memory.limit_in_bytes", "memory.usage_in_bytes")):
            limit = _nonnegative_int(_read_text(directory / limit_file))
            if limit is not None:
                usage = _nonnegative_int(_read_text(directory / usage_file)) or 0
                limits.append(max(0, limit - usage))
    return min(limits) if limits else None


def pytest_worker_count(arguments: Sequence[str]) -> int:
    """Preserve xdist overrides and avoid many collectors for a concrete case."""
    override = os.environ.get("PYTEST_XDIST_AUTO_NUM_WORKERS")
    if override:
        number = _nonnegative_int(override)
        if number is not None:
            return number
        warnings.warn(
            "PYTEST_XDIST_AUTO_NUM_WORKERS must be a non-negative integer; ignoring it.",
            RuntimeWarning,
            stacklevel=2,
        )
    if len(arguments) == 1:
        parts = arguments[0].split("::")
        method = parts[-1]
        if len(parts) >= 2 and method.startswith("test"):
            # A bare module::test_function can collect many parameter cases.
            # Concrete parameter IDs and the project's unittest methods are
            # narrow selections, where starting every collector costs more.
            if len(parts) >= 3 or ("[" in method and method.endswith("]")):
                return 1
    workers = available_cpu_count()
    memory = available_memory_bytes()
    if memory is not None:
        workers = min(workers, max(1, memory // PYTEST_WORKER_BYTES))
    return workers


if __name__ == "__main__":
    # Browser configuration shares this probe instead of guessing container
    # CPU/memory limits independently in JavaScript.
    print(json.dumps({"cpus": available_cpu_count(), "memory": available_memory_bytes()}))
