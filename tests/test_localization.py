from pathlib import Path

from app.achievements import ACHIEVEMENTS

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "app" / "static"
USER_PAGES = {
    "index.html",
    "room.html",
    "rules.html",
    "game_view.html",
    "players.html",
    "profile.html",
    "account.html",
    "admin.html",
    "offline.html",
}


def test_every_user_facing_page_loads_shared_localization_catalog():
    for filename in USER_PAGES:
        source = (STATIC / filename).read_text(encoding="utf-8")
        assert "/static/shell.js" in source, f"{filename} does not load the shared localization catalog"


def test_localization_catalog_is_available_offline():
    service_worker = (STATIC / "sw.js").read_text(encoding="utf-8")
    assert "'/static/shell.js'" in service_worker
    assert "'/manifest-en.webmanifest'" in service_worker


def test_both_localized_manifests_are_packaged():
    assert (ROOT / "manifest.webmanifest").exists()
    assert (ROOT / "manifest-en.webmanifest").exists()
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "COPY manifest-en.webmanifest /app/manifest-en.webmanifest" in dockerfile


def test_localization_maintenance_guide_exists():
    guide = (ROOT / "docs" / "LOCALIZATION.md").read_text(encoding="utf-8")
    assert "German is the canonical source" in guide
    assert "ZTO / ZTU" in guide


def test_every_achievement_name_and_description_has_an_english_catalog_entry():
    catalog = (ROOT / "frontend" / "i18n" / "catalog.js").read_text(encoding="utf-8")
    missing = [
        value
        for achievement in ACHIEVEMENTS
        for value in (achievement.name, achievement.description)
        if f'"{value}":' not in catalog
    ]
    assert not missing, missing
