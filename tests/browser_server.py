"""Start one disposable browser-test backend on a kernel-assigned loopback port."""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
from pathlib import Path

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--mode", choices=("main", "passkeys", "hausdepp-passkeys"), required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        # Keep this socket open through Uvicorn startup: another checkout or
        # browser worker cannot claim the port between selection and binding.
        listener.bind(("127.0.0.1", 0))
        listener.set_inheritable(True)
        port = listener.getsockname()[1]
        upstream = f"http://127.0.0.1:{port}"
        if args.mode == "passkeys":
            base_url = f"http://rollthedice.localhost:{port}"
            os.environ.update({
                "ROLLTHEDICE_SITE_ORIGIN": base_url,
                "ROLLTHEDICE_ZILCH_ORIGIN": f"http://zilch.rollthedice.localhost:{port}",
                "ROLLTHEDICE_PASSKEYS_ENABLED": "1",
                "ROLLTHEDICE_WEBAUTHN_RP_ID": "rollthedice.localhost",
                "ROLLTHEDICE_WEBAUTHN_RP_NAME": "RollTheDice browser test",
            })
        elif args.mode == "hausdepp-passkeys":
            base_url = "https://hausdepp.zockdiewandan.online"
            os.environ.update({
                "ROLLTHEDICE_SITE_ORIGIN": "https://zockdiewandan.online",
                "ROLLTHEDICE_ZILCH_ORIGIN": "https://zilch.zockdiewandan.online",
                "ROLLTHEDICE_PASSKEYS_ENABLED": "1",
                "ROLLTHEDICE_WEBAUTHN_RP_ID": "zockdiewandan.online",
                "ROLLTHEDICE_COOKIE_SECURE": "1",
            })
        else:
            base_url = upstream
            os.environ.update({
                "ROLLTHEDICE_SITE_ORIGIN": base_url,
                "ROLLTHEDICE_ZILCH_ORIGIN": "https://zilch.zockdiewandan.online",
            })

        # Legacy result JSON must be isolated as well as SQLite. Redirect these
        # test-only globals before lifespan imports or writes any result data.
        from app import main as application
        from app.asgi import create_application
        from app.leaderboard_storage import LeaderboardFiles

        application.DATA_DIR = args.directory
        application.LEADERBOARD_FILES = LeaderboardFiles.in_directory(args.directory)
        address = {"baseURL": base_url, "upstreamOrigin": upstream}
        (args.directory / "server.json").write_text(json.dumps(address), encoding="utf-8")
        server = uvicorn.Server(uvicorn.Config(
            create_application,
            factory=True,
            host="127.0.0.1",
            port=port,
            proxy_headers=args.mode == "hausdepp-passkeys",
            forwarded_allow_ips="127.0.0.1",
            ws_max_size=65536,
            log_level="warning",
        ))
        server.run(sockets=[listener])


if __name__ == "__main__":
    main()
