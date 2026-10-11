"""Production ASGI factory with one explicitly ordered proxy trust boundary."""
import os

from .proxy_headers import TrustedProxyHeadersMiddleware


def create_application():
    # Import lazily so Uvicorn's factory creates the normal FastAPI application
    # once and retains its existing routes and lifespan without a second server.
    from .main import app

    return TrustedProxyHeadersMiddleware(app, trusted_hosts=os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1"))
