"""Owner-only ZDWA design preview: audience, kill switch and field previews."""

import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app import game_engine
from app.design_preview import ZDWA_DESIGN_PREVIEW_ENV, design_preview_payload
from tests.support import GameStateTestCase


def identity(*, is_owner: bool):
    # Only the ownership flag decides; the full session identity is not needed.
    return SimpleNamespace(user_id=7, username="Mani", role="admin" if is_owner else "user", is_owner=is_owner)


class DesignPreviewAudienceTests(unittest.TestCase):
    def test_only_owners_receive_the_preview(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop(ZDWA_DESIGN_PREVIEW_ENV, None)
            self.assertEqual(design_preview_payload(identity(is_owner=True)), {"zdwa_2026": True})
            self.assertEqual(design_preview_payload(identity(is_owner=False)), {"zdwa_2026": False})
            self.assertEqual(design_preview_payload(None), {"zdwa_2026": False})

    def test_kill_switch_and_unknown_values_disable_the_preview(self):
        for value in ("off", "OFF", "everyone", "public", ""):
            with self.subTest(value=value), patch.dict(os.environ, {ZDWA_DESIGN_PREVIEW_ENV: value}):
                self.assertEqual(design_preview_payload(identity(is_owner=True)), {"zdwa_2026": False})


class FieldPreviewTests(GameStateTestCase):
    def previews(self, g):
        return {(p["row"], p["col"]): p["points"] for p in game_engine.compute_field_previews(g)}

    def test_no_previews_before_the_first_roll(self):
        g = self.make_game()
        self.assertEqual(game_engine.compute_field_previews(g), [])

    def test_previews_follow_column_order_and_scoring(self):
        g = self.make_game()
        g["_rolls_used"] = 1
        g["_turn"]["roll_index"] = 1
        g["_dice"] = [5, 5, 5, 2, 2]

        previews = self.previews(g)

        # Abwärts starts at 1, Aufwärts at 60, Frei and the first-roll ❗ are open.
        self.assertEqual(previews[(0, "down")], 0)
        self.assertNotIn((1, "down"), previews)
        self.assertEqual(previews[(15, "up")], 0)
        self.assertNotIn((14, "up"), previews)
        self.assertEqual(previews[(4, "free")], 15)
        self.assertEqual(previews[(13, "free")], 55)
        self.assertEqual(previews[(13, "ang")], 55)

    def test_active_announcement_limits_previews_to_the_announced_field(self):
        g = self.make_game()
        g["_rolls_used"] = 2
        g["_turn"]["roll_index"] = 2
        g["_dice"] = [1, 2, 3, 4, 6]
        g["_announced_row4"] = "kenter"

        previews = self.previews(g)

        self.assertEqual(previews.get((12, "ang")), 35)
        self.assertNotIn((12, "free"), previews)

    def test_late_poker_without_announcement_previews_zero(self):
        g = self.make_game()
        g["_rolls_used"] = 2
        g["_dice"] = [4, 4, 4, 4, 2]
        g["_turn"]["roll_index"] = 2
        g["_turn"]["first4oak_roll"] = 1

        self.assertEqual(self.previews(g)[(14, "free")], 0)

    def test_filled_cells_are_never_previewed(self):
        g = self.make_game()
        g["_rolls_used"] = 1
        g["_turn"]["roll_index"] = 1
        g["_dice"] = [6, 6, 6, 6, 6]
        g["_scoreboards"]["p1"]["15,free"] = 90

        self.assertNotIn((15, "free"), self.previews(g))


if __name__ == "__main__":
    unittest.main()
