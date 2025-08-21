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
    return sum(dice)

def _counts(dice: Tuple[int, int, int, int, int]) -> Dict[int, int]:
    c: Dict[int, int] = {}
    for d in dice:
        c[d] = c.get(d, 0) + 1
    return c


def score_field(field_name: str, dice: Tuple[int, int, int, int, int], *, poker_allowed: bool) -> int:
    """Berechnet die Punkte fuer genau EIN Feld gemaess der Spielregeln.
    - Die Logik ist streng serverseitig. Der Client gibt nur die Intent (Feld) an.
    - poker_allowed entspricht der Sequenz‑Sperrregel: Vierling muss sofort geschrieben werden,
      sonst in dieser Sequenz gesperrt – ausser es faellt spaeter erneut ein Vierling.
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
        # Full House (3+2) ODER 5 gleiche
        most_face = Counter(dice).most_common(1)[0][0]
        if len(cnt.keys()) == 2:
            # 3+2 erlaubt, 4+1 NICHT
            if 4 not in cnt.values():
                return 40 + 3 * most_face
            return 0
        elif 5 in cnt.values():
            return 40 + 3 * most_face
        return 0

    if field_name == "poker":
        # Vierling: 50 + (Augensumme des Vierlings) = 50 + 4 * wert
        # Nur gueltig, wenn poker_allowed True (Sperrlogik der Sequenz)
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
# Zwischensummen pro Reihe (on the fly)
# -----------------------------

def compute_row_subtotals(row: Dict[str, int]) -> Dict[str, int]:
    """Berechnet alle Zwischensummen fuer EINE Reihe (12 Felder). Fehlende Felder = 0.
    Rueckgabe enthaelt Keys:
      - sum_top: Summe(1..6)
      - bonus_top: 30 wenn sum_top >= 60, sonst 0
      - total_top: sum_top + bonus_top
      - sum_maxmin: falls "1","max","min" vorhanden: row["1"] * (row["max"] - row["min"]) sonst 0
      - sum_bottom: Summe(kenter, full, poker, 60)
      - total_column: total_top + sum_maxmin + sum_bottom
    """
    def g(key: str) -> int:
        return int(row.get(key, 0))

    sum_top = sum(g(str(i)) for i in range(1, 7))
    bonus_top = 30 if sum_top >= 60 else 0
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

def compute_overall(scoresheet: Dict[int, Dict[str, int]]) -> Dict[str, Dict[str, int]]:
    """scoresheet muss ein Dict {1: row1, 2: row2, 3: row3, 4: row4} sein.
    Liefert pro Reihe die Subtotale und zusaetzlich overall_total (Summe der 4 total_column).
    """
    result: Dict[str, Dict[str, int]] = {}
    overall_total = 0
    for idx in (1,2,3,4):
        row = scoresheet.get(idx, {}) or {}
        subtot = compute_row_subtotals(row)
        result[f"row{idx}"] = subtot
        overall_total += subtot["total_column"]
    result["overall"] = {"overall_total": overall_total}
    return result
