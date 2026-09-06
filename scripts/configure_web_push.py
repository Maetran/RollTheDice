"""Initialize VAPID in an existing .env without printing or rotating secrets."""

from __future__ import annotations

import argparse
import base64
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

PREFIX = "ROLLTHEDICE_WEB_PUSH_VAPID_"
KEYS = tuple(PREFIX + name for name in ("PUBLIC_KEY", "PRIVATE_KEY", "SUBJECT"))


def configure_web_push(path: Path, subject: str) -> Path | None:
    """Keep existing configuration; otherwise back up and atomically add keys."""
    if path.is_symlink() or not path.is_file():
        raise ValueError("An existing regular .env file is required")
    if not subject.startswith(("https://", "mailto:")) or any(char.isspace() for char in subject):
        raise ValueError("Use an HTTPS contact URL or mailto: address")
    original = path.read_text(encoding="utf-8")
    metadata = path.stat()
    lines = original.splitlines()
    configured = {}
    for line in lines:
        name, separator, value = line.partition("=")
        if separator and name.strip() in KEYS:
            configured[name.strip()] = value.strip().strip("\"'")
    if any(configured.values()):
        if not all(configured.get(key) for key in KEYS):
            raise ValueError("Refusing to replace a partial VAPID configuration")
        return None

    private = ec.generate_private_key(ec.SECP256R1())
    public_bytes = private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    private_bytes = private.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    public_key = base64.urlsafe_b64encode(public_bytes).rstrip(b"=").decode("ascii")
    private_key = base64.urlsafe_b64encode(private_bytes).rstrip(b"=").decode("ascii")
    retained = [line for line in lines if line.partition("=")[0].strip() not in KEYS]
    updated = "\n".join([*retained, "", *(f"{key}={value}" for key, value in zip(KEYS, (public_key, private_key, subject), strict=True)), ""])

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f")
    backup = path.with_name(f"{path.name}.backup-web-push-{stamp}")
    with os.fdopen(os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "w", encoding="utf-8") as output:
        output.write(original)
        output.flush()
        os.fsync(output.fileno())
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".web-push-", delete=False, encoding="utf-8") as output:
            temporary = Path(output.name)
            output.write(updated)
            output.flush()
            os.fsync(output.fileno())
            if os.geteuid() == 0:
                os.fchown(output.fileno(), metadata.st_uid, metadata.st_gid)
        if path.read_text(encoding="utf-8") != original:
            raise RuntimeError("Configuration changed concurrently; nothing replaced")
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return backup


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--subject", required=True)
    args = parser.parse_args()
    backup = configure_web_push(args.env_file, args.subject)
    print(f"Web Push configured; protected backup: {backup}" if backup else "Existing Web Push configuration preserved")


if __name__ == "__main__":
    main()
