import { t } from "./cards.js";

const QUERY = "(orientation: landscape) and (max-width: 720px) and (max-height: 360px)";

/** A document-owned disclosure: table rerenders never replace its controls. */
export function createCompactHeader({ header = document.querySelector(".wt-header"), dom = document, win = window } = {}) {
  if (!header) return { reset() {}, destroy() {} };
  const html = dom.documentElement, media = win.matchMedia(QUERY);
  const button = dom.createElement("button");
  button.type = "button";
  button.className = "wt-compact-header-toggle";
  button.dataset.wattenHeaderToggle = "";
  button.hidden = true;
  button.innerHTML = '<span aria-hidden="true">☰</span>';
  const previousId = header.getAttribute("id");
  if (!previousId) header.id = "wattenCompactHeader";
  button.setAttribute("aria-controls", header.id);
  header.prepend(button);
  const content = () => [...header.children].filter(node => node.matches(".suite-header__brand, .suite-header__tools, .wt-nav"));
  const managed = new Map();
  let open = false, compact = false, suspended = false, destroyed = false;
  const listeners = new AbortController();

  function sync() {
    if (destroyed) return;
    const wasCompact = compact;
    const nodes = content(), hadContentFocus = nodes.some(node => node.contains(dom.activeElement));
    compact = !suspended && media.matches && html.dataset.wattenActive === "true";
    if (!compact) open = false;
    button.hidden = !compact;
    button.setAttribute("aria-expanded", String(compact && open));
    button.setAttribute("aria-label", t(open ? "header.closeMenu" : "header.openMenu"));
    button.title = button.getAttribute("aria-label");
    button.firstElementChild.textContent = open ? "×" : "☰";
    if (compact) {
      html.dataset.wtCompactHeader = "true";
      html.dataset.wtHeaderOpen = String(open);
    } else {
      delete html.dataset.wtCompactHeader;
      delete html.dataset.wtHeaderOpen;
    }
    if (compact && !open) {
      for (const node of nodes) {
        if (!managed.has(node)) managed.set(node, { inert: node.inert, hidden: node.getAttribute("aria-hidden") });
        node.inert = true;
        node.setAttribute("aria-hidden", "true");
      }
    } else {
      for (const [node, { inert, hidden }] of managed) {
        node.inert = inert;
        if (hidden === null) node.removeAttribute("aria-hidden");
        else node.setAttribute("aria-hidden", hidden);
      }
      managed.clear();
    }
    // Rotation must not leave keyboard focus inside newly collapsed controls
    // or on a toggle that has just disappeared into the normal header.
    if (compact && !open && hadContentFocus) button.focus({ preventScroll: true });
    else if (wasCompact && !compact && dom.activeElement === button && !suspended) {
      header.querySelector(".suite-header__brand")?.focus({ preventScroll: true });
    }
  }
  function close(restoreFocus = false) {
    open = false; sync();
    if (restoreFocus && compact) button.focus({ preventScroll: true });
  }
  button.addEventListener("click", () => { open = !open; sync(); }, { signal: listeners.signal });
  dom.addEventListener("keydown", event => {
    if (compact && open && event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault(); close(true);
    }
  }, { signal: listeners.signal });
  // Let outside controls finish their click before moving the floating scores
  // back to the collapsed corner; pointerdown would move a score out of reach.
  dom.addEventListener("click", event => {
    if (compact && open && !header.contains(event.target)) close();
  }, { signal: listeners.signal });
  const changed = () => { open = false; sync(); };
  media.addEventListener("change", changed);
  const observer = new MutationObserver(sync);
  observer.observe(html, { attributes: true, attributeFilter: ["data-watten-active", "lang"] });
  win.addEventListener("pagehide", () => { suspended = true; close(); }, { signal: listeners.signal });
  win.addEventListener("pageshow", () => { suspended = false; close(); }, { signal: listeners.signal });
  sync();
  return {
    reset() { close(); },
    destroy() {
      if (destroyed) return;
      suspended = true; close(); destroyed = true;
      listeners.abort(); media.removeEventListener("change", changed); observer.disconnect();
      button.remove();
      if (!previousId) header.removeAttribute("id");
    },
  };
}
