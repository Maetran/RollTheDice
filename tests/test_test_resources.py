"""Worker defaults must use the actual machine/container allocation."""

from __future__ import annotations

import json
import runpy

import pytest

from scripts import test_resources as resources


def machine(monkeypatch, *, cpus=18, memory_gib=48):
    monkeypatch.setattr(resources.os, "process_cpu_count", lambda: cpus, raising=False)
    monkeypatch.setattr(resources.os, "cpu_count", lambda: 32)
    monkeypatch.setattr(resources.os, "sched_getaffinity", lambda _pid: set(range(32)), raising=False)
    values = {"SC_PHYS_PAGES": memory_gib * 1024 ** 3 // 4096, "SC_PAGE_SIZE": 4096}
    monkeypatch.setattr(resources.os, "sysconf", values.__getitem__, raising=False)


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def test_cpu_default_uses_process_allocation_and_affinity(monkeypatch, tmp_path):
    machine(monkeypatch)
    assert resources.available_cpu_count(cgroup_root=tmp_path, proc_root=tmp_path) == 18
    monkeypatch.setattr(resources.os, "sched_getaffinity", lambda _pid: {2, 4, 6, 8})
    assert resources.available_cpu_count(cgroup_root=tmp_path, proc_root=tmp_path) == 4


def test_cpu_detection_falls_back_when_platform_information_is_missing(monkeypatch, tmp_path):
    machine(monkeypatch)
    monkeypatch.delattr(resources.os, "process_cpu_count")
    monkeypatch.delattr(resources.os, "sched_getaffinity")
    monkeypatch.setattr(resources.os, "cpu_count", lambda: None)
    assert resources.available_cpu_count(cgroup_root=tmp_path, proc_root=tmp_path) == 1


def test_cpu_detection_falls_back_when_platform_queries_are_unsupported(monkeypatch, tmp_path):
    machine(monkeypatch)

    def unsupported(*_arguments):
        raise NotImplementedError

    monkeypatch.setattr(resources.os, "process_cpu_count", unsupported)
    monkeypatch.setattr(resources.os, "sched_getaffinity", unsupported)
    monkeypatch.setattr(resources.os, "cpu_count", lambda: 8)
    assert resources.available_cpu_count(cgroup_root=tmp_path, proc_root=tmp_path) == 8


@pytest.mark.parametrize("value,expected", [("250000 100000", 3), ("50000 100000", 1),
                                            ("max 100000", 18), ("invalid", 18), ("100000 0", 18)])
def test_v2_cpu_quotas_and_unlimited_or_invalid_values(monkeypatch, tmp_path, value, expected):
    machine(monkeypatch)
    write(tmp_path / "cpu.max", value)
    assert resources.available_cpu_count(cgroup_root=tmp_path, proc_root=tmp_path) == expected


def test_parent_cgroup_cpu_quota_limits_a_less_restricted_child(monkeypatch, tmp_path):
    machine(monkeypatch)
    cgroup, proc = tmp_path / "cgroup", tmp_path / "proc"
    write(proc / "self/cgroup", "0::/jobs/backend\n")
    write(cgroup / "jobs/cpu.max", "150000 100000")
    write(cgroup / "jobs/backend/cpu.max", "800000 100000")
    assert resources.available_cpu_count(cgroup_root=cgroup, proc_root=proc) == 2


def test_v1_combined_controller_cpu_quota(monkeypatch, tmp_path):
    machine(monkeypatch)
    cgroup, proc = tmp_path / "cgroup", tmp_path / "proc"
    write(proc / "self/cgroup", "3:cpu,cpuacct:/backend\n")
    write(cgroup / "cpu,cpuacct/backend/cpu.cfs_quota_us", "350000")
    write(cgroup / "cpu,cpuacct/backend/cpu.cfs_period_us", "100000")
    assert resources.available_cpu_count(cgroup_root=cgroup, proc_root=proc) == 4


def test_memory_uses_physical_memory_and_linux_available_memory(monkeypatch, tmp_path):
    machine(monkeypatch)
    assert resources.available_memory_bytes(cgroup_root=tmp_path, proc_root=tmp_path) == 48 * 1024 ** 3
    write(tmp_path / "meminfo", "MemTotal: 50331648 kB\nMemAvailable: 4194304 kB\n")
    assert resources.available_memory_bytes(cgroup_root=tmp_path, proc_root=tmp_path) == 4 * 1024 ** 3


@pytest.mark.parametrize("limit_file,usage_file", [("memory.max", "memory.current"),
                                                  ("memory.limit_in_bytes", "memory.usage_in_bytes")])
def test_memory_respects_remaining_container_budget(monkeypatch, tmp_path, limit_file, usage_file):
    machine(monkeypatch)
    write(tmp_path / limit_file, str(3 * 1024 ** 3))
    write(tmp_path / usage_file, str(1024 ** 3))
    assert resources.available_memory_bytes(cgroup_root=tmp_path, proc_root=tmp_path) == 2 * 1024 ** 3


def test_memory_without_platform_information_has_no_artificial_cap(monkeypatch, tmp_path):
    machine(monkeypatch)
    monkeypatch.delattr(resources.os, "sysconf")
    write(tmp_path / "memory.max", "max")
    assert resources.available_memory_bytes(cgroup_root=tmp_path, proc_root=tmp_path) is None


def test_undefined_sysconf_memory_values_do_not_create_a_false_one_byte_budget(monkeypatch, tmp_path):
    machine(monkeypatch)
    monkeypatch.setattr(resources.os, "sysconf", lambda _key: -1)
    assert resources.available_memory_bytes(cgroup_root=tmp_path, proc_root=tmp_path) is None


@pytest.mark.parametrize("memory,expected", [(48 * 1024 ** 3, 18), (3 * 1024 ** 3, 3), (0, 1), (None, 18)])
def test_auto_workers_use_all_cpus_with_a_memory_budget(monkeypatch, memory, expected):
    monkeypatch.delenv("PYTEST_XDIST_AUTO_NUM_WORKERS", raising=False)
    monkeypatch.setattr(resources, "available_cpu_count", lambda: 18)
    monkeypatch.setattr(resources, "available_memory_bytes", lambda: memory)
    assert resources.pytest_worker_count(["tests"]) == expected


@pytest.mark.parametrize("override", ["2", "24", "0"])
def test_standard_xdist_override_wins_even_for_one_explicit_test(monkeypatch, override):
    monkeypatch.setenv("PYTEST_XDIST_AUTO_NUM_WORKERS", override)
    assert resources.pytest_worker_count(["tests/test_example.py::test_example"]) == int(override)


def test_invalid_xdist_override_warns_and_uses_the_resource_default(monkeypatch):
    monkeypatch.setenv("PYTEST_XDIST_AUTO_NUM_WORKERS", "unlimited")
    monkeypatch.setattr(resources, "available_cpu_count", lambda: 4)
    monkeypatch.setattr(resources, "available_memory_bytes", lambda: None)
    with pytest.warns(RuntimeWarning, match="PYTEST_XDIST_AUTO_NUM_WORKERS"):
        assert resources.pytest_worker_count(["tests"]) == 4


def test_concrete_cases_avoid_many_collectors_but_functions_classes_and_files_scale(monkeypatch):
    monkeypatch.delenv("PYTEST_XDIST_AUTO_NUM_WORKERS", raising=False)
    monkeypatch.setattr(resources, "available_cpu_count", lambda: 18)
    monkeypatch.setattr(resources, "available_memory_bytes", lambda: None)
    assert resources.pytest_worker_count(["tests/test_example.py::ExampleTest::test_example"]) == 1
    assert resources.pytest_worker_count(["tests/test_example.py::test_example[param]"]) == 1
    assert resources.pytest_worker_count(["tests/test_example.py::test_parameterized_function"]) == 18
    assert resources.pytest_worker_count(["tests/test_example.py::ExampleTest"]) == 18
    assert resources.pytest_worker_count(["tests/test_example.py"]) == 18
    assert resources.pytest_worker_count(["tests/a.py::test_one", "tests/b.py::test_two"]) == 18


def test_cli_reports_the_same_resource_fields_for_other_test_runners(monkeypatch, capsys):
    machine(monkeypatch)
    monkeypatch.setattr(resources.Path, "read_text", lambda _path, **_kwargs: "")
    runpy.run_path(str(resources.__file__), run_name="__main__")
    assert json.loads(capsys.readouterr().out) == {"cpus": 18, "memory": 48 * 1024 ** 3}
