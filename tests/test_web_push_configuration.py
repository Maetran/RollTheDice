from __future__ import annotations

import base64
import tempfile
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid

from scripts.configure_web_push import KEYS, configure_web_push


def test_bootstrap_preserves_other_settings_and_never_rotates_keys() -> None:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / ".env"
        original = "# existing configuration\nUNRELATED=keep-me\n"
        path.write_text(original)
        backup = configure_web_push(path, "https://example.test")
        assert backup.read_text() == original
        assert backup.stat().st_mode & 0o777 == 0o600
        assert path.stat().st_mode & 0o777 == 0o600
        configured = path.read_text()
        assert configured.startswith(original)
        values = dict(line.split("=", 1) for line in configured.splitlines() if "=" in line)
        vapid = Vapid.from_string(values[KEYS[1]])
        public = vapid.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        assert base64.urlsafe_b64encode(public).rstrip(b"=").decode() == values[KEYS[0]]
        assert configure_web_push(path, "https://example.test") is None
        assert path.read_text() == configured


def test_bootstrap_refuses_partial_configuration_without_modifying_it() -> None:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / ".env"
        original = f"{KEYS[0]}=already-configured\n"
        path.write_text(original)
        with pytest.raises(ValueError, match="partial"):
            configure_web_push(path, "https://example.test")
        assert path.read_text() == original
        assert list(Path(directory).iterdir()) == [path]
