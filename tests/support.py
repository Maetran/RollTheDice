import unittest

from app import game_state


class GameStateTestCase(unittest.TestCase):
    def setUp(self):
        self.gids = []

    def tearDown(self):
        for gid in self.gids:
            game_state.games.pop(gid, None)

    def make_game(self, *, mode=2, hardcore=False, players=None, name="Test Game"):
        gid = f"{self.__class__.__name__}-{len(self.gids)}"
        self.gids.append(gid)
        g = game_state.new_game(gid, name, mode)

        if players is None:
            expected = 4 if str(mode).lower() == "2v2" else int(g["_expected"])
            players = [(f"p{i}", f"Player {i}") for i in range(1, expected + 1)]

        g["_players"] = [{"id": pid, "name": pname, "ws": None} for pid, pname in players]
        g["_scoreboards"] = {pid: {} for pid, _pname in players}
        g["_hardcore"] = hardcore
        g["_started"] = True
        g["_finished"] = False
        g["_aborted"] = False
        g["_turn"] = {"player_id": players[0][0], "roll_index": 0, "first4oak_roll": None}
        g["_correction"] = {"active": False}
        g["_dice"] = [0, 0, 0, 0, 0]
        g["_holds"] = [False] * 5
        g["_rolls_used"] = 0
        g["_rolls_max"] = 3
        g["_announced_row4"] = None
        g["_announced_by"] = None
        g["_announced_board"] = None
        g["_last_write"] = {}
        g["_last_dice"] = {}
        g["_last_meta"] = {}

        if game_state.is_team_mode(g):
            ids = [pid for pid, _pname in players]
            g["_teams"] = {
                "A": {"name": "Team A", "members": ids[0::2]},
                "B": {"name": "Team B", "members": ids[1::2]},
            }
            g["_team_of"] = {pid: ("A" if idx % 2 == 0 else "B") for idx, pid in enumerate(ids)}
            g["_scoreboards_by_team"] = {"A": {}, "B": {}}

        return g

    @staticmethod
    def full_scoreboard(columns=None, *, default=0):
        columns = columns or {}
        board = {}
        for col in game_state.WRITABLE_COLS:
            values = columns.get(col, {}) or {}
            for row in game_state.WRITABLE_ROWS:
                field = game_state.WRITABLE_MAP[row]
                board[f"{row},{col}"] = int(values.get(field, default))
        return board

    def high_scoreboard(self):
        return self.full_scoreboard(
            {
                "down": {
                    "1": 3,
                    "2": 6,
                    "3": 9,
                    "4": 12,
                    "5": 15,
                    "6": 18,
                    "max": 28,
                    "min": 8,
                    "kenter": 35,
                    "full": 58,
                    "poker": 74,
                    "60": 90,
                }
            }
        )

    def low_scoreboard(self):
        return self.full_scoreboard(
            {
                "down": {
                    "1": 1,
                    "2": 2,
                    "3": 3,
                    "4": 4,
                    "5": 5,
                    "6": 6,
                    "max": 15,
                    "min": 10,
                    "kenter": 35,
                    "full": 46,
                    "poker": 66,
                    "60": 80,
                }
            }
        )
