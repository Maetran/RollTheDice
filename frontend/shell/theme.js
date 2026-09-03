(function () {
  "use strict";

  const STORAGE_KEY = "wuerfler_theme";
  const DARK_COLOR = "#0b1120";
  const LIGHT_COLOR = "#f4f6f8";
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function storedTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === "dark" || value === "light" ? value : null;
    } catch (_) {
      return null;
    }
  }

  function preferredTheme() {
    return storedTheme() || (media && media.matches ? "dark" : "light");
  }

  function updateThemeColor(theme) {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = theme === "dark" ? DARK_COLOR : LIGHT_COLOR;
  }

  function updateToggles(theme) {
    const dark = theme === "dark";
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-pressed", String(dark));
      button.setAttribute("aria-label", dark ? "Hellen Modus einschalten" : "Dunklen Modus einschalten");
      button.title = dark ? "Heller Modus" : "Dunkler Modus";
      const icon = button.querySelector("[data-theme-icon]");
      if (icon) icon.textContent = dark ? "☀" : "☾";
    });
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    updateThemeColor(theme);
    updateToggles(theme);
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(STORAGE_KEY, next); } catch (_) {}
    applyTheme(next);
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
      if (!storedTheme()) applyTheme(preferredTheme());
    };
    if (typeof media.addEventListener === "function") media.addEventListener("change", followSystemTheme);
    else if (typeof media.addListener === "function") media.addListener(followSystemTheme);
  }

  window.addEventListener("storage", function (event) {
    if (event.key === STORAGE_KEY) applyTheme(preferredTheme());
  });
})();
