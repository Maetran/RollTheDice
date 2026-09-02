"""
rules.py - Serverseitige Summenberechnung
-----------------------------------------

Dieses Modul berechnet die abgeleiteten Spaltensummen aus bereits geschriebenen
Scoreboard-Werten. Die Bewertung eines einzelnen Wurfs passiert im aktiven
WebSocket-Pfad in `app/main.py`.
"""

from __future__ import annotations

from typing import Dict


def compute_row_subtotals(row: Dict[str, int], *, hardcore: bool = False) -> Dict[str, int]:
    """Berechnet die automatisch angezeigten Summen einer Spalte.

    Erwartet ein Dict der 12 Wertungsfelder einer Spalte; fehlende Felder
    werden als 0 behandelt.

    Rückgabe-Keys:
    - sum_top: Summe 1..6
    - bonus_top: 30 bei sum_top >= 60, im Hardcore ab >= 40
    - total_top: sum_top + bonus_top
    - sum_maxmin: Feld "1" * (max - min), nie unter 0
    - sum_bottom: Summe von kenter + full + poker + 60
    - total_column: total_top + sum_maxmin + sum_bottom
    """

    def g(key: str) -> int:
        return int(row.get(key, 0))

    sum_top = sum(g(str(i)) for i in range(1, 7))
    threshold = 40 if hardcore else 60
    bonus_top = 30 if sum_top >= threshold else 0
    total_top = sum_top + bonus_top

    if all(key in row for key in ("1", "max", "min")):
        sum_maxmin = max(0, g("1") * (g("max") - g("min")))
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


def compute_overall(scoresheet: Dict[int, Dict[str, int]], *, hardcore: bool = False) -> Dict[str, Dict[str, int]]:
    """Berechnet alle Spaltensummen und das Gesamttotal eines Boards.

    Parameter:
    - scoresheet: Mapping {1: down, 2: free, 3: up, 4: ang}

    Rückgabe:
    - Dict mit Subtotals je Spalte (row1..row4) und `overall.overall_total`
    """
    result: Dict[str, Dict[str, int]] = {}
    overall_total = 0
    for idx in (1, 2, 3, 4):
        row = scoresheet.get(idx, {}) or {}
        subtot = compute_row_subtotals(row, hardcore=hardcore)
        result[f"row{idx}"] = subtot
        overall_total += subtot["total_column"]
    result["overall"] = {"overall_total": overall_total}
    return result
