// One layout contract for every product, including script-rendered headers.
const HEADERS = "header.app-nav, header.zilch-header, #hausdeppHeader, header.suite-header";
const t = value => window.ZDWA_I18N?.t?.(value) || value;

function atTable(header) {
  return document.body.classList.contains("room-page")
    || document.getElementById("hausdeppApp")?.dataset.page === "table"
    || ["table", "spectator"].includes(document.documentElement.dataset.wattenPage)
    || Boolean(header.closest(".zilch-shell--game"))
    || (document.documentElement.dataset.game === "zilch" && /\/spiel\/[^/]+/.test(location.pathname));
}

function normalizeHeader(header) {
  // Embedded rules belong to the table dialog, which already owns navigation.
  if (document.body.classList.contains("embedded-rules")) return;
  header.classList.add("suite-header");
  if (!header.id) header.id = "suiteHeader";
  const table = atTable(header);
  header.classList.toggle("suite-header--table", table);
  if (table) return;
  const brand = header.querySelector(".app-nav-brand, .zilch-brand, .hd-brand, .suite-header__brand");
  const nav = header.querySelector("nav");
  let tools = header.querySelector(".app-nav-tools, .zilch-header-tools, .hd-header-tools, .suite-header__tools");
  if (!brand || !nav) return;
  brand.classList.add("suite-header__brand");
  if (brand.classList.contains("zilch-brand")) {
    const name = brand.querySelector("span:last-child");
    if (name && name.textContent !== "Zilch") name.textContent = "Zilch";
    brand.removeAttribute("aria-label");
  }
  nav.classList.add("suite-header__nav");
  if (!tools) {
    tools = document.createElement("div");
    header.append(tools);
  }
  tools.classList.add("suite-header__tools");
  if (!tools.querySelector("[data-language-switcher]")) {
    const label = document.createElement("label");
    label.className = "language-switcher";
    label.innerHTML = '<select data-language-switcher><option value="de">DE</option><option value="en">EN</option></select>';
    const select = label.firstElementChild;
    select.setAttribute("aria-label", t("Sprache wählen"));
    select.value = window.ZDWA_I18N?.getLanguage?.() || document.documentElement.lang;
    // The shared i18n bootstrap binds controls present at DOMContentLoaded.
    if (document.readyState === "complete") {
      select.addEventListener("change", () => window.ZDWA_I18N?.setLanguage?.(select.value));
    }
    tools.prepend(label);
  }
  const language = tools.querySelector("[data-language-switcher]")?.closest("label");
  for (const option of language?.querySelectorAll("option") || []) {
    if (["de", "en"].includes(option.value) && option.textContent !== option.value.toUpperCase()) {
      option.textContent = option.value.toUpperCase();
    }
  }
  const theme = tools.querySelector("[data-theme-toggle]");
  const picker = tools.querySelector("[data-game-switch]");
  // DOM and visual order match for keyboard and screen-reader navigation.
  const controls = [language, theme, picker].filter(Boolean);
  if (controls.some((control, index) => [...tools.children].filter(child => controls.includes(child))[index] !== control)) {
    controls.forEach(control => tools.append(control));
  }
  if (!brand.querySelector("img, .logo, .zilch-brand-mark, .suite-header__icon")) {
    const icon = document.createElement("img");
    icon.className = "suite-header__icon";
    icon.alt = "";
    icon.width = 32;
    icon.height = 32;
    icon.src = "/static/icons/hausdepp-icon-192-v2.png";
    brand.prepend(icon);
  }
  // Reparent only when necessary: observers must not move focused controls.
  const ordered = [brand, tools, nav];
  if (ordered.some((node, index) => [...header.children].filter(child => ordered.includes(child))[index] !== node)) {
    header.append(...ordered);
  }
  if (header.dataset.suiteObserved) return;
  header.dataset.suiteObserved = "true";
  new MutationObserver(() => normalizeHeader(header)).observe(header, { childList: true });
  new ResizeObserver(() => {
    if (!header.classList.contains("suite-header--table")) {
      document.documentElement.style.setProperty("--suite-header-height", `${header.getBoundingClientRect().height}px`);
    }
  }).observe(header);
}

export function initializeSuiteHeader(scope = document) {
  if (scope.matches?.(HEADERS)) normalizeHeader(scope);
  scope.querySelectorAll(HEADERS).forEach(normalizeHeader);
}
