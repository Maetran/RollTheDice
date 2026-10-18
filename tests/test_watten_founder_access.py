"""The private production capability follows the immutable founder account."""

from dataclasses import replace

import pytest
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from starlette.requests import Request

from app.database import session_scope
from app.models import User
from app.ownership import bind_founder, grant_ownership
from app.watten_access import (
    can_access_watten,
    can_discover_watten,
    require_watten_access,
    watten_founder_account_id,
    watten_founder_deployment_enabled,
    watten_game_preview_enabled,
    watten_request_enabled,
)
from tests import test_watten_runtime as native

server = native.server


def connection(host="zockdiewandan.online", *, extra=()):
    return Request({"type": "http", "method": "GET", "scheme": "https", "path": "/watten",
                    "query_string": b"", "server": ("zockdiewandan.online", 443),
                    "headers": [(b"host", host.encode()), *extra]})


def actors(monkeypatch):
    founder = native.account("FounderCanBeRenamed", role="admin")[0]
    owner = native.account("DelegatedOwner", role="admin")[0]
    admin = native.account("RegularAdmin", role="admin")[0]
    user = native.account("OrdinaryAccount")[0]
    with session_scope() as db:
        bind_founder(db, founder.user_id)
        grant_ownership(db, owner.user_id, founder.user_id)
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", "https://zockdiewandan.online")
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "1")
    return founder, owner, admin, user


def test_founder_is_fresh_id_authority_not_cached_role_name_or_ownership(server, monkeypatch):
    founder, owner, admin, user = actors(monkeypatch)
    assert not founder.is_founder  # The intentionally old identity predates binding.
    assert can_access_watten(founder, connection())
    for actor in (None, owner, admin, user, replace(user, is_founder=True, is_owner=True, role="admin")):
        assert not can_access_watten(actor, connection())
        assert not can_discover_watten(actor, connection())
    with session_scope() as db:
        assert watten_founder_account_id(db, lock=True) == founder.user_id
        db.execute(update(User).where(User.id == founder.user_id).values(username="RenamedFounder"))
    assert can_access_watten(founder, connection())
    with pytest.raises(IntegrityError, match="owner_protected"), session_scope() as db:
        db.execute(update(User).where(User.id == founder.user_id).values(is_active=False))
    assert can_access_watten(founder, connection())  # The immutable founder cannot be deactivated through SQL either.


@pytest.mark.parametrize("host", ("zilch.zockdiewandan.online", "hausdepp.zockdiewandan.online"))
def test_only_discovery_is_available_on_the_other_existing_suite_hosts(server, monkeypatch, host):
    founder, *_ = actors(monkeypatch)
    assert can_discover_watten(founder, connection(host))
    assert not can_access_watten(founder, connection(host))
    assert not watten_request_enabled(connection(host))


@pytest.mark.parametrize("host,extra", (
    ("watten.zockdiewandan.online", ()), ("zockdiewandan.online.", ()),
    ("zockdiewandan.online:444", ()), ("zockdiewandan.online,evil.invalid", ()),
    ("evil.invalid", ((b"x-forwarded-host", b"zockdiewandan.online"),)),
    ("zockdiewandan.online", ((b"host", b"zockdiewandan.online"),)),
    ("user@zockdiewandan.online", ()), ("zockdiewandan.online/path", ()),
))
def test_strict_raw_host_rejects_fixed_watten_ambiguity_and_forwarding(server, monkeypatch, host, extra):
    founder, *_ = actors(monkeypatch)
    request = connection(host, extra=extra)
    assert not can_access_watten(founder, request)
    assert not can_discover_watten(founder, request)
    assert not watten_request_enabled(request)


def test_production_requires_explicit_flag_and_exact_configured_apex_but_local_preview_is_unchanged(server, monkeypatch):
    founder, *_ = actors(monkeypatch)
    assert watten_founder_deployment_enabled()
    assert can_access_watten(founder, connection("zockdiewandan.online:443"))
    assert not watten_game_preview_enabled(connection())
    assert not can_access_watten(founder, None)
    monkeypatch.delenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW")
    assert not watten_founder_deployment_enabled()
    assert not can_access_watten(founder, connection())
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "1")
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", native.LOCAL)
    assert not watten_founder_deployment_enabled()
    ordinary = native.account("LocalHumanAccount")[0]
    assert can_access_watten(ordinary, connection("localhost:8127"))
    assert not can_access_watten(None, connection("localhost:8127"))
    assert require_watten_access(connection("localhost:8127"), ordinary) is ordinary
