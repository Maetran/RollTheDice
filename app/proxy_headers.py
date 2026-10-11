"""Preserve verified ingress provenance before resolving visitor proxy headers."""
from __future__ import annotations

import ipaddress
from dataclasses import dataclass

from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

# Published ingress ranges: https://www.cloudflare.com/ips/
_CLOUDFLARE_NETWORKS = tuple(ipaddress.ip_network(value) for value in (
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
    "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
    "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
    "2a06:98c0::/29", "2c0f:f248::/32",
))
_INGRESS_STATE_KEY = "_rollthedice_verified_ingress"


@dataclass(frozen=True)
class _VerifiedIngress:
    cloudflare_peer: str | None


def _cloudflare_address(value: str | None) -> str | None:
    if not value:
        return None
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return None
    return str(address) if any(address in network for network in _CLOUDFLARE_NETWORKS) else None


def trusted_cloudflare_peer(scope: dict) -> str | None:
    """Use private transport evidence, or the existing direct-CF integration."""
    ingress = scope.get("state", {}).get(_INGRESS_STATE_KEY)
    if isinstance(ingress, _VerifiedIngress):
        return ingress.cloudflare_peer
    client = scope.get("client")
    return _cloudflare_address(client[0] if client else None)


class TrustedProxyHeadersMiddleware:
    """Validate the raw proxy before Uvicorn replaces HTTP/WS client addresses.

    Nginx must overwrite X-RTD-Cloudflare-Peer with $realip_remote_addr and
    X-Forwarded-For with $remote_addr. Run Uvicorn with --no-proxy-headers so
    this wrapper receives the physical transport peer first. Forwarded
    address/protocol interpretation remains Uvicorn's maintained implementation.
    """

    def __init__(self, app, trusted_hosts: list[str] | str = "127.0.0.1") -> None:
        self.app = ProxyHeadersMiddleware(app, trusted_hosts=trusted_hosts)
        hosts = trusted_hosts.split(",") if isinstance(trusted_hosts, str) else trusted_hosts
        hosts = [host.strip() for host in hosts]
        self._country_trusted_networks = []
        # A wildcard may retain Uvicorn's configured forwarding semantics, but
        # can never authenticate the origin of a Cloudflare country hint.
        if "*" not in hosts:
            for host in hosts:
                try:
                    network = ipaddress.ip_network(host)
                except ValueError:
                    network = None
                if network is not None:
                    self._country_trusted_networks.append(network)

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] in {"http", "websocket"}:
            peer = scope.get("client")
            try:
                address = ipaddress.ip_address(peer[0]) if peer else None
            except ValueError:
                address = None
            cloudflare_peer = None
            if address is not None and any(address in network for network in self._country_trusted_networks):
                values = [value for name, value in scope.get("headers", [])
                          if name == b"x-rtd-cloudflare-peer"]
                # Duplicate fields and hop lists are not a verified single edge.
                if len(values) == 1:
                    cloudflare_peer = _cloudflare_address(values[0].decode("latin1").strip())
            elif address is not None:
                # Preserve direct Cloudflare ingress without trusting a header.
                cloudflare_peer = _cloudflare_address(str(address))
            scope["state"] = {**scope.get("state", {}),
                              _INGRESS_STATE_KEY: _VerifiedIngress(cloudflare_peer)}
        await self.app(scope, receive, send)
