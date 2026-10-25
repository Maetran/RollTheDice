"""Private Hausdepp XP, 138 one-time achievements and the 24-step ironic ladder.

Only validated, completed round membership can mint a credit. Database uniqueness
makes retries and simultaneous account tabs harmless. This service never writes
to the suite's public achievement feed or another game's points.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import selectinload

from .database import database_schema_ready, session_scope
from .game_types import HAUSDEPP_GAME_TYPE
from .hausdepp_departure_store import source_not_withdrawn
from .hausdepp_results import TOURNAMENT_EVENT_ACHIEVEMENTS, validated_hausdepp_membership
from .hausdepp_surprise_collection import SURPRISE_EFFECTS
from .models import (
    CompletedGame,
    GameParticipant,
    HausdeppAchievementUnlock,
    HausdeppPresentationReceipt,
    HausdeppRoundCredit,
    HausdeppWithdrawal,
)
from .security import as_utc

ROUND_POINTS = 10
CPU_ROUND_POINTS = 2
PRESENTATION_SNAPSHOT_LIMIT = 64
WITHDRAWAL_ACHIEVEMENT_ID = "hausdepp_136"


def _unlock_source_allowed():
    return or_(HausdeppAchievementUnlock.achievement_id == WITHDRAWAL_ACHIEVEMENT_ID,
               source_not_withdrawn(HausdeppAchievementUnlock.user_id, HausdeppAchievementUnlock.source_game_id))


def _revision_points(points: int) -> int:
    """Zero-XP grants still advance delivery; historic positive revisions stay stable."""
    return max(points, 1)


def _round_points(credits: list) -> int:
    total = 0
    for credit in credits:
        facts = json.loads(credit.facts_json)
        count = facts.get("cpu_count")
        if type(count) is not int or not 0 <= count <= 5:
            raise ValueError("hausdepp_invalid_credit_cpu_count")
        total += CPU_ROUND_POINTS if count else ROUND_POINTS
    return total


def _score_points(credits: list, unlocks: list) -> int:
    return _round_points(credits) + sum(_ACHIEVEMENTS_BY_ID[unlock.achievement_id]["points"]
                                         for unlock in unlocks if unlock.achievement_id in _ACHIEVEMENTS_BY_ID)


def _presentation_scores(receipt) -> dict[str, int]:
    try:
        raw = receipt.presentation_scores_json or "{}"
        if not isinstance(raw, str) or len(raw) > 8192:
            return {}
        scores = json.loads(raw)
        if (not isinstance(scores, dict) or len(scores) > PRESENTATION_SNAPSHOT_LIMIT
                or any(not key.isascii() or not key.isdecimal() or len(key) > 20
                       or int(key) > 2**63 - 1 or type(value) is not int or not 0 <= value <= 2**63 - 1
                       for key, value in scores.items())):
            return {}
        return scores
    except (TypeError, ValueError):
        return {}

# Original flavour lines, not attributed quotations. Every rank is delivered in
# both languages; scientist names describe a playful ladder, not an IQ ranking.
_RANK_DATA = (
    (0, "Einstein", "Einstein", "Alles ist relativ. Auch dein Kartenglück.", "Everything is relative. Even your luck with cards."),
    (25, "Bohr", "Bohr", "Die Theorie steht. Der Stapel hat andere Pläne.", "The theory is sound. The deck has other plans."),
    (50, "Newton", "Newton", "Ab jetzt geht’s bergab. Ganz nach den Naturgesetzen.", "It’s downhill from here. Just following the laws of nature."),
    (100, "Curie", "Curie", "Du strahlst. Hoffentlich vor Freude.", "You’re glowing. Hopefully with joy."),
    (150, "Galilei", "Galileo", "Und sie dreht sich doch. Die Runde geht weiter.", "And yet it moves. Another round awaits."),
    (225, "Kepler", "Kepler", "Die Karten kreisen. Deine Umlaufbahn führt zum Stammtisch.", "The cards keep orbiting. Your path leads to the table."),
    (300, "Hawking", "Hawking", "Schwarze Löcher? Kennst du. Dort verschwinden deine Zehner.", "Black holes? You know them. That’s where your tens disappear."),
    (400, "Tesla", "Tesla", "Die Spannung steigt. Der Durchblick macht kurz Pause.", "The tension is rising. Your insight is taking a short break."),
    (500, "Da Vinci", "Da Vinci", "Ein kleines Meisterwerk. Mit deutlich weniger Berechnung.", "A little masterpiece. With considerably less calculation."),
    (650, "Archimedes", "Archimedes", "Heureka! Du hast den Weg zum nächsten Kartentisch gefunden.", "Eureka! You’ve found your way to the next card table."),
    (800, "Pythagoras", "Pythagoras", "Vier Gleiche, ein leerer Tisch. Diese Rechnung geht auf.", "Four of a kind, one empty table. That calculation adds up."),
    (1000, "Sokrates", "Socrates", "Du weisst, dass du nicht alles weisst. Ein guter Anfang.", "You know you don’t know everything. A good start."),
    (1200, "Professor", "Professor", "Die Vorlesung fällt aus. Heute wird gezockt.", "The lecture is cancelled. Today we’re taking chances."),
    (1450, "Doktor", "Doctor", "Diagnose: akutes Stammtischfieber.", "Diagnosis: an acute case of card-table fever."),
    (1700, "Schlaumeier", "Smart Aleck", "Ein guter Tipp ist gut. Eine passende Karte wäre besser.", "Good advice is good. A playable card would be better."),
    (2000, "Besserwisser", "Know-it-all", "Du hättest es vorher gewusst. Natürlich.", "You knew that would happen. Of course you did."),
    (2300, "Stammtischgelehrter", "Table Scholar", "Die Theorie sitzt. Jetzt zählt der Stammtisch.", "You’ve mastered the theory. Now it’s the table that counts."),
    (2900, "Halbwisser", "Half an Expert", "Die Hälfte wissen. Den Rest überzeugend vertreten.", "Know half of it. Defend the rest convincingly."),
    (3600, "Bauchspieler", "Gut Player", "Der Kopf hat Feierabend. Der Bauch übernimmt.", "Your brain has clocked off. Your gut is taking over."),
    (4400, "Denkpause", "Brain Break", "Kurz nicht nachgedacht. Schon wieder weitergekommen.", "Stopped thinking for a moment. Somehow still made progress."),
    (5300, "Holzkopf", "Blockhead", "Solides Holz. Beste Voraussetzungen für den Stammtisch.", "Solid wood. An excellent fit for the card table."),
    (6300, "Ochse", "Ox", "Mit ruhiger Kraft Richtung Hausdepp.", "Steady and strong, heading straight for Hausdepp."),
    (7500, "Hirni", "Goofball", "Der Hausdepp ist zum Greifen nah.", "Hausdepp is almost within reach."),
    (9000, "Hausdepp", "Hausdepp", "Geschafft. Mehr Hausdepp geht nicht.", "You made it. Peak Hausdepp achieved."),
)
RANKS = tuple({"id": f"rank_{index:02}", "name": {"de": de, "en": en}, "level": index,
               "threshold": threshold, "quote": {"de": quote_de, "en": quote_en}}
              for index, (threshold, de, en, quote_de, quote_en) in enumerate(_RANK_DATA, 1))

# Number, DE title, EN title, DE condition, EN condition, one-time XP.
_ACHIEVEMENT_DATA = (
    (1, "Stuhl her!", "Pull up a chair!", "Deine erste Runde abschliessen.", "Complete your first round.", 10),
    (2, "Stammtisch gefunden", "Found your table", "25 Runden abschliessen.", "Complete 25 rounds.", 25),
    (3, "Unter vier Augen", "Just the two of us", "Eine Runde zu zweit abschliessen.", "Complete a two-player round.", 10),
    (4, "Dritter im Bunde", "Three’s company", "Eine Runde zu dritt abschliessen.", "Complete a three-player round.", 10),
    (5, "Vier gewinnt hier keiner", "Four, but no winner", "Eine Runde zu viert abschliessen.", "Complete a four-player round.", 10),
    (6, "Fünftes Rad am Stammtisch", "A fifth at the table", "Eine Runde zu fünft abschliessen.", "Complete a five-player round.", 10),
    (7, "Volle Hütte", "Full house", "Eine Runde zu sechst abschliessen.", "Complete a six-player round.", 25),
    (8, "Einmal rundherum", "Every size of table", "Mit jeder Tischgrösse von zwei bis sechs mindestens einmal spielen.", "Complete a round at every table size from two to six.", 50),
    (9, "Blechkamerad", "Tin teammate", "Eine Runde mit einem Computer-Mitspieler abschliessen.", "Complete a round with a computer player.", 10),
    (10, "Handgemacht", "Handmade", "Eine Runde mit mindestens drei Menschen und ohne Computer abschliessen.", "Complete a round with at least three humans and no computers.", 25),
    (11, "Keine künstliche Dummheit", "No artificial foolishness", "Eine Runde mit sechs Menschen abschliessen.", "Complete a round with six humans.", 50),
    (12, "Neue Gesichter", "New faces", "Insgesamt mit fünf verschiedenen menschlichen Mitspielern spielen.", "Play with five different human opponents in completed rounds.", 25),
    (13, "Ich kenn da wen", "I know someone", "Insgesamt mit zehn verschiedenen menschlichen Mitspielern spielen.", "Play with ten different human opponents in completed rounds.", 50),
    (14, "Dich kenn ich doch", "You look familiar", "Zehn Runden mit demselben menschlichen Mitspieler abschliessen.", "Complete ten rounds with the same human opponent.", 25),
    (15, "Inventar", "Part of the furniture", "100 Runden abschliessen.", "Complete 100 rounds.", 50),
    (16, "Der Stuhl bleibt hier", "That chair stays here", "250 Runden abschliessen.", "Complete 250 rounds.", 100),
    (17, "Unten liegt’s", "Right at the bottom", "Beim Abheben unmittelbar eine 10 finden und erhalten.", "Find and receive a ten immediately when cutting the deck.", 25),
    (18, "Mit Anhang", "Plus one", "Beim Abheben ein Ass und die anschliessende 10 erhalten.", "Receive an ace followed by a ten when cutting the deck.", 50),
    (19, "Doppelter Anhang", "Extra baggage", "Beim Abheben mindestens zwei Asse und die anschliessende 10 erhalten.", "Receive at least two aces followed by a ten when cutting the deck.", 100),
    (20, "Viel gesehen, nichts bekommen", "All eyes, empty hands", "Beim Abheben mindestens ein Ass anschauen und anschliessend leer ausgehen.", "See at least one ace while cutting, then receive no cards.", 25),
    (21, "Passt schon", "Just right", "Auf ein vorhandenes Paket genau den oben liegenden Rang zocken.", "Gamble exactly the top rank onto an existing pile.", 25),
    (22, "Hoch gepokert", "High stakes", "Auf ein Ass zocken und mit Ass oder 10 durchkommen.", "Gamble onto an ace and succeed with an ace or ten.", 50),
    (23, "Leerer Tisch, volle Hoffnung", "Empty table, high hopes", "Auf den leeren Tisch zocken.", "Gamble onto an empty table.", 10),
    (24, "Asse im Ärmel", "Aces up your sleeve", "Auf den leeren Tisch zocken, während deine Hand ausschliesslich aus mindestens drei Assen besteht.", "Gamble onto an empty table while holding only aces, at least three of them.", 50),
    (25, "Zehn und weg", "Ten and gone", "Zum ersten Mal mit einer 10 abräumen.", "Clear the pile with a ten for the first time.", 10),
    (26, "Feuer frei", "Fire away", "Eine 10 zocken und damit abräumen.", "Gamble a ten and clear the pile.", 25),
    (27, "Tisch wischen", "Wipe the table", "Mit einer 10 mindestens zehn Karten abräumen, inklusive deiner 10.", "Clear at least ten cards with a ten, including your ten.", 25),
    (28, "Grossreinemachen", "Deep clean", "Mit einer 10 mindestens 16 Karten abräumen.", "Clear at least 16 cards with a ten.", 50),
    (29, "Hausmeister", "Caretaker", "Insgesamt 25-mal mit einer 10 abräumen.", "Clear the pile with a ten 25 times in total.", 25),
    (30, "Noch eine Runde!", "One more go!", "Mit einer 10 abräumen und im anschliessenden eigenen Zug auf den leeren Tisch zocken.", "Clear with a ten, then gamble onto the empty table on your continued turn.", 25),
    (31, "Gute Reserven", "Well stocked", "Zweimal unmittelbar nacheinander mit einer 10 abräumen, ohne fremden Spielzug dazwischen.", "Clear twice in succession with tens, without another player taking a turn.", 50),
    (32, "Zehn Gebote", "Ten commandments", "In einer Runde alle vier Zehner selbst spielen.", "Personally play all four tens in one round.", 100),
    (33, "Vier gewinnt doch", "Four wins after all", "Zum ersten Mal ein Viererpaket vervollständigen.", "Complete a four-of-a-kind clear for the first time.", 25),
    (34, "Alles aus einer Hand", "All from one hand", "Alle vier gleichen Karten selbst legen, gemeinsam oder durch erlaubtes Nachwerfen.", "Play all four cards of one rank yourself, together or through legal follow-ups.", 50),
    (35, "Danke fürs Vorbereiten", "Thanks for setting up", "Die vierte Karte ergänzen, nachdem die ersten drei von Mitspielern gelegt wurden.", "Add the fourth matching card after opponents played the first three.", 25),
    (36, "Gemeinschaftswerk", "A joint effort", "Ein Viererpaket vervollständigen, dessen vier Karten von vier verschiedenen Spielern stammen.", "Complete a four-of-a-kind clear using cards from four different players.", 50),
    (37, "Kleinvieh macht auch frei", "Small cards, big clear", "Mit vier Sechsern abräumen.", "Clear with four sixes.", 50),
    (38, "Adel verpflichtet", "Noblesse oblige", "Mit vier Assen abräumen.", "Clear with four aces.", 50),
    (39, "Lieferung frei Haus", "Special delivery", "Mit einer frisch nachgezogenen und nachgeworfenen Karte das Viererpaket vervollständigen.", "Complete a four-of-a-kind clear with a freshly drawn legal follow-up card.", 50),
    (40, "Blindflug mit Punktlandung", "Blind flight, perfect landing", "Die vierte gleiche Karte zocken und dadurch abräumen.", "Gamble the fourth matching card and clear the pile.", 100),
    (41, "Da war noch was", "One more thing", "Zum ersten Mal gültig nachwerfen.", "Make your first legal follow-up play.", 10),
    (42, "Frisch vom Stapel", "Fresh from the deck", "Eine gerade beim Auffüllen erhaltene Karte nachwerfen.", "Legally follow up with a card just drawn while refilling.", 25),
    (43, "Nachschlag", "Second helping", "Im selben Nachwurffenster zweimal nachwerfen.", "Make two follow-up plays in the same follow-up window.", 25),
    (44, "Lieferkette", "Supply chain", "Auffüllen, nachwerfen, erneut auffüllen und erneut nachwerfen, bevor der nächste Spieler handelt.", "Refill, follow up, refill again and follow up again before the next player acts.", 50),
    (45, "Doppelpack", "Double pack", "Zwei gleiche Karten gemeinsam oder durch erlaubtes Nachwerfen legen.", "Play two matching cards together or through legal follow-ups.", 10),
    (46, "Drilling", "Triple", "Drei gleiche Karten gemeinsam oder durch erlaubtes Nachwerfen legen.", "Play three matching cards together or through legal follow-ups.", 25),
    (47, "Doppelschlag", "Double strike", "Zweimal hintereinander selbst abräumen und dadurch am Zug bleiben.", "Clear twice in succession and keep your turn.", 50),
    (48, "Abräumkommando", "Cleanup crew", "Dreimal hintereinander selbst abräumen und dadurch am Zug bleiben.", "Clear three times in succession and keep your turn.", 100),
    (49, "Leicht verzockt", "Slightly misjudged", "Zum ersten Mal beim Zocken das Paket nehmen müssen.", "Have to take the pile after a failed gamble for the first time.", 10),
    (50, "Heute nicht dein Stapel", "Not your deck today", "In einer Runde zweimal beim Zocken scheitern.", "Fail two gambles in one round.", 25),
    (51, "Freier Fall", "Free fall", "Auf ein Ass eine 6 zocken.", "Gamble a six onto an ace.", 50),
    (52, "Grossbestellung", "Bulk order", "Ein Paket mit mindestens zwölf Karten aufnehmen; eine misslungene Zockkarte zählt mit.", "Take a pile of at least twelve cards, including any failed gamble card.", 25),
    (53, "Sack und Pack", "Bags and baggage", "In einer Runde mindestens 18 Karten gleichzeitig auf der Hand halten.", "Hold at least 18 cards at once in one round.", 50),
    (54, "Das nehme ich noch mit", "I’ll take that too", "Mit der letzten Karte des Nachziehstapels erfolglos zocken und das Paket aufnehmen.", "Fail a gamble with the last stock card and take the pile.", 25),
    (55, "Späte Post", "Late delivery", "Bei bereits leerem Nachziehstapel ein Paket mit mindestens zwölf Karten aufnehmen.", "Take a pile of at least twelve cards when the stock is already empty.", 50),
    (56, "Ehrenamt übernommen", "Volunteered for duty", "Zum ersten Mal Hausdepp einer Runde werden.", "Become the round’s Hausdepp for the first time.", 10),
    (57, "Geschafft!", "Made it!", "Zum ersten Mal bei leerem Nachziehstapel regelgemäss alle Karten loswerden.", "Legally finish all your cards with an empty stock for the first time.", 10),
    (58, "Klein, aber fertig", "Small, but finished", "Mit einer einzelnen 6 als letzter Handkarte fertig werden.", "Finish with a single six as your last card.", 25),
    (59, "Der Zehnte macht das Licht aus", "The tenth turns out the lights", "Mit einer einzelnen 10 als letzter Handkarte fertig werden.", "Finish with a single ten as your last card.", 25),
    (60, "Drilling zum Abschied", "A triple farewell", "Deine letzten drei gleichrangigen Karten gemeinsam oder durch erlaubtes Nachwerfen loswerden.", "Finish your last three matching cards together or through legal follow-ups.", 50),
    (61, "Zehn, dann tschüss", "Ten, then goodbye", "Im Endspiel mit einer 10 abräumen und direkt danach deine restlichen Karten loswerden.", "Clear with a ten in the endgame, then immediately finish your remaining cards.", 50),
    (62, "Ohne Feuerzeug", "No lighter needed", "Fertig werden, ohne in dieser Runde selbst eine 10 gespielt zu haben.", "Finish without personally playing a ten in that round.", 50),
    (63, "Gepäck aufgegeben", "Checked your baggage", "Nach einer Handgrösse von mindestens zwölf Karten trotzdem fertig werden.", "Finish after having held at least twelve cards.", 50),
    (64, "Das war so geplant", "All according to plan", "Nach zwei misslungenen Zockzügen in derselben Runde trotzdem fertig werden.", "Finish after two failed gambles in the same round.", 50),
    (65, "Das war nur der Anlauf", "Just warming up", "Nach mindestens 18 Karten gleichzeitig auf der Hand trotzdem fertig werden.", "Finish after holding at least 18 cards at once.", 25),
    (66, "Ich wollte eh umziehen", "I was moving anyway", "Nach mindestens 24 Karten gleichzeitig auf der Hand trotzdem fertig werden.", "Finish after holding at least 24 cards at once.", 50),
    (67, "Zu früh abgeschrieben", "Written off too soon", "Nach einem aufgenommenen Paket mit mindestens zwölf Karten bei leerem Nachziehstapel trotzdem fertig werden.", "Finish after taking at least twelve cards from the pile with an empty stock.", 25),
    (68, "Grossbestellung retour", "Return the bulk order", "Nach einem aufgenommenen Paket mit mindestens 16 Karten trotzdem fertig werden.", "Finish after taking a pile of at least 16 cards.", 25),
    (69, "Anlauf Nummer vier", "Fourth time lucky", "Nach drei misslungenen Zockzügen in derselben Runde trotzdem fertig werden.", "Finish after three failed gambles in the same round.", 25),
    (70, "Letzte Lieferung retour", "Return the last delivery", "Mit der letzten Nachziehkarte scheitern und das Paket nehmen, aber die Runde trotzdem fertig spielen.", "Fail a gamble with the last stock card and take the pile, then still finish your cards.", 25),
    (71, "War nur ein Testflug", "Just a test flight", "Auf ein Ass eine 6 zocken und in derselben Runde trotzdem fertig werden.", "Gamble a six onto an ace, then still finish your cards in that round.", 25),
    (72, "Von hinten sieht man mehr", "A better view from the back", "Beim Leeren des Nachziehstapels mindestens sechs Handkarten mehr als jeder andere aktive Spieler haben und trotzdem fertig werden.", "When the stock empties, hold at least six more cards than every other active player, then still finish.", 50),
    (73, "Ich sammle nur kurz", "Just collecting for a moment", "Nach drei aufgenommenen Paketen in derselben Runde trotzdem fertig werden.", "Finish after taking the pile three times in the same round.", 25),
    (74, "Rettung ohne Feuerzeug", "Rescue without a lighter", "Nach drei misslungenen Zockzügen fertig werden, ohne in der Runde selbst eine 10 zu spielen.", "Finish after three failed gambles without personally playing a ten in that round.", 50),
    (75, "Alles im Griff. Irgendwann.", "Under control. Eventually.", "Nach mindestens 18 Handkarten fertig werden, ohne in der Runde selbst eine 10 zu spielen.", "Finish after holding at least 18 cards without personally playing a ten in that round.", 50),
    (76, "Und wer lacht jetzt?", "Who’s laughing now?", "Nach mindestens zwölf Handkarten im tatsächlichen letzten Duell fertig werden.", "After holding at least twelve cards, finish in the actual final two-player duel.", 25),
    (77, "Unter Kontrolle", "Under control", "Mit vier Untern abräumen.", "Clear the pile with four Unters.", 10),
    (78, "Oberhand", "The upper hand", "Mit vier Obern abräumen.", "Clear the pile with four Obers.", 10),
    (79, "Königlicher Abgang", "A royal exit", "Mit vier Königen als letzten Handkarten fertig werden.", "Finish with four kings as your last cards.", 50),
    (80, "Vier gewinnt zweimal", "Four wins twice", "In derselben Runde zweimal mit vier Gleichen abräumen.", "Clear with four of a kind twice in the same round.", 25),
    (81, "Sparschwein geöffnet", "Crack open the piggy bank", "Im Endspiel einen eigenen ununterbrochenen Zug mit ausschliesslich mindestens zwei Zehnern beginnen und damit fertig werden.", "In the endgame, start an uninterrupted turn holding only two or more tens and finish with them.", 25),
    (82, "Einmal alles", "One of everything", "In derselben Runde sowohl mit einer 10 als auch mit vier Gleichen abräumen.", "Clear with both a ten and four of a kind in the same round.", 25),
    (83, "Besser als bestellt", "Better than ordered", "Auf einen König zocken und ein Ass oder eine 10 aufdecken.", "Gamble onto a king and reveal an ace or ten.", 10),
    (84, "Kein Umweg", "No detours", "Fertig werden, ohne in der Runde jemals das Paket aufzunehmen.", "Finish without taking the pile at any point in the round.", 25),
    (85, "Turnierluft", "Tournament air", "Dein erstes vollständiges Turnier abschliessen.", "Complete your first full tournament.", 10),
    (86, "Turnier-Stammgast", "Tournament regular", "Drei vollständige Turniere abschliessen.", "Complete three full tournaments.", 25),
    (87, "Serienmensch", "A creature of tournaments", "Zehn vollständige Turniere abschliessen.", "Complete ten full tournaments.", 50),
    (88, "Der Wirt schliesst gleich", "The landlord’s closing soon", "Ein vollständiges Turnier mit mindestens 20 Runden abschliessen.", "Complete a full tournament lasting at least 20 rounds.", 50),
    (89, "Tagesdienst übernommen", "Volunteered for the day", "Zum ersten Mal Tages-Hausdepp eines vollständigen Turniers werden.", "Become the Tages-Hausdepp of a completed tournament for the first time.", 10),
    (90, "Weisse Weste", "A clean sheet", "Ein vollständiges Turnier ohne eine einzige eigene Hausdepp-Runde abschliessen.", "Complete a full tournament without being the round’s Hausdepp once.", 50),
    (91, "Fast makellos", "Almost spotless", "Ein vollständiges Turnier mit genau einer eigenen Hausdepp-Runde abschliessen.", "Complete a full tournament with exactly one round as Hausdepp.", 25),
    (92, "Nur ein P hat gefehlt", "Just one P short", "Ein vollständiges Turnier mit genau sieben eigenen Hausdepp-Runden beenden, während jemand anders Tages-Hausdepp wird.", "Finish a full tournament with exactly seven Hausdepp rounds while someone else becomes Tages-Hausdepp.", 50),
    (93, "Kurve gekriegt", "Turned it around", "Nach mindestens einer eigenen Hausdepp-Runde die letzten beiden Runden eines vollständigen Turniers erfolgreich beenden.", "After being Hausdepp at least once, finish your cards in the last two rounds of a completed tournament.", 25),
    (94, "Fehlstart korrigiert", "False start corrected", "Die erste Turnierrunde als Hausdepp und die letzte mit leeren Händen beenden; das Turnier vollständig abschliessen.", "Be Hausdepp in the first tournament round, finish your cards in the last, and complete the tournament.", 25),
    (95, "Doppelter Fehlstart", "A double false start", "Die ersten beiden Turnierrunden als Hausdepp und die letzten beiden mit leeren Händen beenden; das Turnier vollständig abschliessen.", "Be Hausdepp in the first two tournament rounds, finish your cards in the last two, and complete the tournament.", 50),
    (96, "Schlussdreier", "Three to finish", "Die letzten drei Runden eines vollständigen Turniers erfolgreich beenden.", "Finish your cards in the final three rounds of a completed tournament.", 25),
    (97, "Dreifach Hausdepp", "Triple Hausdepp", "Ein vollständiges Turnier mit mindestens drei eigenen Hausdepp-Runden abschliessen.", "Complete a full tournament after being the round’s Hausdepp at least three times.", 10),
    (98, "Die direkte Antwort", "The immediate reply", "In einem vollständigen Turnier direkt nach einer eigenen Hausdepp-Runde die nächste Runde mit leeren Händen beenden.", "In a completed tournament, finish your cards in the round immediately after being Hausdepp.", 10),
    (99, "Geteiltes Leid", "Shared suffering", "Ein vollständiges Turnier abschliessen, in dem jeder Mitspieler mindestens einmal Hausdepp war.", "Complete a full tournament in which every player has been the round’s Hausdepp at least once.", 25),
    (100, "Der Letzte macht das Licht aus", "Last one out turns off the lights", "Die letzten beiden Runden eines vollständigen Turniers als Hausdepp und das Turnier als Tages-Hausdepp beenden.", "Be Hausdepp in the final two rounds of a completed tournament and finish as Tages-Hausdepp.", 25),
    (101, "Bürozeit", "Office hours", "Eine Runde werktags zwischen 07:00 und 17:00 Uhr abschliessen.", "Complete a round on a weekday between 07:00 and 17:00.", 10),
    (102, "Arbeitszeitbetrug I", "Time theft I", "10 Runden werktags zwischen 07:00 und 17:00 Uhr abschliessen.", "Complete 10 rounds on weekdays between 07:00 and 17:00.", 25),
    (103, "Arbeitszeitbetrug II", "Time theft II", "25 Runden werktags zwischen 07:00 und 17:00 Uhr abschliessen.", "Complete 25 rounds on weekdays between 07:00 and 17:00.", 50),
    (104, "Arbeitszeitbetrug Ultra Pro Max III", "Time theft Ultra Pro Max III", "50 Runden werktags zwischen 07:00 und 17:00 Uhr abschliessen.", "Complete 50 rounds on weekdays between 07:00 and 17:00.", 100),
    (105, "Mittagspause", "Lunch break", "5 Runden werktags zwischen 12:00 und 13:30 Uhr abschliessen.", "Complete 5 rounds on weekdays between 12:00 and 13:30.", 10),
    (106, "Feierabendrunde", "After-work round", "10 Runden werktags zwischen 17:00 und 20:00 Uhr abschliessen.", "Complete 10 rounds on weekdays between 17:00 and 20:00.", 25),
    (107, "Nachteule", "Night owl", "Eine Runde zwischen 02:00 und 05:00 Uhr abschliessen.", "Complete a round between 02:00 and 05:00.", 25),
    (108, "Early Bird", "Early bird", "5 Runden zwischen 06:00 und 07:00 Uhr abschliessen.", "Complete 5 rounds between 06:00 and 07:00.", 25),
    (109, "Wochenendspieler", "Weekend player", "10 Runden am Samstag oder Sonntag abschliessen.", "Complete 10 rounds on a Saturday or Sunday.", 25),
    (110, "Spielabend", "Card night", "An einem Tag 5 Runden abschliessen.", "Complete 5 rounds on a single day.", 10),
    (111, "Kartenmarathon", "Card marathon", "An einem Tag 10 Runden abschliessen.", "Complete 10 rounds on a single day.", 25),
    (112, "Wochenläufer", "Week streak", "An 7 aufeinanderfolgenden Tagen je eine Runde abschliessen.", "Complete a round on 7 days in a row.", 50),
    (113, "Zwei-Wochen-Lauf", "Fortnight streak", "An 14 aufeinanderfolgenden Tagen je eine Runde abschliessen.", "Complete a round on 14 days in a row.", 100),
    (114, "Stammgast", "Regular", "500 Runden abschliessen.", "Complete 500 rounds.", 100),
    (115, "Inventar mit Schlüssel", "Furniture with a key", "1000 Runden abschliessen.", "Complete 1000 rounds.", 100),
    (116, "Sternstunde gezündet", "Sparked a star shower", "Den seltenen Sternenregen selbst auslösen und die Runde abschliessen; mindestens ein weiterer Mensch muss beim Auslösen verbunden mitspielen.", "Trigger the rare star shower yourself and complete the round; at least one other human must be connected and playing when you trigger it.", 50),
    (117, "Hammermässiger Auftritt", "Hammer time", "Den seltenen Hammerschlag selbst auslösen und die Runde abschliessen; mindestens ein weiterer Mensch muss beim Auslösen verbunden mitspielen.", "Trigger the rare hammer strike yourself and complete the round; at least one other human must be connected and playing when you trigger it.", 50),
    (118, "Besuch bestellt", "Called the visitors", "Den seltenen UFO-Besuch selbst auslösen und die Runde abschliessen; mindestens ein weiterer Mensch muss beim Auslösen verbunden mitspielen.", "Trigger the rare UFO visit yourself and complete the round; at least one other human must be connected and playing when you trigger it.", 50),
    (119, "Tür ins Nirgendwo", "Door to nowhere", "Den seltenen Portalwirbel selbst auslösen und die Runde abschliessen; mindestens ein weiterer Mensch muss beim Auslösen verbunden mitspielen.", "Trigger the rare portal swirl yourself and complete the round; at least one other human must be connected and playing when you trigger it.", 50),
    (120, "Feuer frei, Drache!", "Fire away, dragon!", "Den seltenen Drachenangriff selbst auslösen und die Runde abschliessen; mindestens ein weiterer Mensch muss beim Auslösen verbunden mitspielen.", "Trigger the rare dragon attack yourself and complete the round; at least one other human must be connected and playing when you trigger it.", 50),
    (121, "Acht Arme bestellt", "Ordered eight arms", "Den seltenen Krakenbesuch selbst auslösen und die Runde abschliessen; mindestens ein weiterer Mensch muss beim Auslösen verbunden mitspielen.", "Trigger the rare kraken visit yourself and complete the round; at least one other human must be connected and playing when you trigger it.", 50),
    (122, "Die Zeit angehalten", "Stopped the clock", "Den seltenen Zeitstillstand selbst auslösen und die Runde abschliessen; mindestens ein weiterer Mensch muss beim Auslösen verbunden mitspielen.", "Trigger the rare stopped clock yourself and complete the round; at least one other human must be connected and playing when you trigger it.", 50),
    (123, "Loch im Stammtisch", "Hole in the table", "Das seltene schwarze Loch selbst auslösen und die Runde abschliessen; mindestens ein weiterer Mensch muss beim Auslösen verbunden mitspielen.", "Trigger the rare black hole yourself and complete the round; at least one other human must be connected and playing when you trigger it.", 50),
    (124, "Vierfach verrückt", "Four kinds of strange", "Vier verschiedene seltene Tischüberraschungen selbst auslösen und die jeweiligen Runden abschliessen; beim Auslösen muss jeweils mindestens ein weiterer Mensch verbunden mitspielen.", "Trigger four different rare table surprises yourself and complete each round; at least one other human must be connected and playing when you trigger each surprise.", 100),
    (125, "Das volle Kuriositätenkabinett", "The complete cabinet of curiosities", "Alle acht seltenen Tischüberraschungen selbst auslösen und die jeweiligen Runden abschliessen; beim Auslösen muss jeweils mindestens ein weiterer Mensch verbunden mitspielen.", "Trigger all eight rare table surprises yourself and complete each round; at least one other human must be connected and playing when you trigger each surprise.", 500),
    (126, "Sternengast", "Guest of the stars", "Den seltenen Sternenregen als verbundener Mitspieler miterleben und die Runde abschliessen; beim Auslösen müssen mindestens zwei Menschen verbunden mitspielen.", "Witness the rare star shower as a connected player and complete the round; at least two humans must be connected and playing when it is triggered.", 25),
    (127, "Das sass!", "What a hit!", "Den seltenen Hammerschlag als verbundener Mitspieler miterleben und die Runde abschliessen; beim Auslösen müssen mindestens zwei Menschen verbunden mitspielen.", "Witness the rare hammer strike as a connected player and complete the round; at least two humans must be connected and playing when it is triggered.", 25),
    (128, "Nicht von dieser Welt", "Out of this world", "Den seltenen UFO-Besuch als verbundener Mitspieler miterleben und die Runde abschliessen; beim Auslösen müssen mindestens zwei Menschen verbunden mitspielen.", "Witness the rare UFO visit as a connected player and complete the round; at least two humans must be connected and playing when it is triggered.", 25),
    (129, "Auf der anderen Seite", "On the other side", "Den seltenen Portalwirbel als verbundener Mitspieler miterleben und die Runde abschliessen; beim Auslösen müssen mindestens zwei Menschen verbunden mitspielen.", "Witness the rare portal swirl as a connected player and complete the round; at least two humans must be connected and playing when it is triggered.", 25),
    (130, "Gut durchgebraten", "Well done", "Den seltenen Drachenangriff als verbundener Mitspieler miterleben und die Runde abschliessen; beim Auslösen müssen mindestens zwei Menschen verbunden mitspielen.", "Witness the rare dragon attack as a connected player and complete the round; at least two humans must be connected and playing when it is triggered.", 25),
    (131, "Tentakel am Tisch", "Tentacles at the table", "Den seltenen Krakenbesuch als verbundener Mitspieler miterleben und die Runde abschliessen; beim Auslösen müssen mindestens zwei Menschen verbunden mitspielen.", "Witness the rare kraken visit as a connected player and complete the round; at least two humans must be connected and playing when it is triggered.", 25),
    (132, "Zeitzeuge", "Time witness", "Den seltenen Zeitstillstand als verbundener Mitspieler miterleben und die Runde abschliessen; beim Auslösen müssen mindestens zwei Menschen verbunden mitspielen.", "Witness the rare stopped clock as a connected player and complete the round; at least two humans must be connected and playing when it is triggered.", 25),
    (133, "Dem Nichts entkommen", "Escaped the void", "Das seltene schwarze Loch als verbundener Mitspieler miterleben und die Runde abschliessen; beim Auslösen müssen mindestens zwei Menschen verbunden mitspielen.", "Witness the rare black hole as a connected player and complete the round; at least two humans must be connected and playing when it is triggered.", 25),
    (134, "Kurioser Stammgast", "Regular at the unusual", "Vier verschiedene seltene Tischüberraschungen als verbundener Mitspieler miterleben und die jeweiligen Runden abschliessen; beim Auslösen müssen jeweils mindestens zwei Menschen verbunden mitspielen.", "Witness four different rare table surprises as a connected player and complete each round; at least two humans must be connected and playing when each surprise is triggered.", 50),
    (135, "Jetzt hab ich alles gesehen", "Now I’ve seen everything", "Alle acht seltenen Tischüberraschungen als verbundener Mitspieler miterleben und die jeweiligen Runden abschliessen; beim Auslösen müssen jeweils mindestens zwei Menschen verbunden mitspielen.", "Witness all eight rare table surprises as a connected player and complete each round; at least two humans must be connected and playing when each surprise is triggered.", 250),
    (136, "Zonk: Ich bin dann mal weg", "Zonk: I'm off", "Eine laufende Runde ausdrücklich verlassen, bevor du deine Karten regulär losgeworden bist. Dieser Zonk bringt 0 EP.", "Explicitly leave a running round before finishing your cards normally. This Zonk grants 0 XP.", 0),
    (137, "Doppelt aufgeräumt", "Two kinds of clean", "Direkt nacheinander mit einer 10 und mit vier Gleichen abräumen, in beliebiger Reihenfolge, ohne dass ein anderer Spieler dazwischen eine Karte spielt oder das Paket aufnimmt.", "Clear with a ten and with four of a kind back to back, in either order, without another player playing a card or taking the pile in between.", 50),
    (138, "Den Vierer vollendet, tschüss", "Completed the four, goodbye", "Bei leerem Nachziehstapel mit deiner einzigen letzten Handkarte ein Viererpaket vervollständigen, zu dem ein Mitspieler beigetragen hat, und damit fertig werden.", "With the stock empty, complete a four of a kind that another player helped build with your single last hand card, and finish.", 50),
)
_SURPRISE_ACHIEVEMENTS = {
    **{116 + index: ("activated", effect) for index, effect in enumerate(SURPRISE_EFFECTS)},
    **{126 + index: ("witnessed", effect) for index, effect in enumerate(SURPRISE_EFFECTS)},
}
_CATEGORIES = ("participation", "community", "cut_gamble", "tens", "four", "tempo", "mishaps", "endgame")
# Swiss local time decides when a round counts as office hours, night or weekend.
_PLAY_ZONE = ZoneInfo("Europe/Zurich")
_HABIT_TARGETS = {102: 10, 103: 25, 104: 50, 105: 5, 106: 10, 108: 5, 109: 10, 110: 5, 111: 10,
                  112: 7, 113: 14, 114: 500, 115: 1000}

# A qualifying event advances once per completed round, however often it
# occurred. Ordinary play therefore builds distinct goals over many evenings;
# genuinely unusual single-round feats retain their immediate one-time award.
_ROUND_TARGETS = {
    3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 9: 5, 10: 3, 11: 3,
    20: 3, 21: 5, 22: 3, 23: 5, 25: 5, 26: 3, 27: 5, 28: 3,
    30: 3, 31: 3, 33: 3, 34: 3, 35: 3, 37: 3, 38: 3, 39: 3,
    41: 5, 42: 3, 43: 3, 45: 10, 46: 5, 47: 5, 48: 3,
    49: 3, 50: 5, 51: 3, 52: 5, 53: 5, 54: 3, 55: 5,
    56: 3, 57: 3, 58: 3, 59: 5, 60: 3, 61: 5, 62: 3, 63: 10, 64: 5,
    65: 5, 66: 3, 67: 5, 68: 3, 69: 3, 70: 3, 71: 3, 72: 3, 73: 5,
    76: 5, 77: 3, 78: 3, 80: 3, 81: 3, 82: 5, 83: 3, 84: 3,
}
_TOURNAMENT_TARGETS = {91: 3, 93: 3, 94: 3, 96: 3, 97: 3, 98: 5, 99: 3, 100: 3}
_TARGETS = {f"hausdepp_{number:02}": target for number, target in {
    **_ROUND_TARGETS, **_TOURNAMENT_TARGETS, **_HABIT_TARGETS,
    2: 25, 8: 5, 12: 5, 13: 10, 14: 10, 15: 100, 16: 250, 29: 25, 86: 3, 87: 10,
    124: 4, 125: 8, 134: 4, 135: 8,
}.items()}

_REPEATED_DESCRIPTIONS = {
    3: ("Drei Runden zu zweit abschliessen.", "Complete three two-player rounds."),
    4: ("Drei Runden zu dritt abschliessen.", "Complete three three-player rounds."),
    5: ("Drei Runden zu viert abschliessen.", "Complete three four-player rounds."),
    6: ("Drei Runden zu fünft abschliessen.", "Complete three five-player rounds."),
    7: ("Drei Runden zu sechst abschliessen.", "Complete three six-player rounds."),
    8: ("Mit jeder Tischgrösse von zwei bis sechs jeweils mindestens drei Runden abschliessen.",
        "Complete at least three rounds at every table size from two to six."),
    9: ("Fünf Runden mit einem Computer-Mitspieler abschliessen.", "Complete five rounds with a computer player."),
    10: ("Drei Runden mit mindestens drei Menschen und ohne Computer abschliessen.",
         "Complete three rounds with at least three humans and no computers."),
    11: ("Drei Runden mit sechs Menschen abschliessen.", "Complete three rounds with six humans."),
    56: ("In drei abgeschlossenen Runden Hausdepp werden.", "Become Hausdepp in three completed rounds."),
    57: ("In drei abgeschlossenen Runden bei leerem Nachziehstapel alle Karten loswerden.",
         "Finish all your cards with an empty stock in three completed rounds."),
    91: ("Drei vollständige Turniere mit jeweils genau einer eigenen Hausdepp-Runde abschliessen.",
         "Complete three full tournaments with exactly one round as Hausdepp in each."),
    93: ("In drei vollständigen Turnieren nach mindestens einer eigenen Hausdepp-Runde die letzten beiden Runden mit leeren Händen beenden.",
         "In three completed tournaments, finish your cards in the last two rounds after being Hausdepp earlier."),
    94: ("In drei vollständigen Turnieren die erste Runde als Hausdepp und die letzte mit leeren Händen beenden.",
         "In three completed tournaments, be Hausdepp in the first round and finish your cards in the last."),
    96: ("In drei vollständigen Turnieren die letzten drei Runden mit leeren Händen beenden.",
         "Finish your cards in the final three rounds of three completed tournaments."),
    97: ("Drei vollständige Turniere mit jeweils mindestens drei eigenen Hausdepp-Runden abschliessen.",
         "Complete three full tournaments with at least three rounds as Hausdepp in each."),
    98: ("In fünf vollständigen Turnieren direkt nach einer eigenen Hausdepp-Runde die nächste Runde mit leeren Händen beenden.",
         "In five completed tournaments, finish your cards in the round immediately after being Hausdepp."),
    99: ("Drei vollständige Turniere abschliessen, in denen jeder Mitspieler mindestens einmal Hausdepp war.",
         "Complete three full tournaments in which every player has been the round’s Hausdepp at least once."),
    100: ("In drei vollständigen Turnieren die letzten beiden Runden als Hausdepp und das Turnier als Tages-Hausdepp beenden.",
          "In three completed tournaments, be Hausdepp in the final two rounds and finish as Tages-Hausdepp."),
}


def _description(number: int, de: str, en: str) -> dict[str, str]:
    if number in _REPEATED_DESCRIPTIONS:
        de, en = _REPEATED_DESCRIPTIONS[number]
    elif number in _ROUND_TARGETS:
        target = _ROUND_TARGETS[number]
        for prefix in ("Zum ersten Mal ", "In derselben Runde ", "In einer Runde "):
            de = de.removeprefix(prefix)
        en = en.replace(" for the first time", "").replace("your first legal", "a legal")
        de = f"In {target} abgeschlossenen Runden jeweils {de[0].lower()}{de[1:]}"
        en = f"In {target} different completed rounds, {en[0].lower()}{en[1:]}"
    return {"de": de, "en": en}


_APPENDED_CATEGORIES = {137: "tempo", 138: "endgame"}


def _category(number: int) -> str:
    if number in _APPENDED_CATEGORIES:
        return _APPENDED_CATEGORIES[number]
    if number == 136:
        return "zonk"
    if number >= 116:
        return "surprises_activated" if number <= 125 else "surprises_witnessed"
    if number > 100:
        return "habits"
    if number <= 64:
        return _CATEGORIES[(number - 1) // 8]
    return "comebacks" if number <= 76 else "style" if number <= 84 else "tournament"


ACHIEVEMENTS = tuple({"id": f"hausdepp_{number:02}", "name": {"de": de, "en": en},
                      "description": _description(number, description_de, description_en),
                      "category": _category(number), "points": points}
                     for number, de, en, description_de, description_en, points in _ACHIEVEMENT_DATA)
_ACHIEVEMENTS_BY_ID = {item["id"]: item for item in ACHIEVEMENTS}


def _insert_once(db, model, values: dict) -> bool:
    insert = sqlite_insert if db.bind.dialect.name == "sqlite" else pg_insert
    return db.execute(insert(model).values(**values).on_conflict_do_nothing()).rowcount == 1


def _rank(points: int) -> dict:
    return dict(next(rank for rank in reversed(RANKS) if points >= rank["threshold"]))


def _new_aggregate() -> dict:
    return {"rounds": 0, "sizes": Counter(), "opponents": Counter(), "flags": Counter(), "ten_clears": 0,
            "with_cpu": 0, "humans_three": 0, "humans_six": 0,
            "hausdepp": 0, "finished": 0, "remaining": 0, "withdrawals": 0, "tournaments": set(),
            "surprises_activated": set(), "surprises_witnessed": set(),
            "office": 0, "lunch": 0, "evening": 0, "night": 0, "early": 0, "weekend": 0,
            "days": Counter(), "best_day": 0, "streak": 0, "best_streak": 0, "last_day": None}


def _accumulate(aggregate: dict, facts: dict, finished_at: datetime | None = None) -> None:
    aggregate["rounds"] += 1
    if finished_at is not None:
        _accumulate_time(aggregate, as_utc(finished_at).astimezone(_PLAY_ZONE))
    aggregate["sizes"][facts["participant_count"]] += 1
    aggregate["opponents"].update(facts["opponents"])
    tournament_id = facts.get("completed_tournament_id")
    first_tournament_credit = bool(tournament_id and tournament_id not in aggregate["tournaments"])
    aggregate["flags"].update(flag for flag in set(facts["flags"])
                              if flag not in TOURNAMENT_EVENT_ACHIEVEMENTS or first_tournament_credit)
    aggregate["ten_clears"] += facts["ten_clears"]
    aggregate["with_cpu"] += facts["cpu_count"] > 0
    aggregate["humans_three"] += facts["cpu_count"] == 0 and facts["human_count"] >= 3
    aggregate["humans_six"] += facts["human_count"] == 6
    collection = facts.get("table_surprises", {})
    for track in ("activated", "witnessed"):
        aggregate[f"surprises_{track}"].update(effect for effect in collection.get(track, [])
                                             if effect in SURPRISE_EFFECTS)
    aggregate[facts["outcome"]] += 1
    if tournament_id:
        aggregate["tournaments"].add(tournament_id)


def _accumulate_time(aggregate: dict, local: datetime) -> None:
    """Play habits from the round's Swiss local finishing time (credits come in time order)."""
    weekday, minutes = local.weekday() < 5, local.hour * 60 + local.minute
    aggregate["office"] += weekday and 7 * 60 <= minutes < 17 * 60
    aggregate["lunch"] += weekday and 12 * 60 <= minutes < 13 * 60 + 30
    aggregate["evening"] += weekday and 17 * 60 <= minutes < 20 * 60
    aggregate["night"] += 2 * 60 <= minutes < 5 * 60
    aggregate["early"] += 6 * 60 <= minutes < 7 * 60
    aggregate["weekend"] += not weekday
    day = local.date()
    aggregate["days"][day] += 1
    aggregate["best_day"] = max(aggregate["best_day"], aggregate["days"][day])
    last = aggregate["last_day"]
    if last != day:
        aggregate["streak"] = aggregate["streak"] + 1 if last is not None and (day - last).days == 1 else 1
        aggregate["last_day"] = day
    aggregate["best_streak"] = max(aggregate["best_streak"], aggregate["streak"])


def _progress(aggregate: dict, achievement_id: str) -> tuple[int, int]:
    number = int(achievement_id.rsplit("_", 1)[1])
    current, target = aggregate["flags"][achievement_id], _TARGETS.get(achievement_id, 1)
    if number == 136:
        current = aggregate["withdrawals"]
    elif number in _SURPRISE_ACHIEVEMENTS:
        track, effect = _SURPRISE_ACHIEVEMENTS[number]
        current = int(effect in aggregate[f"surprises_{track}"])
    elif number in (124, 125, 134, 135):
        current = len(aggregate["surprises_activated" if number < 126 else "surprises_witnessed"])
    elif number in (1, 2, 15, 16):
        current = aggregate["rounds"]
    elif 3 <= number <= 7:
        current = aggregate["sizes"][number - 1]
    elif number == 8:
        current = sum(aggregate["sizes"][count] >= 3 for count in range(2, 7))
    elif number == 9:
        current = int(aggregate["with_cpu"])
    elif number == 10:
        current = int(aggregate["humans_three"])
    elif number == 11:
        current = int(aggregate["humans_six"])
    elif number in (12, 13):
        current = len(aggregate["opponents"])
    elif number == 14:
        current = max(aggregate["opponents"].values(), default=0)
    elif number == 29:
        current = aggregate["ten_clears"]
    elif number == 56:
        current = int(aggregate["hausdepp"])
    elif number == 57:
        current = int(aggregate["finished"])
    elif number in (86, 87):
        current = len(aggregate["tournaments"])
    elif 101 <= number <= 115:
        current = {101: aggregate["office"], 102: aggregate["office"], 103: aggregate["office"],
                   104: aggregate["office"], 105: aggregate["lunch"], 106: aggregate["evening"],
                   107: aggregate["night"], 108: aggregate["early"], 109: aggregate["weekend"],
                   110: aggregate["best_day"], 111: aggregate["best_day"], 112: aggregate["best_streak"],
                   113: aggregate["best_streak"], 114: aggregate["rounds"], 115: aggregate["rounds"]}[number]
    return min(current, target), target


def public_hausdepp_ranks(db, user_ids: list[int]) -> dict[int, dict]:
    """Expose titles from the same weighted ledger as the private account.

    No synchronization, receipts or unlock presentation is written while another
    player reads standings. Private source rounds and XP totals stay internal.
    """
    ids = {value for value in user_ids if type(value) is int and value > 0}
    if len(ids) > 100:
        raise ValueError("hausdepp_invalid_limit")
    if not ids:
        return {}
    credits = {value: [] for value in ids}
    unlocks = {value: [] for value in ids}
    for credit in db.scalars(select(HausdeppRoundCredit).where(HausdeppRoundCredit.user_id.in_(ids),
            source_not_withdrawn(HausdeppRoundCredit.user_id, HausdeppRoundCredit.game_id))):
        credits[credit.user_id].append(credit)
    for unlock in db.scalars(select(HausdeppAchievementUnlock).where(
            HausdeppAchievementUnlock.user_id.in_(ids), _unlock_source_allowed())):
        unlocks[unlock.user_id].append(unlock)
    result = {}
    for user_id in ids:
        rank = _rank(_score_points(credits[user_id], unlocks[user_id]))
        result[user_id] = {key: rank[key] for key in ("id", "name", "level")}
    return result


def synchronize_hausdepp_progress(user_id: int) -> dict:
    """Recover missing credits/awards and project only the requesting account."""
    if type(user_id) is not int or user_id < 1:
        raise ValueError("hausdepp_invalid_user")
    if not database_schema_ready():
        return _projection([], [], _new_aggregate(), 0)
    with session_scope() as db:
        # Take the per-account write lock before source reads. PostgreSQL locks
        # this account's row; SQLite obtains its write reservation without the
        # read-to-write snapshot race between simultaneous account tabs.
        _insert_once(db, HausdeppPresentationReceipt, {"user_id": user_id, "acknowledged_points": 0})
        db.execute(update(HausdeppPresentationReceipt).where(
            HausdeppPresentationReceipt.user_id == user_id,
        ).values(acknowledged_points=HausdeppPresentationReceipt.acknowledged_points))
        unlocks = db.scalars(select(HausdeppAchievementUnlock)
                             .where(HausdeppAchievementUnlock.user_id == user_id, _unlock_source_allowed())).all()
        existing_credits = db.scalars(select(HausdeppRoundCredit).where(HausdeppRoundCredit.user_id == user_id,
            source_not_withdrawn(HausdeppRoundCredit.user_id, HausdeppRoundCredit.game_id))).all()
        awarded_points = len(existing_credits) * ROUND_POINTS + sum(
            _revision_points(_ACHIEVEMENTS_BY_ID[unlock.achievement_id]["points"]) for unlock in unlocks
            if unlock.achievement_id in _ACHIEVEMENTS_BY_ID)
        receipt = db.get(HausdeppPresentationReceipt, user_id)
        if receipt.acknowledged_score_points is None and receipt.acknowledged_points == awarded_points:
            # All already-credited progress was seen before this read. Derive
            # its weighted snapshot before recovering any newly finished rows.
            receipt.acknowledged_score_points = _score_points(existing_credits, unlocks)
        # A relational NOT EXISTS avoids repeatedly decoding old histories. Only
        # human membership grants a source query; cursors carry no authority.
        statement = select(CompletedGame).options(selectinload(CompletedGame.participants)).where(
            CompletedGame.game_type == HAUSDEPP_GAME_TYPE,
            CompletedGame.participants.any(GameParticipant.user_id == user_id),
            ~select(HausdeppRoundCredit.game_id).where(
                HausdeppRoundCredit.user_id == user_id,
                HausdeppRoundCredit.game_id == CompletedGame.game_id,
            ).exists(),
        ).order_by(CompletedGame.finished_at, CompletedGame.id)
        # Source results are read in bounded pages. Credits are immutable narrow
        # facts and never contain hands, names or another account's event flags.
        last_id = None
        while True:
            query = statement if last_id is None else statement.where(CompletedGame.id > last_id)
            rows = db.scalars(query.order_by(None).order_by(CompletedGame.id).limit(250)).all()
            if not rows:
                break
            for row in rows:
                validated = validated_hausdepp_membership(row, user_id, db=db)
                if validated is None:
                    continue
                _record, facts = validated
                inserted = _insert_once(db, HausdeppRoundCredit, {
                    "user_id": user_id, "game_id": row.game_id, "finished_at": row.finished_at,
                    "facts_json": json.dumps(facts, separators=(",", ":")),
                })
                if inserted:
                    awarded_points += ROUND_POINTS
            last_id = rows[-1].id
        credits = db.scalars(select(HausdeppRoundCredit).where(HausdeppRoundCredit.user_id == user_id)
                             .where(source_not_withdrawn(HausdeppRoundCredit.user_id, HausdeppRoundCredit.game_id))
                             .order_by(HausdeppRoundCredit.finished_at, HausdeppRoundCredit.game_id)).all()
        unlocked_ids = {unlock.achievement_id for unlock in unlocks}
        aggregate = _new_aggregate()
        for credit in credits:
            _accumulate(aggregate, json.loads(credit.facts_json), credit.finished_at)
            for item in ACHIEVEMENTS:
                current, target = _progress(aggregate, item["id"])
                if item["id"] not in unlocked_ids and current >= target:
                    awarded_points += _revision_points(item["points"])
                    _insert_once(db, HausdeppAchievementUnlock, {
                        "user_id": user_id, "achievement_id": item["id"], "unlocked_at": credit.finished_at,
                        "source_game_id": credit.game_id, "awarded_points": awarded_points,
                    })
                    unlocked_ids.add(item["id"])
        withdrawals = db.scalars(select(HausdeppWithdrawal).where(HausdeppWithdrawal.user_id == user_id)
                                 .order_by(HausdeppWithdrawal.departed_at, HausdeppWithdrawal.result_id)).all()
        aggregate["withdrawals"] = len(withdrawals)
        if withdrawals and WITHDRAWAL_ACHIEVEMENT_ID not in unlocked_ids:
            awarded_points += 1
            first = withdrawals[0]
            _insert_once(db, HausdeppAchievementUnlock, {
                "user_id": user_id, "achievement_id": WITHDRAWAL_ACHIEVEMENT_ID, "unlocked_at": first.departed_at,
                "source_game_id": first.result_id, "awarded_points": awarded_points,
            })
        unlocks = db.scalars(select(HausdeppAchievementUnlock)
                             .where(HausdeppAchievementUnlock.user_id == user_id, _unlock_source_allowed())).all()
        result = _projection(credits, unlocks, aggregate, receipt.acknowledged_points,
                             receipt.acknowledged_score_points)
        scores = _presentation_scores(receipt)
        revision = result["presentation"]["revision"]
        scores.setdefault(str(revision), _score_points(credits, unlocks))
        scores = dict(sorted(((key, value) for key, value in scores.items()
                              if int(key) >= receipt.acknowledged_points), key=lambda item: int(item[0]))
                      [-PRESENTATION_SNAPSHOT_LIMIT:])
        receipt.presentation_scores_json = json.dumps(scores, separators=(",", ":"))
        return result


def _projection(credits: list, unlocks: list, aggregate: dict, acknowledged: int,
                acknowledged_score_points: int | None = None) -> dict:
    if type(acknowledged_score_points) is not int or not 0 <= acknowledged_score_points <= 2**63 - 1:
        acknowledged_score_points = None
    known_unlocks = {unlock.achievement_id: unlock for unlock in unlocks if unlock.achievement_id in _ACHIEVEMENTS_BY_ID}
    round_points = _round_points(credits)
    achievement_points = sum(_ACHIEVEMENTS_BY_ID[key]["points"] for key in known_unlocks)
    points = round_points + achievement_points
    # Revisions represent grant order, independently of the weighted score.
    revision = len(credits) * ROUND_POINTS + sum(_revision_points(_ACHIEVEMENTS_BY_ID[key]["points"])
                                               for key in known_unlocks)
    rank = _rank(points)
    next_rank = next((dict(item) for item in RANKS if item["threshold"] > points), None)
    gap = next_rank["threshold"] - rank["threshold"] if next_rank else 0
    current = points - rank["threshold"] if next_rank else 0
    rank.update(next=next_rank, progress={"current": current, "target": gap,
                                        "percent": round(current / gap * 100, 2) if gap else 100})
    items = []
    for item in ACHIEVEMENTS:
        progress, target = _progress(aggregate, item["id"])
        unlock = known_unlocks.get(item["id"])
        items.append({**item, "unlocked": unlock is not None,
                      "unlocked_at": as_utc(unlock.unlocked_at).isoformat() if unlock else None,
                      "progress": {"current": target if unlock else progress, "target": target}})
    pending = None
    if revision > acknowledged:
        # Grant generations are stable even if an older finished round is only
        # recovered later. Source timestamps must never reorder seen badges.
        if acknowledged == 0:
            acknowledged_score_points = 0
        previous_rank = _rank(acknowledged_score_points) if acknowledged_score_points is not None else None
        newly_unlocked = [unlock.achievement_id for unlock in sorted(
            known_unlocks.values(), key=lambda item: (item.awarded_points, item.achievement_id),
        ) if unlock.awarded_points > acknowledged]
        target_rank = _rank(points)
        earned = _score_points(credits, unlocks) - acknowledged_score_points if acknowledged_score_points is not None else None
        pending = {"revision": revision, "through_points": points,
                   "points_earned": earned if earned is not None and earned >= 0 else None,
                   "from_rank": previous_rank, "to_rank": target_rank, "achievement_ids": newly_unlocked,
                   "rank_up": target_rank["level"] > previous_rank["level"] if previous_rank else None,
                   "message": {"de": "Gratuliere! Dem Hausdepp wieder einen Schritt näher.",
                               "en": "Congratulations! One step closer to Hausdepp."},
                   "quote": target_rank["quote"]}
    return {"scoring": {"available": True, "points": points, "round_points": round_points,
                        "achievement_points": achievement_points, "round_reward": ROUND_POINTS,
                        "cpu_round_reward": CPU_ROUND_POINTS, "cpu_reduction_percent": 75},
            "achievements": {"available": True, "direction": "clever_to_hausdepp", "total": len(ACHIEVEMENTS),
                             "unlocked_count": len(known_unlocks), "items": items},
            "rank": rank, "ranks": list(RANKS), "presentation": {"pending": pending, "revision": revision}}


def acknowledge_hausdepp_presentation(user_id: int, revision: int) -> dict:
    if type(revision) is not int or revision < 0:
        raise ValueError("hausdepp_invalid_revision")
    current = synchronize_hausdepp_progress(user_id)
    if revision > current["presentation"]["revision"] or not database_schema_ready():
        raise ValueError("hausdepp_invalid_revision")
    with session_scope() as db:
        _insert_once(db, HausdeppPresentationReceipt, {"user_id": user_id, "acknowledged_points": 0})
        receipt = db.get(HausdeppPresentationReceipt, user_id)
        score = _presentation_scores(receipt).get(str(revision))
        db.execute(update(HausdeppPresentationReceipt).where(
            HausdeppPresentationReceipt.user_id == user_id,
            HausdeppPresentationReceipt.acknowledged_points < revision,
        ).values(acknowledged_points=revision, acknowledged_score_points=score))
        db.expire(receipt)
        return {"acknowledged": True, "revision": receipt.acknowledged_points}
