"""
models.py – Legacy Datenmodell (nicht der aktive Serverpfad)
-----------------------------------------------------------

Dieses Modul enthält eine frühere, objektorientierte Implementierung von Spiel,
Spielern und Score-Sheets. Der aktuelle FastAPI-Server nutzt hingegen eine
dict-basierte State-Struktur in `app/main.py`.

Warum behalten?
- Referenz für Regeln/Validierungen in OO-Form
- Hilfreich, um Datenstrukturen und Spielfluss nachvollziehen zu können

Korrektur-bezogene Felder (historisch):
- `last_write`: Meta zum letzten Eintrag pro Spieler
- `correction_active`, `correction_player`, `correction_dice`,
  `correction_rows_before`: Zustandsfelder für einen Korrekturvorgang

Hinweis: Die produktive Poker/Korrektur-Validierung erfolgt in `app/main.py`
im WebSocket-Handler und wurde dort mit Roll-Tracking (first 4-of-a-kind) ergänzt.
"""
# models.py
from typing import Dict, Optional, Tuple, List
import random
from rules import score_field, compute_overall  # <- absoluter Import (rules.py liegt im selben Ordner)

MODE_EXPECTED = {"2": 2, "3": 3, "2v2": 4}
FIELD_KEYS = ["1","2","3","4","5","6","max","min","kenter","full","poker","60"]

def _has_four_kind(dice: Tuple[int, int, int, int, int]) -> bool:
    """Hilfsfunktion: Prüft, ob ein Vierling im Wurf enthalten ist."""
    counts: Dict[int,int] = {}
    for d in dice:
        counts[d] = counts.get(d, 0) + 1
    return 4 in counts.values()

class Player:
    def __init__(self, pid: str, name: str, ws=None):
        self.id = pid
        self.name = name
        self.ws = ws
        self.row1: Dict[str,int] = {}
        self.row2: Dict[str,int] = {}
        self.row3: Dict[str,int] = {}
        self.row4: Dict[str,int] = {}

    def row_by_idx(self, idx:int) -> Dict[str,int]:
        """Liefert die Reihe (1..4) dieses Spielers als Dict der Felder."""
        return {1:self.row1,2:self.row2,3:self.row3,4:self.row4}[idx]

class Game:
    def __init__(self, game_id: str, mode: str = "2", name: str = ""):
        self.id = game_id
        self.mode = mode if mode in MODE_EXPECTED else "2"
        self.name = name or f"{self.mode.upper()}P"
        self.players: Dict[str, Player] = {}
        self.scores: Dict[str, Player] = {}
        self.turn_order: List[str] = []
        self.turn_index = 0
        self.started = False
        self.finished = False

        # Zugzustand
        self.current_dice = [0,0,0,0,0]
        self.holds = [False, False, False, False, False]
        self.max_rolls_per_turn = 3
        self.rolls_used = 0
        self.announced_row4: Optional[str] = None

        # Letzter Eintrag (für Korrektur)
        # last_write[pid] = {
        #   "row": int, "field": str, "score": int, "dice": [..],
        #   "announced_row4": Optional[str]
        # }
        self.last_write: Dict[str, dict] = {}

        # Korrekturmodus
        self.correction_active: bool = False
               self.correction_player: Optional[str] = None
        self.correction_dice: Optional[List[int]] = None
        # Snapshot der Player-rows VOR dem ursprünglichen Schreibvorgang
        self.correction_rows_before: Optional[Dict[str, Dict[str,int]]] = None

    # ---- helpers / meta
    @property
    def expected_players(self) -> int:
        """Erwartete Spieleranzahl anhand des Modus (2, 3, 2v2→4)."""
        return MODE_EXPECTED.get(self.mode, 2)

    def _is_turn_of(self, pid: str) -> bool:
        """True, wenn aktuell dieser Spieler am Zug ist."""
        return bool(self.turn_order) and self.turn_order[self.turn_index] == pid

    def can_join(self) -> bool:
        """True, wenn das Spiel noch nicht gestartet und noch Platz ist."""
        return (not self.started) and (len(self.players) < self.expected_players)

    # ---- players
    def add_player(self, pid: str, name: str, ws) -> bool:
        """Fügt einen Spieler hinzu; startet das Spiel, sobald voll."""
        if not self.can_join():
            return False
        p = Player(pid, name, ws)
        self.players[pid] = p
        self.scores[pid] = p
        self.turn_order.append(pid)
        if len(self.players) >= self.expected_players:
            self._start_game()
        return True

    def reconnect_player(self, pid: str, ws):
        """Setzt die WebSocket-Referenz neu (Rejoin)."""
        if pid in self.players:
            self.players[pid].ws = ws

    def disconnect_player(self, pid: str):
        """Entkoppelt die WebSocket-Referenz (Verbindung getrennt)."""
        if pid in self.players:
            self.players[pid].ws = None

    # ---- lifecycle
    def _start_game(self):
        """Initialisiert den Spielzustand und startet das Spiel."""
        if self.started:
            return
        self.started = True
        self.finished = False
        self.turn_index = 0
        self.rolls_used = 0
        self.current_dice = [0,0,0,0,0]
        self.holds = [False]*5
        self.announced_row4 = None
        self.correction_active = False
        self.correction_player = None
        self.correction_dice = None
        self.correction_rows_before = None

    # ---- finish helpers
    def _row_full(self, row: Dict[str,int]) -> bool:
        """True, wenn alle 12 Wertungsfelder in dieser Reihe befüllt sind."""
        return sum(1 for k in FIELD_KEYS if k in row) == len(FIELD_KEYS)

    def _player_sheet_full(self, p: Player) -> bool:
        """True, wenn alle vier Reihen des Spielers voll sind."""
        return self._row_full(p.row1) and self._row_full(p.row2) and self._row_full(p.row3) and self._row_full(p.row4)

    def _game_finished(self) -> bool:
        """True, wenn alle Spielerblätter vollständig sind (Spielende)."""
        if not self.players:
            return False
        return all(self._player_sheet_full(p) for p in self.players.values())

    # ---- actions (nur erlaubt, wenn keine Korrektur läuft)
    def set_hold(self, pid: str, holds: List[bool]):
        """Setzt Hold-Flags für die fünf Würfel (nur eigener Zug)."""
        if not self.started or not self._is_turn_of(pid) or self.finished or self.correction_active:
            return
        if len(holds) != 5:
            return
        self.holds = [bool(x) for x in holds]

    def roll_dice(self, pid: str):
        """Würfelt für alle nicht gehaltenen Würfel (max. 3 pro Zug)."""
        if not self.started or not self._is_turn_of(pid) or self.finished or self.correction_active:
            return
        if self.rolls_used >= self.max_rolls_per_turn:
            return
        for i in range(5):
            if not self.holds[i]:
                self.current_dice[i] = random.randint(1,6)
        self.rolls_used += 1

    def announce_row4(self, pid: str, field: str):
        """Setzt die Ansage für Reihe 4, nur direkt nach Wurf 1 erlaubt."""
        if not self.started or not self._is_turn_of(pid) or self.finished or self.correction_active:
            return
        if self.rolls_used != 1:
            return
        if field not in FIELD_KEYS:
            return
        self.announced_row4 = field

    # ---- reihen-regeln
    def _allowed_row1(self, row: Dict[str,int], field:str) -> bool:
        """Reihe 1: strikt von oben nach unten (erstes noch freies Feld)."""
        for k in FIELD_KEYS:
            if k not in row:
                return k == field
        return False

    def _allowed_row2(self, row: Dict[str,int], field:str) -> bool:
        """Reihe 2: freie Wahl (jedes noch freie Feld erlaubt)."""
        return field not in row

    def _allowed_row3(self, row: Dict[str,int], field:str) -> bool:
        """Reihe 3: strikt von unten nach oben (letztes noch freies Feld)."""
        for k in reversed(FIELD_KEYS):
            if k not in row:
                return k == field
        return False

    def _allowed_row4(self, row: Dict[str,int], field:str) -> bool:
        """Reihe 4 (❗): nur das angesagte Feld und nur, wenn es dort noch frei ist."""
        return (self.announced_row4 == field) and (field not in row)

    # Ansage exklusiv erst ab Wurf 2; Wurf 1 erlaubt überall + implizite Ansage bei Reihe 4
    def _validate(self, player: Player, row_idx: int, field: str) -> bool:
        """Validiert einen geplanten Eintrag gegen Reihen-/Ansageregeln."""
        if field not in FIELD_KEYS or self.finished:
            return False

        if self.announced_row4 and self.rolls_used >= 2:
            if row_idx != 4 or field != self.announced_row4:
                return False

        row = player.row_by_idx(row_idx)

        if row_idx == 4:
            if self.rolls_used == 1 and self.announced_row4 is None:
                return field not in row
            return self._allowed_row4(row, field)

        if row_idx == 1:
            return self._allowed_row1(row, field)
        if row_idx == 2:
            return self._allowed_row2(row, field)
        if row_idx == 3:
            return self._allowed_row3(row, field)
        return False

    def write_field(self, pid: str, row_idx:int, field:str, strike:bool):
        """Schreibt einen Wert (oder 0 bei strike) in die angegebene Zelle.

        Speichert einen Snapshot des vorherigen Zustands für eine mögliche Korrektur.
        """
        if not self.started or not self._is_turn_of(pid) or self.finished or self.correction_active:
            return
        if self.rolls_used <= 0:
            return

        player = self.players[pid]
        if not self._validate(player, row_idx, field):
            return

        # Implizite Ansage bei Wurf 1, Reihe 4
        if row_idx == 4 and self.rolls_used == 1 and self.announced_row4 is None:
            self.announced_row4 = field

        dice_tuple = tuple(self.current_dice)
        poker_now = _has_four_kind(dice_tuple)

        # Vorher-Snapshot für pot. Korrektur speichern
        rows_before = {
            1: dict(player.row1), 2: dict(player.row2),
            3: dict(player.row3), 4: dict(player.row4)
        }

        dest = player.row_by_idx(row_idx)
        new_score = 0 if strike else score_field(field, dice_tuple, poker_allowed=poker_now)
        dest[field] = new_score

        # Letzten Eintrag speichern (zum Korrigieren)
        self.last_write[pid] = {
            "row": row_idx,
            "field": field,
            "score": new_score,
            "dice": list(self.current_dice),
            "announced_row4": self.announced_row4
        }

        self._end_turn()

        if self._game_finished():
            self.started = False
            self.finished = True

    # ---- Korrekturmodus
    def can_request_correction(self, pid: str) -> bool:
        """True, wenn der Spieler seinen letzten Eintrag korrigieren darf."""
        lw = self.last_write.get(pid)
        if not lw:
            return False
        # keine Korrektur, wenn der Eintrag mit Ansage-Zwang entstand
        if lw.get("announced_row4"):
            return False
        # Korrektur ist grundsätzlich erlaubt, blockiert aber temporär andere Aktionen
        return True

    def start_correction(self, pid: str) -> bool:
        """Startet den Korrekturmodus und stellt die Würfel des letzten Eintrags bereit."""
        if not self.can_request_correction(pid):
            return False
        lw = self.last_write[pid]
        self.correction_active = True
        self.correction_player = pid
        self.correction_dice = list(lw["dice"])
        # Keine globale Rückabwicklung nötig – wir erlauben Überschreiben woanders,
        # und löschen den alten Eintrag beim Commit.
        return True

    def cancel_correction(self):
        """Beendet den Korrekturmodus und räumt Korrekturzustand auf."""
        self.correction_active = False
        self.correction_player = None
        self.correction_dice = None

    def write_field_correction(self, pid: str, row_idx:int, field:str, strike:bool):
        """Schreibt im Korrekturmodus den letzten Eintrag neu (ggf. anderes Feld)."""
        # Nur der Anforderer, nur im Korrekturmodus
        if not self.correction_active or self.correction_player != pid:
            return
        lw = self.last_write.get(pid)
        if not lw:
            self.cancel_correction()
            return

        player = self.players[pid]

        # Regeln weiterhin prüfen (ohne Ansage-Zwang): simuliere Wurf 1, keine Ansage
        saved_rolls = self.rolls_used
        saved_ann = self.announced_row4
        self.rolls_used = 1
        self.announced_row4 = None

        def _restore():
            self.rolls_used = saved_rolls
            self.announced_row4 = saved_ann

        if field not in FIELD_KEYS:
            _restore(); return

        row = player.row_by_idx(row_idx)
        allowed = False
        if row_idx == 1:
            allowed = self._allowed_row1(row, field)
        elif row_idx == 2:
            allowed = self._allowed_row2(row, field)
        elif row_idx == 3:
            allowed = self._allowed_row3(row, field)
        elif row_idx == 4:
            allowed = (field not in row)  # Ansage spielt hier keine Rolle; Korrektur ist Sonderfall

        _restore()
        if not allowed:
            return

        # alten Eintrag entfernen
        old_row_idx = lw["row"]
        old_field = lw["field"]
        old_dest = player.row_by_idx(old_row_idx)
        if old_field in old_dest:
            del old_dest[old_field]

        # neuen Score aus gespeicherten Würfeln berechnen
        dice_tuple = tuple(self.correction_dice or lw["dice"])
        poker_now = _has_four_kind(dice_tuple)
        dest = player.row_by_idx(row_idx)
        new_score = 0 if strike else score_field(field, dice_tuple, poker_allowed=poker_now)
        dest[field] = new_score

        # last_write updaten
        self.last_write[pid] = {
            "row": row_idx,
            "field": field,
            "score": new_score,
            "dice": list(dice_tuple),
            "announced_row4": None
        }

        # Korrektur beenden
        self.cancel_correction()

    # ---- intern
    def _end_turn(self):
        """Beendet den Zug: Reset von Rolls/Holds/Dice, nächster Spieler."""
        self.rolls_used = 0
        self.holds = [False]*5
        self.current_dice = [0,0,0,0,0]
        self.announced_row4 = None
        if self.turn_order:
            self.turn_index = (self.turn_index + 1) % len(self.turn_order)

    # ---- snapshot
    def scoreboard_snapshot(self) -> dict:
        """Erzeugt einen UI-nahen Snapshot mit Reihen/Subtotals und Zugstatus."""
        out: Dict[str,dict] = {}
        for pid, sheet in self.scores.items():
            rows = {1: sheet.row1, 2: sheet.row2, 3: sheet.row3, 4: sheet.row4}
            subtotals = compute_overall(rows)
            out[pid] = {"player": self.players[pid].name, "rows": rows, "subtotals": subtotals}
        cur = self.turn_order[self.turn_index] if self.turn_order else None
        out["_turn"] = {"player_id": cur, "player_name": self.players[cur].name if cur in self.players else None}
        out["_dice"] = self.current_dice
        out["_holds"] = self.holds
        out["_rolls_used"] = self.rolls_used
        out["_rolls_max"] = self.max_rolls_per_turn
        out["_mode"] = self.mode
        out["_expected"] = self.expected_players
        out["_players_joined"] = len(self.players)
        out["_started"] = self.started
        out["_finished"] = self.finished
        out["_name"] = self.name
        out["_players"] = [{"id": p.id, "name": p.name} for p in self.players.values()]
        out["_announced_row4"] = self.announced_row4

        if self.finished:
            results: List[Dict[str,int]] = []
            for pid2, entry in out.items():
                if isinstance(pid2, str) and pid2.startswith("_"):
                    continue
                total = entry["subtotals"]["overall"]["overall_total"]
                results.append({"player": out[pid2]["player"], "total": int(total)})
            results.sort(key=lambda x: x["total"], reverse=True)
            out["_results"] = results

        # Korrekturstatus anhängen
        if self.correction_active and self.correction_player:
            out["_correction"] = {
                "active": True,
                "player_id": self.correction_player,
                "dice": list(self.correction_dice or []),
            }
        else:
            out["_correction"] = {"active": False}

        return out

    async def broadcast(self):
        data = {"scoreboard": self.scoreboard_snapshot()}
        for p in self.players.values():
            if p.ws:
                await p.ws.send_json(data)


# Public Registry
Games: Dict[str, Game] = {}