"""
rules.py – Serverseitige Punkterechner
--------------------------------------

Dieses Modul kapselt die reine Punkteberechnung für die Felder
("1".."6", "max", "min", "kenter", "full", "poker", "60") sowie
Hilfsfunktionen für Spaltensummen und Gesamtsummen.

Entscheidende Aspekte:
- Die Logik ist serverseitig autoritativ; der Client zeigt lediglich Vorschauen an.
- `score_field(..., poker_allowed=...)` implementiert bewusst die Regel, dass
  ein Vierling nur dann als "poker" gewertet werden darf, wenn das Aufschreiben
  in der zugelassenen Situation erfolgt (wird außerhalb dieses Moduls geprüft).
  Bei `poker_allowed=False` liefert das Feld 0 Punkte, selbst bei Vierling.
- Ein Fünfling wird separat über das Feld "60" gewertet.
"""

from __future__ import annotations
from typing import Dict, Tuple
from collections import Counter

ROW_FIELDS = [
    "1", "2", "3", "4", "5", "6",
    "max", "min", "kenter", "full", "poker", "60",
]

# -----------------------------
# Kern: serverseitige Punkteberechnung
# -----------------------------

def _sum_dice(dice: Tuple[int, int, int, int, int]) -> int:
    """Summe aller fünf Wuerfel zurückgeben.

    Parameter:
    - dice: Tupel mit 5 Augenzahlen (1..6)

    Rückgabe:
    - Integer-Summe der fünf Werte
    """
    return sum(dice)

def _counts(dice: Tuple[int, int, int, int, int]) -> Dict[int, int]:
    """Häufigkeiten der Augenzahlen ermitteln.

    Rückgabe ist ein Dict: { augenzahl -> anzahl }
    Beispiel: (2,2,5,6,6) -> {2:2, 5:1, 6:2}
    """
    c: Dict[int,int] = {}
    for d in dice:
        c[d] = c.get(d, 0) + 1
    return c

def score_field(field_name: str, dice: Tuple[int, int, int, int, int], *, poker_allowed: bool) -> int:
    """Punkteberechnung für genau ein Feld gemäß Spielregeln.

    Parameter:
    - field_name: Name des Feldes ("1".."6","max","min","kenter","full","poker","60")
    - dice: aktueller Wurf als Tupel von fünf Werten (1..6)
    - poker_allowed: Steuert, ob "poker" (Vierling) überhaupt mit Punkten
      gewertet werden darf. Ist dies False, liefert "poker" 0 Punkte selbst bei Vierling.

    Rückgabe:
    - Punktewert für das angegebene Feld (Integer)
    """
    if field_name not in ROW_FIELDS:
        raise ValueError("ungueltiges Feld")

    cnt = _counts(dice)
    total = _sum_dice(dice)

    # 1..6 (Augenzahlen)
    if field_name in {"1","2","3","4","5","6"}:
        face = int(field_name)
        return cnt.get(face, 0) * face

    if field_name == "max":
        return total

    if field_name == "min":
        return total

    if field_name == "kenter":
        # 5 verschiedene Werte
        return 35 if len(cnt.keys()) == 5 else 0

    if field_name == "full":
        # Full House (3+2) oder 5 gleiche
        most_face = Counter(dice).most_common(1)[0][0]
        if len(cnt.keys()) == 2:
            # 3+2 erlaubt, 4+1 nicht
            if 4 not in cnt.values():
                return 40 + 3 * most_face
            return 0
        elif 5 in cnt.values():
            return 40 + 3 * most_face
        return 0

    if field_name == "poker":
        # Vierling: 50 + (Augensumme des Vierlings) = 50 + 4 * wert
        if not poker_allowed:
            return 0
        for face, n in cnt.items():
            if n == 4:
                return 50 + 4 * face
        return 0

    if field_name == "60":
        # Fuenfling: 60 + (Summe) = 60 + 5 * wert
        for face, n in cnt.items():
            if n == 5:
                return 60 + 5 * face
        return 0

    raise ValueError("unbekanntes Feld")

# -----------------------------
# Zwischensummen pro Reihe
# -----------------------------

def compute_row_subtotals(row: Dict[str, int], *, hardcore: bool = False) -> Dict[str, int]:
    """Zwischensummen für eine Spalte (Reihe) berechnen.

    Erwartet ein Dict der 12 Wertungsfelder einer Spalte (z. B. Row 1).
    Fehlende Felder werden als 0 behandelt.

    Rückgabe-Keys:
    - sum_top: Summe 1..6
    - bonus_top: 30 bei sum_top >= THRESHOLD, sonst 0 (THRESHOLD: 60 normal, 40 hardcore)
    - total_top: sum_top + bonus_top
    - sum_maxmin: 1 × (max − min), falls 1/max/min vorhanden
    - sum_bottom: Summe von kenter + full + poker + 60
    - total_column: total_top + sum_maxmin + sum_bottom
    """
    def g(key: str) -> int:
        return int(row.get(key, 0))

    sum_top = sum(g(str(i)) for i in range(1, 7))
    threshold = 40 if hardcore else 60
    bonus_top = 30 if sum_top >= threshold else 0
    total_top = sum_top + bonus_top

    if all(key in row for key in ("1","max","min")):
        sum_maxmin = g("1") * (g("max") - g("min"))
    else:
        sum_maxmin = 0

    sum_bottom = g("kenter") + g("full") + g("poker") + g("60")
    total_column = total_top + sum_maxmin + sum_bottom

    return {
        "sum_top": sum_top,
        "bonus_top": bonus_top,
        "total_top": total_top,
        "sum_maxmin": sum_maxmin,
        "sum_bottom": sum_bottom,
        "total_column": total_column,
    }

# -----------------------------
# Gesamtzusammenzug fuer 4 Reihen
# -----------------------------

def compute_overall(scoresheet: Dict[int, Dict[str, int]], *, hardcore: bool = False) -> Dict[str, Dict[str, int]]:
    """Gesamtsummen für alle vier Reihen berechnen.

    Parameter:
    - scoresheet: Mapping {1: row1, 2: row2, 3: row3, 4: row4}

    Rückgabe:
    - Dict mit Subtotals je Reihe (row1..row4) und "overall": {overall_total}
    """
    result: Dict[str, Dict[str, int]] = {}
    overall_total = 0
    for idx in (1,2,3,4):
        row = scoresheet.get(idx, {}) or {}
        subtot = compute_row_subtotals(row, hardcore=hardcore)
        result[f"row{idx}"] = subtot
        overall_total += subtot["total_column"]
    result["overall"] = {"overall_total": overall_total}
    return result