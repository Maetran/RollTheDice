import { DE_MESSAGES, EN, EN_MESSAGES } from "./catalog.js";
import { initializeDeploymentNotice } from "../shared/deployment-notice.js";

/*
  ZDWA localization
  -----------------
  German is the canonical source language. Every user-facing German string must
  have an English entry here. Static and dynamically inserted DOM content is
  translated automatically; dialogs and server messages use the same catalog.
*/
(function () {
  "use strict";

  const STORAGE_KEY = "zdwa_language";
  const SUPPORTED = new Set(["de", "en"]);
  let languageChangeGeneration = 0;
  let explicitLanguageChange = null;
  let languagePersistence = Promise.resolve();

  const PHRASES = Object.entries(EN)
    .filter(([source, target]) => source.length >= 8 && source !== target)
    .sort((a, b) => b[0].length - a[0].length);

  const DYNAMIC = [
    [/Normalerweise hast du pro Zug bis zu drei Würfe; im letzten freien Feld sind es fünf\. Im Hardcore-Modus gibt es pro Zug genau einen automatischen Wurf\./g, "You normally have up to three rolls per turn; for the final available field you have five. Hardcore mode gives you exactly one automatic roll per turn."],
    [/Am Zug:/g, "Turn:"],
    [/Warte auf (.+)\./g, "Waiting for $1."],
    [/(\d+)\. (.+) – (\d+) Punkte/g, "$1. $2 — $3 points"],
    [/Würfe:/g, "Rolls:"],
    [/Noch keine drei (.+)-Spiele vorhanden/g, "Fewer than three $1 games available"],
    [/Noch keine drei Spiele in diesem Modus vorhanden/g, "Fewer than three games available in this mode"],
    [/Zu wenig Daten: mindestens drei (.+)-Spiele erforderlich/g, "Not enough data: at least three $1 games required"],
    [/Zu wenig Daten: mindestens drei Spiele in diesem Modus erforderlich/g, "Not enough data: at least three games required in this mode"],
    [/Ø der letzten 3 Spiele:/g, "Average of the last 3 games:"],
    [/Felder (\d+)\/(\d+)/g, "Fields $1/$2"],
    [/(\d+) Spieler/g, "$1 players"],
    [/vor 1 Tag/g, "1 day ago"],
    [/vor (\d+) Tagen/g, "$1 days ago"],
    [/vor 1 Stunde/g, "1 hour ago"],
    [/vor (\d+) Stunden/g, "$1 hours ago"],
    [/vor 1 Minute/g, "1 minute ago"],
    [/vor (\d+) Minuten/g, "$1 minutes ago"],
    [/gerade eben/g, "just now"],
    [/Ø letzte 3:/g, "avg. last 3:"],
    [/noch keine 3 Spiele/g, "fewer than 3 games"],
    [/Trend positiv/g, "Positive trend"],
    [/Trend negativ/g, "Negative trend"],
    [/Trend stagnierend/g, "Unchanged trend"],
    [/(\d+) von (\d+) erreicht/g, "$1 of $2 achieved"],
    [/🏆 Erfolg erreicht: /g, "🏆 Achievement unlocked: "],
    [/Punkte/g, "points"],
    [/Würfel (\d+): neue Augenzahl \(1–6\)/g, "Die $1: new value (1–6)"],
    [/Superadmin: Zusatzwurf ausgeführt \(freie Würfel: (.+)\)\./g, "Superadmin: extra roll completed (free dice: $1)."],
    [/Superadmin: Würfel (\d+) von (\d+) auf (\d+) gedreht\./g, "Superadmin: die $1 changed from $2 to $3."],
    [/Superadmin aktiv • Würfel antippen = sofort setzen • (\d+) Tabellenänderung$/g, "Superadmin active • select a die to set it immediately • $1 scorecard change"],
    [/Superadmin aktiv • Würfel antippen = sofort setzen • (\d+) Tabellenänderungen$/g, "Superadmin active • select a die to set it immediately • $1 scorecard changes"],
    [/Würfel (\d+) halten oder lösen/g, "Hold or release die $1"],
    [/Würfel (\d+)/g, "Die $1"],
    [/(.+) ansagen/g, "Announce $1"],
    [/ – bereits ausgefüllt/g, " — already filled"],
    [/Pause hält das Spiel bis zu (.+) offen\. Zur Lobby bricht das Spiel ab und schickt alle zurück\./g, "Pause keeps the game available for up to $1. Return to Lobby aborts the game and sends everyone back."],
    [/Spiel pausiert\. Du kannst es innerhalb von (.+) wieder aufnehmen\./g, "Game paused. You can resume it within $1."],
    [/Spiel pausiert\. Weiter geht es, sobald wieder verbunden sind: (.+)\./g, "Game paused. Play resumes when these players reconnect: $1."],
    [/Spiel pausiert\. Weiter geht es, sobald alle Spieler wieder verbunden sind\./g, "Game paused. Play resumes when all players have reconnected."],
    [/(.+) ist gerade im Admin-Einsatz\. Die Partie pausiert, während Hilfe geleistet wird\./g, "$1 is helping as an admin. This game is paused while help is being provided."],
    [/(.+) hat das Spiel abgebrochen\./g, "$1 aborted the game."],
    [/Spiel abgebrochen/g, "Game aborted"],
    [/Spiel beendet – Sieger:/g, "Game over — Winner:"],
    [/Spiel zu Ende, es gibt folgende Platzierungen:/g, "Game over. Final standings:"],
    [/Superadmin aktiv • (\d+) Änderung/g, "Superadmin active • $1 change"],
    [/Superadmin aktiv • (\d+) Änderungen/g, "Superadmin active • $1 changes"],
    [/Spiel (.+) wurde dauerhaft gelöscht\./g, "Game $1 was permanently deleted."],
    [/Benutzername muss (\d+) bis (\d+) Zeichen lang sein/g, "The username must be between $1 and $2 characters long"],
    [/Passwort muss mindestens (\d+) Zeichen lang sein/g, "The password must be at least $1 characters long"],
    [/Ansage nicht möglich: Feld (.+) in ❗ bereits befüllt/g, "Announcement unavailable: field $1 in ❗ is already filled"],
    [/In dieser Reihe ist als Nächstes Zeile (.+) erlaubt/g, "The next permitted field in this column is row $1"],
    [/Unbekannte Aktion: (.+)/g, "Unknown action: $1"],
    [/Zuschauer hat verlassen: (.+)/g, "Spectator left: $1"],
    [/Zuschauer verbunden: (.+)/g, "Spectator connected: $1"],
    [/Stummschaltung für (.+) aufgehoben\./g, "Mute for $1 lifted."],
    [/(.+) wurde im Lobby-Chat stummgeschaltet\./g, "$1 was muted in the lobby chat."],
    [/Chat-Ausschluss für (.+) aufgehoben\./g, "Chat exclusion for $1 lifted."],
    [/(.+) wurde vom Lobby-Chat ausgeschlossen\./g, "$1 was excluded from the lobby chat."],
    [/Temporäres Passwort für (.+) \(mindestens 8 Zeichen\)/g, "Temporary password for $1 (at least 8 characters)"],
    [/Begründung für die dauerhafte Löschung \(mindestens 10 Zeichen\):/g, "Reason for permanent deletion (at least 10 characters):"],
    [/Zum endgültigen Löschen die Spiel-ID exakt eingeben:/g, "To delete permanently, enter the exact game ID:"],
    [/Spieler wurde nicht gefunden\./g, "Player not found."],
    [/Profil konnte nicht geladen werden\./g, "Unable to load profile."],
    [/Keine Ansage aktiv/g, "No active announcement"],
    [/Ansage aktiv: Nur ❗-Spalte (.+) erlaubt/g, "Announcement active: only ❗ field $1 is allowed"],
    [/Angesagt ist (.+), nicht (.+)/g, "The announced field is $1, not $2"],
    [/Spiel pausiert, bis alle Spieler wieder verbunden sind\. Es fehlen: (.+)/g, "Game paused until all players reconnect. Missing: $1"],
    [/Spiel pausiert, bis alle Spieler wieder verbunden sind/g, "Game paused until all players reconnect"],
    [/Nur direkt nach Wurf 1/g, "Only immediately after roll 1"],
    [/Keine Spiele/g, "No games"],
    [/Keine Spieler/g, "No players"]
  ];

  // Public language URLs also work when browser storage is blocked.
  function getLanguage() {
    const pageLanguage = document.documentElement?.dataset?.wattenSeoLanguage;
    if (SUPPORTED.has(pageLanguage)) return pageLanguage;
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) {}
    return SUPPORTED.has(saved) ? saved : "de";
  }

  function storeLanguage(language) {
    try {
      localStorage.setItem(STORAGE_KEY, language);
      return true;
    } catch (_) {
      return false;
    }
  }

  // A public language URL is an explicit local choice. Carry it into login and
  // other documents without writing an account preference or reloading.
  const pageLanguage = document.documentElement?.dataset?.wattenSeoLanguage;
  if (SUPPORTED.has(pageLanguage)) storeLanguage(pageLanguage);

  function locale() {
    return getLanguage() === "en" ? "en-GB" : "de-CH";
  }

  function translateString(value) {
    if (getLanguage() !== "en" || value == null) return String(value ?? "");
    const raw = String(value);
    const leading = raw.match(/^\s*/)?.[0] || "";
    const trailing = raw.match(/\s*$/)?.[0] || "";
    const core = raw.slice(leading.length, raw.length - trailing.length || undefined);
    if (!core) return raw;
    const normalized = core.replace(/\s+/g, " ");
    const catalogValue = EN[core] || EN[normalized];
    let translated = catalogValue || normalized;
    if (!catalogValue) {
      for (const [source, target] of PHRASES) {
        // MutationObserver runs this function again for text it has already
        // translated. Some German source words are prefixes of their English
        // translation (for example "Aggressiv" → "Aggressive"). Replacing
        // the source inside an already-rendered target would otherwise grow
        // the string on every observer turn and starve the page event loop.
        if (!translated.includes(target)) translated = translated.split(source).join(target);
      }
      for (const [pattern, replacement] of DYNAMIC) translated = translated.replace(pattern, replacement);
    }
    return leading + translated + trailing;
  }

  function formatMessage(key, params = {}) {
    const catalog = getLanguage() === "en" ? EN_MESSAGES : DE_MESSAGES;
    const template = catalog[String(key)] || String(key || "");
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name) => String(params?.[name] ?? ""));
  }

  function localizeWattenLink(element) {
    const page = document.documentElement?.dataset;
    if ((page?.game !== "watten" && !SUPPORTED.has(page?.wattenSeoLanguage))
        || element.tagName !== "A" || element.getAttribute("hreflang")?.toLowerCase() === "de") return;
    const href = element.getAttribute("href");
    if (!href) return;
    try {
      const base = new URL(location.href), destination = new URL(href, base);
      if (destination.origin !== base.origin || !["/watten", "/watten/regeln"].includes(destination.pathname)) return;
      destination.searchParams.set("lang", "en");
      element.setAttribute("href", destination.pathname + destination.search + destination.hash);
    } catch (_) { /* Only valid local public links inherit the page language. */ }
  }

  function translateElement(root) {
    if (getLanguage() !== "en" || !root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.parentElement && !root.parentElement.closest('script, style, [translate="no"]')) {
        const translated = translateString(root.nodeValue);
        if (translated !== root.nodeValue) root.nodeValue = translated;
      }
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll("*")] : [...root.querySelectorAll("*")];
    for (const element of elements) {
      localizeWattenLink(element);
      // Account names and other literal user content are not interface copy.
      if (element.closest('script, style, [translate="no"]')) continue;
      for (const attr of ["placeholder", "title", "aria-label"]) {
        if (element.hasAttribute(attr)) {
          const current = element.getAttribute(attr);
          const translated = translateString(current);
          if (translated !== current) element.setAttribute(attr, translated);
        }
      }
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const translated = translateString(node.nodeValue);
          if (translated !== node.nodeValue) node.nodeValue = translated;
        }
      }
    }
  }

  async function persistAccountLanguage(language, isCurrent) {
    try {
      if (!isCurrent()) return;
      const me = await fetch("/api/auth/me", { cache: "no-store" });
      if (!me.ok || !isCurrent()) return;
      const auth = await me.json();
      if (!isCurrent()) return;
      const csrf = auth?.user?.csrf_token;
      if (!auth?.authenticated || !csrf) return;
      await fetch("/api/auth/preferences/language", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ preferred_language: language }),
      });
    } catch (_) {}
  }

  async function setLanguage(language, { persist = true, reload = true } = {}) {
    if (!SUPPORTED.has(language)) return;
    const generation = ++languageChangeGeneration;
    explicitLanguageChange = generation;
    const isCurrent = () => explicitLanguageChange === generation;
    storeLanguage(language);
    document.documentElement.lang = language;
    if (persist) {
      // Keep an already sent write before the latest choice. Superseded reads
      // never send a write, and only the latest choice may reload this page.
      languagePersistence = languagePersistence.then(() => persistAccountLanguage(language, isCurrent));
      await languagePersistence;
    }
    if (!isCurrent()) return;
    if (reload && document.documentElement?.dataset?.wattenSeoLanguage) {
      const destination = new URL(location.href);
      if (language === "en") destination.searchParams.set("lang", "en");
      else destination.searchParams.delete("lang");
      location.assign(destination.href);
    } else if (reload) location.reload();
    else explicitLanguageChange = null;
  }

  function syncAccountLanguage(language) {
    // An older /me response must not undo the user's explicit selection while
    // it is being saved, or between its planned reload and navigation commit.
    if (explicitLanguageChange !== null || document.documentElement?.dataset?.wattenSeoLanguage) return false;
    if (!SUPPORTED.has(language) || language === getLanguage()) return false;
    // Without storage a reload would ask again and loop.
    if (!storeLanguage(language)) return false;
    location.reload();
    return true;
  }

  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  const nativePrompt = window.prompt.bind(window);
  window.alert = message => nativeAlert(translateString(message));
  window.confirm = message => nativeConfirm(translateString(message));
  window.prompt = (message, value) => nativePrompt(translateString(message), value);

  window.ZDWA_I18N = {
    getLanguage,
    locale,
    setLanguage,
    syncAccountLanguage,
    t: translateString,
    message: formatMessage,
    translateElement,
    catalog: EN,
  };
  document.documentElement.lang = getLanguage();
  const manifestLink = document.querySelector('link[rel="manifest"]');
  if (manifestLink && getLanguage() === "en") {
    const versionQuery = new URL(manifestLink.href, location.href).search;
    const product = manifestLink.dataset.pwaProduct;
    const prefix = ["zilch", "hausdepp", "watten"].includes(product) ? `${product}-` : "";
    const manifestPath = `/${prefix}manifest-en.webmanifest`;
    manifestLink.href = `${manifestPath}${versionQuery}`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    initializeDeploymentNotice();
    document.title = translateString(document.title);
    translateElement(document);
    for (const switcher of document.querySelectorAll("[data-language-switcher]")) {
      switcher.value = getLanguage();
      switcher.addEventListener("change", () => setLanguage(switcher.value));
    }
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "characterData") translateElement(record.target);
        if (record.type === "attributes") translateElement(record.target);
        for (const node of record.addedNodes) translateElement(node);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label"],
    });
  });
})();
