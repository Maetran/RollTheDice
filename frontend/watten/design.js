import { WATTEN_DESIGN_MESSAGES } from "../i18n/catalog.js";

// A small blocking head bundle restores the local choice before styles paint.
// It owns presentation only: there are no account or game requests here.
(() => {
  const html = document.documentElement;
  if (html.dataset.game !== "watten") return;
  const storageKey = "watten_design";
  const selector = "[data-watten-design-toggle]";
  const icons = {
    classic: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="m12 8 3 4-3 4-3-4z"/>',
    tirol: '<path d="m2 19 7-12 4 6 3-5 6 11H2Z"/><path d="m6 12 3 2 2-3m3 1 2 2 2-2"/>',
  };
  let design = "classic";

  function storedChoice() {
    try { return localStorage.getItem(storageKey) === "tirol" ? "tirol" : "classic"; }
    catch { return "classic"; }
  }

  function language() {
    // Once i18n has painted the document, follow its displayed language. A
    // cleared storage preference must not relabel an English page in German.
    if (window.ZDWA_I18N) return html.lang === "en" ? "en" : "de";
    const explicit = new URLSearchParams(location.search).get("lang");
    if (explicit === "de" || explicit === "en") return explicit;
    try {
      const saved = localStorage.getItem("zdwa_language");
      if (saved === "de" || saved === "en") return saved;
    } catch { /* The document language works without browser storage. */ }
    return html.lang === "en" ? "en" : "de";
  }

  function updateControls() {
    const copy = WATTEN_DESIGN_MESSAGES[language()];
    const next = design === "tirol" ? "classic" : "tirol";
    const label = `${copy.change}: ${copy[design]}. ${copy.next}: ${copy[next]}.`;
    for (const button of document.querySelectorAll(selector)) {
      button.dataset.themeCurrent = design;
      button.setAttribute("aria-label", label);
      button.title = label;
      if (!button.querySelector("[data-watten-design-glyph]")) {
        button.innerHTML = Object.entries(icons).map(([value, paths]) => `<svg data-watten-design-glyph="${value}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`).join("");
      }
      // Keep the clicked glyph in the DOM so the compact menu's outside-click
      // handler still recognises the event target as part of its header.
      for (const glyph of button.querySelectorAll("[data-watten-design-glyph]")) {
        glyph.style.display = glyph.dataset.wattenDesignGlyph === design ? "" : "none";
      }
    }
    for (const hero of document.querySelectorAll(".wt-lobby-intro")) {
      let scene = hero.querySelector(".watten-tirol-scene");
      if (!scene) {
        scene = document.createElement("div");
        scene.className = "watten-tirol-scene";
        scene.setAttribute("aria-hidden", "true");
        hero.append(scene);
      }
      scene.hidden = design !== "tirol";
      let motto = hero.querySelector(".watten-tirol-motto");
      if (!motto) {
        motto = document.createElement("p");
        motto.className = "watten-tirol-motto";
        const dialect = document.createElement("span");
        dialect.lang = "de";
        dialect.translate = false;
        dialect.textContent = WATTEN_DESIGN_MESSAGES.de.motto;
        const translation = document.createElement("span");
        translation.dataset.wattenTirolTranslation = "";
        translation.lang = "en";
        translation.translate = false;
        motto.append(dialect, translation);
        hero.append(motto);
      }
      motto.hidden = design !== "tirol";
      const translation = motto.querySelector("[data-watten-tirol-translation]");
      if (translation.textContent !== copy.mottoTranslation) translation.textContent = copy.mottoTranslation;
      translation.hidden = !copy.mottoTranslation;
    }
  }

  function apply(choice) {
    design = choice === "tirol" ? "tirol" : "classic";
    html.dataset.wattenDesign = design;
    let meta = document.querySelector('meta[name="theme-color"]');
    // Guarded Watten pages inject their PWA metadata at the end of <head>.
    // While the parser is paused here, that tag may not exist yet.
    if (!meta && document.readyState !== "loading") {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.append(meta);
    }
    if (meta) meta.content = design === "tirol" ? "#9f2936" : "#713d2c";
    updateControls();
  }

  apply(storedChoice());
  document.addEventListener("click", event => {
    if (!event.target.closest?.(selector)) return;
    const next = design === "tirol" ? "classic" : "tirol";
    try { localStorage.setItem(storageKey, next); } catch { /* Keep the live choice for this page. */ }
    apply(next);
    window.dispatchEvent(new CustomEvent("watten:design-change", { detail: { design } }));
  });
  window.addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) apply(storedChoice());
    else if (event.key === "zdwa_language") updateControls();
  });

  const start = () => {
    apply(design);
    new MutationObserver(updateControls).observe(html, { attributes: true, attributeFilter: ["lang"] });
    // Lobby authentication replaces the hero at the app root. Observe only
    // that boundary so card animations never trigger presentation work.
    const lobby = html.dataset.wattenPage === "lobby" && document.getElementById("wattenApp");
    if (lobby) new MutationObserver(updateControls).observe(lobby, { childList: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
