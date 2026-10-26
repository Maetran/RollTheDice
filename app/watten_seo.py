"""Public Watten beta documents with real initial text and stable language URLs."""

import json
import re
from html import escape, unescape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .feature_flags import public_game_beta
from .product_hosts import WATTEN_ORIGIN
from .public_discovery import public_game_suite

_COPY = {
    "de": {
        "lobby_title": "Watten online [BETA] – zu zweit, zu dritt oder zu viert",
        "lobby_description": "Spiele Watten online mit Freunden oder CPUs: eigene Tische, offene und blinde Hausregeln, Teams, Bieten und Audiochat. Öffentliche Beta.",
        "rules_title": "Watten-Regeln [BETA] – Schlag, Farbe, Bieten und Nockerl",
        "rules_description": "Unsere Watten-Hausregeln für zwei, drei und vier Spieler: normale und ladinische Ansage, Blindwatten, Stiche, Bieten, Nockerl und Retourschneider.",
        "intro": "Watten online zu zweit, zu dritt oder zu viert – mit Freunden oder Computergegnern.",
        "detail": "Zum Mitspielen brauchst du ein Spielerkonto und JavaScript. Die Hausregeln kannst du ohne Anmeldung lesen.",
        "guide_title": "Watten kurz erklärt",
        "guide_play_title": "Stiche machen und bieten",
        "guide_play": "Jede Person bekommt fünf Karten. Schlag und Trumpffarbe bestimmen, welche Karten stechen. Wer zuerst drei Stiche gewinnt, holt die Runde; durch Bieten steigt der Einsatz.",
        "guide_variants_title": "Eure Runde, eure Hausregeln",
        "guide_variants": "Zu zweit spielt ihr gegeneinander, zu dritt ein wechselnder Solist gegen ein Paar, zu viert in festen Teams. Je nach Spielerzahl wählt ihr normale oder ladinische Ansage, offenes Watten oder Blindwatten und euer Punkteziel.",
        "guide_friends_title": "Zusammen an einen Tisch",
        "guide_friends": "Eröffne einen Tisch, lade Freunde per Link ein oder besetze freie Plätze mit Computergegnern. Der optionale Audiochat verbindet den ganzen Tisch. Eure Einstellungen lassen sich als Favorit für die nächste Runde merken.",
        "beta": "Öffentliche Beta: Wir entwickeln Watten weiter.",
        "play": "Anmelden und spielen", "rules": "Hausregeln lesen", "language": "Sprache",
    },
    "en": {
        "lobby_title": "Watten online [BETA] – for two, three or four players",
        "lobby_description": "Play Watten online with friends or CPUs: create tables, use open or blind house rules, choose teams, bid and use table audio chat. Public beta.",
        "rules_title": "Watten rules [BETA] – strike, trump suit, bidding and loss marks",
        "rules_description": "Our Watten house rules for two, three and four players: normal and Ladinisch calls, blind play, tricks, bidding, Nockerl and Retourschneider.",
        "intro": "Play Watten online with two, three or four players, with friends or computer opponents.",
        "detail": "Playing requires a player account and JavaScript. You can read the house rules without signing in.",
        "guide_title": "Watten at a glance",
        "guide_play_title": "Win tricks and raise the stakes",
        "guide_play": "Everyone receives five cards. The strike and trump suit determine which cards win. The first side to win three tricks takes the round; bidding raises the stakes.",
        "guide_variants_title": "Your round, your house rules",
        "guide_variants": "Two players compete head to head, three take turns playing solo against a pair, and four play in fixed teams. Depending on the player count, choose normal or Ladinisch calls, open or blind Watten and your target score.",
        "guide_friends_title": "Share a table",
        "guide_friends": "Create a table, invite friends with a link or fill empty seats with computer players. Optional audio chat connects the whole table. Save your settings as a favorite for your next round.",
        "beta": "Public beta: Watten is still being developed.",
        "play": "Sign in and play", "rules": "Read the house rules", "language": "Language",
    },
}


def _localized_public_links(content: str, language: str) -> str:
    if language != "en":
        return content

    def anchor(match):
        tag = match.group(0)
        explicit = re.search(r'''(?<![\w:-])hreflang\s*=\s*(["'])(.*?)\1''', tag, re.IGNORECASE)
        if explicit and explicit.group(2).casefold() == "de":
            return tag

        def href(attribute):
            url = urlsplit(unescape(attribute.group(3)))
            if url.scheme or url.netloc or url.path not in {"/watten", "/watten/regeln"}:
                return attribute.group(0)
            query = [(key, value) for key, value in parse_qsl(url.query, keep_blank_values=True) if key != "lang"]
            query.append(("lang", "en"))
            destination = urlunsplit(("", "", url.path, urlencode(query), url.fragment))
            return attribute.group(1) + attribute.group(2) + escape(destination, quote=True) + attribute.group(2)

        return re.sub(r'''((?<![\w:-])href\s*=\s*)(["'])(.*?)\2''', href, tag, flags=re.IGNORECASE)

    return re.sub(r"<a\b[^>]*>", anchor, content, flags=re.IGNORECASE)


def public_watten_metadata(content: str, *, page: str, language: str, request=None) -> tuple[str, str]:
    language = "en" if language == "en" else "de"
    text = dict(_COPY[language])
    beta = public_game_beta("watten")
    site_name = "Watten [BETA]" if beta else "Watten"
    if not beta:
        for key in ("lobby_title", "rules_title"):
            text[key] = text[key].replace(" [BETA]", "")
        text["lobby_description"] = text["lobby_description"].replace(" Öffentliche Beta.", "").replace(" Public beta.", "")
        text["beta"] = ""
    path = "/watten/regeln" if page == "rules" else "/watten"
    base = f"{WATTEN_ORIGIN}{path}"
    canonical = base + ("?lang=en" if language == "en" else "")
    title, description = text[f"{page}_title"], text[f"{page}_description"]
    content = content.replace('<html lang="de"', f'<html lang="{language}" data-watten-seo-language="{language}"', 1)
    content = re.sub(r"<title>.*?</title>", f"<title>{escape(title)}</title>", content, count=1)
    content = re.sub(r'<meta name="description" content="[^"]*">',
                     f'<meta name="description" content="{escape(description, quote=True)}">', content, count=1)
    content = re.sub(r'<meta property="og:(?:title|description|url)"[^>]*>|<link rel="(?:canonical|alternate)"[^>]*>', "", content)
    content = content.replace('<meta name="robots" content="noindex, nofollow">', '<meta name="robots" content="index, follow">')
    metadata = (f'<link rel="canonical" href="{escape(canonical, quote=True)}">'
                f'<link rel="alternate" hreflang="de" href="{base}">'
                f'<link rel="alternate" hreflang="en" href="{base}?lang=en">'
                f'<link rel="alternate" hreflang="x-default" href="{base}">'
                f'<meta property="og:title" content="{escape(title, quote=True)}">'
                f'<meta property="og:description" content="{escape(description, quote=True)}">'
                f'<meta property="og:url" content="{escape(canonical, quote=True)}">'
                f'<meta property="og:type" content="website"><meta property="og:site_name" content="{site_name}">'
                f'<meta property="og:locale" content="{"en_GB" if language == "en" else "de_CH"}">'
                f'<meta property="og:image" content="{WATTEN_ORIGIN}/static/watten/icons/watten-icon-512.png">'
                '<meta name="twitter:card" content="summary">')
    structured = {"@context": "https://schema.org", "@type": "WebPage", "url": canonical,
                  "name": title, "description": description, "inLanguage": language,
                  "isPartOf": {"@type": "WebSite", "name": site_name, "url": f"{WATTEN_ORIGIN}/watten"},
                  "about": {"@type": "Game", "name": "Watten", "numberOfPlayers": {
                      "@type": "QuantitativeValue", "minValue": 2, "maxValue": 4}}}
    metadata += '<script type="application/ld+json">' + json.dumps(structured, ensure_ascii=False) + '</script>'
    game = {"@context": "https://schema.org", "@type": "VideoGame", "@id": f"{WATTEN_ORIGIN}/watten#game",
            "name": "Watten", "url": f"{WATTEN_ORIGIN}/watten", "inLanguage": ["de", "en"],
            "gamePlatform": "Web browser", "numberOfPlayers": structured["about"]["numberOfPlayers"],
            "playMode": ["https://schema.org/MultiPlayer"], "isAccessibleForFree": True,
            "isPartOf": public_game_suite(request)}
    metadata += '<script type="application/ld+json" data-suite-discovery>' + json.dumps(game, ensure_ascii=False) + '</script>'
    content = content.replace("</head>", metadata + "</head>", 1)
    content = content.replace('{watten_public_heading}', escape(title))
    for key in ("intro", "detail", "beta", "play", "rules", "language", "guide_title", "guide_play_title", "guide_play",
                "guide_variants_title", "guide_variants", "guide_friends_title", "guide_friends"):
        content = content.replace('{watten_public_' + key + '}', escape(text[key]))
    if language == "en":
        # Translate the initial navigation too; JavaScript must not be needed
        # to turn an English discovery document into an English interface.
        for german, english in (("Spieler &amp; Ranking", "Players &amp; rankings"),
                                ("Regeln", "Rules"), ("Konto", "Account")):
            content = content.replace(f'>{german}</a>', f'>{english}</a>')
        content = content.replace('aria-label="Spiele / Games"', 'aria-label="Games"')
        content = content.replace('Sprache / Language', 'Language')
        content = content.replace('<option value="en">', '<option value="en" selected>')
    return _localized_public_links(content, language), canonical
