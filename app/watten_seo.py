"""Public Watten beta documents with real initial text and stable language URLs."""

import json
import re
from html import escape

from .product_hosts import WATTEN_ORIGIN

_COPY = {
    "de": {
        "lobby_title": "Watten online [BETA] – zu zweit, zu dritt oder zu viert",
        "lobby_description": "Spiele Watten online mit Freunden oder CPUs: eigene Tische, offene und blinde Hausregeln, Teams, Bieten und Audiochat. Öffentliche Beta.",
        "rules_title": "Watten-Regeln [BETA] – Schlag, Farbe, Bieten und Nockerl",
        "rules_description": "Unsere Watten-Hausregeln für zwei, drei und vier Spieler: normale und ladinische Ansage, Blindwatten, Stiche, Bieten, Nockerl und Retourschneider.",
        "intro": "Watten im Browser – mit Freunden oder Computergegnern an einem gemeinsamen Tisch.",
        "detail": "Zwei, drei oder vier Spieler, offene oder blinde Hausregeln, manuelle Teams und Bieten. Der Audiochat verbindet alle am Tisch. Zum Spielen brauchst du ein Konto und JavaScript.",
        "beta": "Öffentliche Beta: Wir entwickeln Watten weiter.",
        "play": "Anmelden und spielen", "rules": "Hausregeln lesen", "language": "Sprache",
    },
    "en": {
        "lobby_title": "Watten online [BETA] – for two, three or four players",
        "lobby_description": "Play Watten online with friends or CPUs: create tables, use open or blind house rules, choose teams, bid and use table audio chat. Public beta.",
        "rules_title": "Watten rules [BETA] – strike, trump suit, bidding and loss marks",
        "rules_description": "Our Watten house rules for two, three and four players: normal and Ladinisch calls, blind play, tricks, bidding, Nockerl and Retourschneider.",
        "intro": "Watten in your browser, sharing a table with friends or computer players.",
        "detail": "Two, three or four players, open or blind house rules, manual teams and bidding. Table audio chat connects everyone. Playing requires an account and JavaScript.",
        "beta": "Public beta: Watten is still being developed.",
        "play": "Sign in and play", "rules": "Read the house rules", "language": "Language",
    },
}


def public_watten_metadata(content: str, *, page: str, language: str) -> tuple[str, str]:
    language = "en" if language == "en" else "de"
    text = _COPY[language]
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
                '<meta property="og:type" content="website"><meta property="og:site_name" content="Watten [BETA]">'
                f'<meta property="og:locale" content="{"en_GB" if language == "en" else "de_CH"}">'
                f'<meta property="og:image" content="{WATTEN_ORIGIN}/static/watten/icons/watten-icon-512.png">'
                '<meta name="twitter:card" content="summary">')
    structured = {"@context": "https://schema.org", "@type": "WebPage", "url": canonical,
                  "name": title, "description": description, "inLanguage": language,
                  "isPartOf": {"@type": "WebSite", "name": "Watten [BETA]", "url": f"{WATTEN_ORIGIN}/watten"},
                  "about": {"@type": "Game", "name": "Watten", "numberOfPlayers": {
                      "@type": "QuantitativeValue", "minValue": 2, "maxValue": 4}}}
    metadata += '<script type="application/ld+json">' + json.dumps(structured, ensure_ascii=False) + '</script>'
    content = content.replace("</head>", metadata + "</head>", 1)
    content = content.replace('{watten_public_heading}', escape(title))
    for key in ("intro", "detail", "beta", "play", "rules", "language"):
        content = content.replace('{watten_public_' + key + '}', escape(text[key]))
    return content, canonical
