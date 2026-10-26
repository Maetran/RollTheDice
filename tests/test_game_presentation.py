"""Beta labels can change without changing public rollout or game permissions."""

import pytest

from app.database import session_scope
from app.feature_flags import set_game_beta
from app.ownership import bind_founder
from tests import test_watten_runtime as native

server = native.server


@pytest.mark.parametrize("language", ("de", "en"))
def test_watten_beta_label_updates_ssr_picker_payload_and_keeps_public_access(server, monkeypatch, language):
    owner, cookie = native.account("PresentationOwner", role="admin")
    with session_scope() as db:
        bind_founder(db, owner.user_id)
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_PUBLIC_BETA", "1")
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", "https://zockdiewandan.online")
    origin = "https://watten.zockdiewandan.online"
    for beta, version in ((False, 0), (True, 1)):
        with session_scope() as db:
            set_game_beta(db, actor_user_id=owner.user_id, game="watten", beta=beta, version=version)
        for path in ("/watten", "/watten/regeln"):
            response = server.get(origin + path + "?lang=" + language)
            assert response.status_code == 200
            assert "data-watten-public-beta=\"true\"" in response.text
            assert ("[BETA]" in response.text) is beta
            assert ("Public beta:" in response.text or "Öffentliche Beta:" in response.text) is beta
            assert "data-game-presentation=" in response.text
        anonymous = server.get(origin + "/api/auth/me").json()
        assert anonymous["game_access"]["watten_public"] is True
        assert anonymous["game_presentation"]["watten"]["beta"] is beta
        signed_in = server.get(origin + "/api/auth/me", headers={"Cookie": cookie}).json()
        assert signed_in["user"]["id"] == owner.user_id
        assert signed_in["game_presentation"]["watten"]["beta"] is beta
        manifest = server.get(origin + ("/watten-manifest-en.webmanifest" if language == "en" else "/watten-manifest.webmanifest"))
        assert manifest.status_code == 200
        metadata = manifest.json()
        assert ("[BETA]" in metadata["name"]) is beta
        assert ("Public beta." in metadata["description"] or "Öffentliche Beta." in metadata["description"]) is beta
        assert metadata["id"] == "/watten" and metadata["scope"] == "/"
        assert metadata["start_url"] == "/watten?pwa=watten"


def test_whole_game_beta_is_independent_of_feature_status(server):
    owner, _cookie = native.account("GameBetaOwner", role="admin")
    with session_scope() as db:
        bind_founder(db, owner.user_id)
        for game in ("zdwa", "zilch", "hausdepp"):
            set_game_beta(db, actor_user_id=owner.user_id, game=game, beta=True, version=0)
    settings = server.get("/api/features").json()
    assert all(settings["games"][game]["beta"] for game in ("zdwa", "zilch", "hausdepp", "watten"))
    assert all(not item["can_select"] for item in settings["features"].values())
    for url in (native.LOCAL + "/manifest.webmanifest", "http://zilch.localhost:8127/zilch-manifest.webmanifest",
                native.LOCAL + "/hausdepp-manifest.webmanifest"):
        response = server.get(url)
        assert response.status_code == 200
        assert "[BETA]" in response.json()["name"]
