from pathlib import Path

from app.achievements import (
    ACHIEVEMENT_POINTS_POSSIBLE,
    ACHIEVEMENTS,
    achievement_rank_for_points,
    achievement_sort_key,
)
from app.zilch_achievements import ZILCH_ACHIEVEMENT_CATEGORIES, ZILCH_ACHIEVEMENTS

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "app" / "static"
USER_PAGES = {
    "index.html",
    "room.html",
    "rules.html",
    "game_view.html",
    "players.html",
    "ranks.html",
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


def test_all_localized_manifests_are_packaged():
    assert (ROOT / "manifest.webmanifest").exists()
    assert (ROOT / "manifest-en.webmanifest").exists()
    assert (ROOT / "zilch-manifest.webmanifest").exists()
    assert (ROOT / "zilch-manifest-en.webmanifest").exists()
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "COPY manifest-en.webmanifest /app/manifest-en.webmanifest" in dockerfile
    assert "COPY zilch-manifest-en.webmanifest /app/zilch-manifest-en.webmanifest" in dockerfile


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


def test_every_private_zilch_award_and_category_has_de_and_en_message_keys():
    """Keep the private server catalog and browser translations in lockstep."""

    catalog = (ROOT / "frontend" / "i18n" / "catalog.js").read_text(encoding="utf-8")
    keys = [
        *(f"zilch.achievement.category.{category}" for category in ZILCH_ACHIEVEMENT_CATEGORIES),
        *(
            key
            for achievement in ZILCH_ACHIEVEMENTS
            for key in (achievement.title_key, achievement.description_key)
        ),
    ]
    # The structured German and English message maps each contain every key.
    # Count the literal key rather than a translated value: German/English
    # wording may legitimately share a term such as "CPU" or "Solo".
    missing = [key for key in keys if catalog.count(f'"{key}":') < 2]
    assert not missing, missing


def test_achievement_points_are_visible_catalog_data_and_logically_ordered():
    assert ACHIEVEMENTS
    assert all(1 <= achievement.points <= 10 for achievement in ACHIEVEMENTS)
    ordered_keys = [achievement.key for achievement in sorted(ACHIEVEMENTS, key=achievement_sort_key)]
    assert ordered_keys.index("five_ones_written") < ordered_keys.index("five_twos_written")
    assert ordered_keys.index("five_fives_written") < ordered_keys.index("six_thirty")
    assert ordered_keys.index("exact_game_score_555") < ordered_keys.index("exact_game_score_1555")
    assert ordered_keys.index("top_section_exact_60") < ordered_keys.index("top_section_all_exact_60")
    assert ordered_keys.index("top_section_all_exact_60") < ordered_keys.index("top_section_81_without_bonus")
    assert ordered_keys.index("office_hours") < ordered_keys.index("office_hours_10")
    assert ordered_keys.index("office_hours_10") < ordered_keys.index("office_hours_25") < ordered_keys.index("office_hours_50")
    assert ordered_keys.index("multiplayer_2p_margin_100") < ordered_keys.index("multiplayer_2p_margin_200")
    assert ordered_keys.index("multiplayer_2p_margin_200") < ordered_keys.index("multiplayer_2p_margin_350")
    assert ordered_keys.index("multiplayer_3p_runner_up_margin_100") < ordered_keys.index(
        "multiplayer_3p_last_margin_100"
    )
    assert ordered_keys.index("multiplayer_3p_last_margin_100") < ordered_keys.index("multiplayer_2v2_margin_100")


def test_achievement_rank_tiers_follow_the_public_point_distribution():
    assert ACHIEVEMENT_POINTS_POSSIBLE == 549
    assert achievement_rank_for_points(0)["title"] == "Newbie"
    assert achievement_rank_for_points(13)["title"] == "Rookie"
    assert achievement_rank_for_points(43)["title"] == "Spieler"
    assert achievement_rank_for_points(147)["title"] == "Pro"
    assert achievement_rank_for_points(280)["title"] == "Meister"
    assert achievement_rank_for_points(457)["title"] == "Legende"
    godmode = achievement_rank_for_points(524)
    assert godmode["title"] == "Godmode"
    assert godmode["stars"] == 5
    assert godmode["points_possible"] == ACHIEVEMENT_POINTS_POSSIBLE


def test_ehrenberg_marks_and_unlocked_dates_are_localized_in_achievement_views():
    catalog = (ROOT / "frontend" / "i18n" / "catalog.js").read_text(encoding="utf-8")
    assert '"Ehrenberg-Marken": "Ehrenberg Marks"' in catalog
    assert '"Erreicht am": "Unlocked on"' in catalog
    for filename in ("account.html", "profile.html"):
        source = (STATIC / filename).read_text(encoding="utf-8")
        assert "Ehrenberg-Marken" in source
        assert "Erreicht am" in source
        assert "unlocked_at" in source
        assert "Erfolgspunkte" not in source


def test_rank_upgrade_completion_is_localized_and_documented():
    catalog = (ROOT / "frontend" / "i18n" / "catalog.js").read_text(encoding="utf-8")
    rules = (STATIC / "rules.html").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")

    assert '"LEVEL UP! ✨": "LEVEL UP! ✨"' in catalog
    assert '"Neuer Rang erreicht!": "New rank unlocked!"' in catalog
    assert "mehrere Erfolge, wird jeder einzeln gezeigt und bestätigt" in rules
    assert "LEVEL UP!" in readme


def test_zilch_rank_upgrade_card_is_localized_and_documented():
    catalog = (ROOT / "frontend" / "i18n" / "catalog.js").read_text(encoding="utf-8")
    rules = (ROOT / "docs" / "ZILCH_RULES.md").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")

    assert '"RANGAUFSTIEG! ✨": "RANK UP! ✨"' in catalog
    assert '"Neuer Zilch-Rang erreicht!": "New Zilch rank unlocked!"' in catalog
    assert "pompös animierte Rang-Karte" in rules
    assert "retrospective delivery" in readme
