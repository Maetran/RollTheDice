"""Private Hausdepp XP, 100 one-time achievements and the 24-step ironic ladder.

Only validated, completed round membership can mint a credit. Database uniqueness
makes retries and simultaneous account tabs harmless. This service never writes
to the suite's public achievement feed or another game's points.
"""

from __future__ import annotations

import json
from collections import Counter

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import selectinload

from .database import database_schema_ready, session_scope
from .game_types import HAUSDEPP_GAME_TYPE
from .hausdepp_results import validated_hausdepp_membership
from .models import (
    CompletedGame,
    GameParticipant,
    HausdeppAchievementUnlock,
    HausdeppPresentationReceipt,
    HausdeppRoundCredit,
)
from .security import as_utc

ROUND_POINTS = 10

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
    (2650, "Halbwisser", "Half an Expert", "Die Hälfte wissen. Den Rest überzeugend vertreten.", "Know half of it. Defend the rest convincingly."),
    (3000, "Bauchspieler", "Gut Player", "Der Kopf hat Feierabend. Der Bauch übernimmt.", "Your brain has clocked off. Your gut is taking over."),
    (3400, "Denkpause", "Brain Break", "Kurz nicht nachgedacht. Schon wieder weitergekommen.", "Stopped thinking for a moment. Somehow still made progress."),
    (3800, "Holzkopf", "Blockhead", "Solides Holz. Beste Voraussetzungen für den Stammtisch.", "Solid wood. An excellent fit for the card table."),
    (4200, "Ochse", "Ox", "Mit ruhiger Kraft Richtung Hausdepp.", "Steady and strong, heading straight for Hausdepp."),
    (4600, "Hirni", "Goofball", "Der Hausdepp ist zum Greifen nah.", "Hausdepp is almost within reach."),
    (5000, "Hausdepp", "Hausdepp", "Geschafft. Mehr Hausdepp geht nicht.", "You made it. Peak Hausdepp achieved."),
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
)
_CATEGORIES = ("participation", "community", "cut_gamble", "tens", "four", "tempo", "mishaps", "endgame")


def _category(number: int) -> str:
    if number <= 64:
        return _CATEGORIES[(number - 1) // 8]
    return "comebacks" if number <= 76 else "style" if number <= 84 else "tournament"


ACHIEVEMENTS = tuple({"id": f"hausdepp_{number:02}", "name": {"de": de, "en": en},
                      "description": {"de": description_de, "en": description_en},
                      "category": _category(number), "points": points}
                     for number, de, en, description_de, description_en, points in _ACHIEVEMENT_DATA)
_ACHIEVEMENTS_BY_ID = {item["id"]: item for item in ACHIEVEMENTS}
_TARGETS = {"hausdepp_02": 25, "hausdepp_08": 5, "hausdepp_12": 5, "hausdepp_13": 10,
            "hausdepp_14": 10, "hausdepp_15": 100, "hausdepp_16": 250, "hausdepp_29": 25,
            "hausdepp_86": 3, "hausdepp_87": 10}


def _insert_once(db, model, values: dict) -> bool:
    insert = sqlite_insert if db.bind.dialect.name == "sqlite" else pg_insert
    return db.execute(insert(model).values(**values).on_conflict_do_nothing()).rowcount == 1


def _rank(points: int) -> dict:
    return dict(next(rank for rank in reversed(RANKS) if points >= rank["threshold"]))


def _new_aggregate() -> dict:
    return {"rounds": 0, "sizes": set(), "opponents": Counter(), "flags": set(), "ten_clears": 0,
            "with_cpu": False, "humans_three": False, "humans_six": False,
            "hausdepp": False, "finished": False, "tournaments": set()}


def _accumulate(aggregate: dict, facts: dict) -> None:
    aggregate["rounds"] += 1
    aggregate["sizes"].add(facts["participant_count"])
    aggregate["opponents"].update(facts["opponents"])
    aggregate["flags"].update(facts["flags"])
    aggregate["ten_clears"] += facts["ten_clears"]
    aggregate["with_cpu"] |= facts["cpu_count"] > 0
    aggregate["humans_three"] |= facts["cpu_count"] == 0 and facts["human_count"] >= 3
    aggregate["humans_six"] |= facts["human_count"] == 6
    aggregate[facts["outcome"]] = True
    if facts.get("completed_tournament_id"):
        aggregate["tournaments"].add(facts["completed_tournament_id"])


def _progress(aggregate: dict, achievement_id: str) -> tuple[int, int]:
    number = int(achievement_id.rsplit("_", 1)[1])
    current, target = int(achievement_id in aggregate["flags"]), _TARGETS.get(achievement_id, 1)
    if number in (1, 2, 15, 16):
        current = aggregate["rounds"]
    elif 3 <= number <= 7:
        current = int(number - 1 in aggregate["sizes"])
    elif number == 8:
        current = len(aggregate["sizes"])
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
    return min(current, target), target


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
                             .where(HausdeppAchievementUnlock.user_id == user_id)).all()
        awarded_points = (db.scalar(select(func.count()).select_from(HausdeppRoundCredit).where(
            HausdeppRoundCredit.user_id == user_id,
        )) * ROUND_POINTS + sum(_ACHIEVEMENTS_BY_ID[unlock.achievement_id]["points"] for unlock in unlocks
                                if unlock.achievement_id in _ACHIEVEMENTS_BY_ID))
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
                validated = validated_hausdepp_membership(row, user_id)
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
                             .order_by(HausdeppRoundCredit.finished_at, HausdeppRoundCredit.game_id)).all()
        unlocked_ids = {unlock.achievement_id for unlock in unlocks}
        aggregate = _new_aggregate()
        for credit in credits:
            _accumulate(aggregate, json.loads(credit.facts_json))
            for item in ACHIEVEMENTS:
                current, target = _progress(aggregate, item["id"])
                if item["id"] not in unlocked_ids and current >= target:
                    awarded_points += item["points"]
                    _insert_once(db, HausdeppAchievementUnlock, {
                        "user_id": user_id, "achievement_id": item["id"], "unlocked_at": credit.finished_at,
                        "source_game_id": credit.game_id, "awarded_points": awarded_points,
                    })
                    unlocked_ids.add(item["id"])
        unlocks = db.scalars(select(HausdeppAchievementUnlock)
                             .where(HausdeppAchievementUnlock.user_id == user_id)).all()
        receipt = db.get(HausdeppPresentationReceipt, user_id)
        return _projection(credits, unlocks, aggregate, receipt.acknowledged_points if receipt else 0)


def _projection(credits: list, unlocks: list, aggregate: dict, acknowledged: int) -> dict:
    known_unlocks = {unlock.achievement_id: unlock for unlock in unlocks if unlock.achievement_id in _ACHIEVEMENTS_BY_ID}
    round_points = len(credits) * ROUND_POINTS
    achievement_points = sum(_ACHIEVEMENTS_BY_ID[key]["points"] for key in known_unlocks)
    points = round_points + achievement_points
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
    if points > acknowledged:
        # Grant generations are stable even if an older finished round is only
        # recovered later. Source timestamps must never reorder seen badges.
        previous_rank = _rank(acknowledged)
        newly_unlocked = [unlock.achievement_id for unlock in sorted(
            known_unlocks.values(), key=lambda item: (item.awarded_points, item.achievement_id),
        ) if unlock.awarded_points > acknowledged]
        target_rank = _rank(points)
        pending = {"revision": points, "through_points": points, "points_earned": points - acknowledged,
                   "from_rank": previous_rank, "to_rank": target_rank, "achievement_ids": newly_unlocked,
                   "rank_up": target_rank["level"] > previous_rank["level"],
                   "message": {"de": "Gratuliere! Dem Hausdepp wieder einen Schritt näher.",
                               "en": "Congratulations! One step closer to Hausdepp."},
                   "quote": target_rank["quote"]}
    return {"scoring": {"available": True, "points": points, "round_points": round_points,
                        "achievement_points": achievement_points, "round_reward": ROUND_POINTS},
            "achievements": {"available": True, "direction": "clever_to_hausdepp", "total": len(ACHIEVEMENTS),
                             "unlocked_count": len(known_unlocks), "items": items},
            "rank": rank, "ranks": list(RANKS), "presentation": {"pending": pending}}


def acknowledge_hausdepp_presentation(user_id: int, revision: int) -> dict:
    if type(revision) is not int or revision < 0:
        raise ValueError("hausdepp_invalid_revision")
    current = synchronize_hausdepp_progress(user_id)["scoring"]["points"]
    if revision > current or not database_schema_ready():
        raise ValueError("hausdepp_invalid_revision")
    with session_scope() as db:
        _insert_once(db, HausdeppPresentationReceipt, {"user_id": user_id, "acknowledged_points": 0})
        db.execute(update(HausdeppPresentationReceipt).where(
            HausdeppPresentationReceipt.user_id == user_id,
            HausdeppPresentationReceipt.acknowledged_points < revision,
        ).values(acknowledged_points=revision))
        receipt = db.get(HausdeppPresentationReceipt, user_id)
        return {"acknowledged": True, "revision": receipt.acknowledged_points}
