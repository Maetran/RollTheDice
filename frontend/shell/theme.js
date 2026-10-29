(function () {
  "use strict";

  // Administration owns a fixed Nexus appearance, not a game preference.
  if (document.documentElement.dataset.adminDesign === "nexus") {
    document.documentElement.style.colorScheme = "dark";
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = "#0b100f";
    return;
  }

  const isZilch = document.documentElement.dataset.game === "zilch";
  const isHausdepp = document.documentElement.dataset.game === "hausdepp";
  const STORAGE_KEY = isZilch ? "zilch_theme" : "wuerfler_theme";
  const THEMES = isZilch ? ["light", "lcars"] : ["light", "dark", "classic"];
  const DARK_COLOR = "#0b1120";
  const LIGHT_COLOR = "#f4f6f8";
  const CLASSIC_COLOR = "#31583a";
  const ZILCH_COLOR = "#2d261f";
  const LCARS_COLOR = "#0a0c12";
  // The ZDWA 2026 design has its own page colours; Classic keeps its felt bar.
  const DESIGN_2026_COLORS = { light: "#eef1ec", dark: "#11161a" };
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
    const design2026 = !isZilch && document.documentElement.dataset.design === "2026";
    meta.content = isHausdepp ? "#173e34" : isZilch
      ? theme === "lcars" ? LCARS_COLOR : ZILCH_COLOR
      : (design2026 && DESIGN_2026_COLORS[theme]) || (theme === "dark"
        ? DARK_COLOR
        : theme === "classic"
          ? CLASSIC_COLOR
          : LIGHT_COLOR);
  }

  function updateToggles(theme) {
    const currentIndex = THEMES.indexOf(theme);
    const current = themeUi[theme] || themeUi.light;
    const next = themeUi[THEMES[(currentIndex + 1) % THEMES.length]] || themeUi.light;
    const label = `${translate("Darstellung wechseln")}: ${translate(current.label)}. ${translate("Nächste Darstellung")}: ${translate(next.label)}.`;
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

  window.addEventListener("zdwa:design-change", function () {
    updateThemeColor(document.documentElement.dataset.theme || preferredTheme());
  });
})();
