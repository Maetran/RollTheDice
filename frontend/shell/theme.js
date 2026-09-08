(function () {
  "use strict";

  const isZilch = document.documentElement.dataset.game === "zilch";
  const STORAGE_KEY = isZilch ? "zilch_theme" : "wuerfler_theme";
  const THEMES = isZilch ? ["light", "lcars"] : ["light", "dark", "classic"];
  const DARK_COLOR = "#0b1120";
  const LIGHT_COLOR = "#f4f6f8";
  const CLASSIC_COLOR = "#31583a";
  const ZILCH_COLOR = "#542d16";
  const LCARS_COLOR = "#000000";
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const themeUi = isZilch
    ? {
      light: { icon: "◒", label: "Klassisch" },
      lcars: { icon: "✦", label: "LCARS" },
    }
    : {
      light: { icon: "☀", label: "Hell" },
      dark: { icon: "☾", label: "Dunkel" },
      classic: { icon: "⚄", label: "Classic" },
    };

  function translate(value) {
    return window.ZDWA_I18N?.t?.(value) || String(value ?? "");
  }

  function isTheme(value) {
    return THEMES.includes(value);
  }

  function storedTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return isTheme(value) ? value : null;
    } catch (_) {
      return null;
    }
  }

  function preferredTheme() {
    if (isZilch) return storedTheme() || "light";
    return storedTheme() || (media && media.matches ? "dark" : "light");
  }

  function updateThemeColor(theme) {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = isZilch
      ? theme === "lcars" ? LCARS_COLOR : ZILCH_COLOR
      : theme === "dark"
        ? DARK_COLOR
        : theme === "classic"
          ? CLASSIC_COLOR
          : LIGHT_COLOR;
  }

  function updateToggles(theme) {
    const currentIndex = THEMES.indexOf(theme);
    const current = themeUi[theme] || themeUi.light;
    const next = themeUi[THEMES[(currentIndex + 1) % THEMES.length]] || themeUi.light;
    const label = `${translate("Darstellung wechseln")}: ${translate(current.label)}. ${translate("Nächstes Design")}: ${translate(next.label)}.`;
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.dataset.themeCurrent = theme;
      button.removeAttribute("aria-pressed");
      button.setAttribute("aria-label", label);
      button.title = label;
      const icon = button.querySelector("[data-theme-icon]");
      if (icon) icon.textContent = current.icon;
    });
  }

  function applyTheme(theme) {
    const resolved = isTheme(theme) ? theme : "light";
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved === "dark" || resolved === "lcars" ? "dark" : "light";
    updateThemeColor(resolved);
    updateToggles(resolved);
  }

  function toggleTheme() {
    const current = isTheme(document.documentElement.dataset.theme)
      ? document.documentElement.dataset.theme
      : preferredTheme();
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    try { localStorage.setItem(STORAGE_KEY, next); } catch (_) {}
    applyTheme(next);
    window.dispatchEvent(new CustomEvent("zdwa:theme-changed", { detail: { theme: next } }));
  }

  applyTheme(preferredTheme());

  document.addEventListener("DOMContentLoaded", function () {
    updateToggles(document.documentElement.dataset.theme || preferredTheme());
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", toggleTheme);
    });
  });

  if (media) {
    const followSystemTheme = function () {
      if (isZilch) return;
      if (!storedTheme()) applyTheme(preferredTheme());
    };
    if (typeof media.addEventListener === "function") media.addEventListener("change", followSystemTheme);
    else if (typeof media.addListener === "function") media.addListener(followSystemTheme);
  }

  window.addEventListener("storage", function (event) {
    if (event.key === STORAGE_KEY) applyTheme(preferredTheme());
  });
})();
