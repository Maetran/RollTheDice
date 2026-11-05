// Keeps the dashboard header usable while scrolling: a disclosure menu on
// narrow layouts, an anchor offset matching the pinned header's height and
// deterministic section jumps.
export function createDashboardHeader(doc = document) {
  const header = doc.querySelector(".mission-nav");
  const toggle = doc.getElementById("dashboardMenuToggle");
  const menu = doc.getElementById("dashboardMenu");
  if (!header || !toggle || !menu) return { close() {} };
  const view = doc.defaultView;
  const compact = view.matchMedia("(max-width: 1279.98px)");

  function setOffset() {
    // A fixed sidebar (NEXUS desktop) does not cover the top of the content.
    const pinned = view.getComputedStyle(header).position === "sticky";
    doc.documentElement.style.setProperty("--dashboard-header-offset", `${pinned ? Math.ceil(header.getBoundingClientRect().height) : 0}px`);
  }

  function setOpen(open, { restoreFocus = false } = {}) {
    const active = open && compact.matches;
    header.toggleAttribute("data-menu-open", active);
    toggle.setAttribute("aria-expanded", String(active));
    if (!active && restoreFocus) toggle.focus();
  }

  function sectionTarget(link) {
    if (!link.hash || link.pathname !== view.location.pathname) return null;
    try { return doc.getElementById(decodeURIComponent(link.hash.slice(1))); } catch { return null; }
  }

  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  header.addEventListener("keydown", event => {
    if (event.key === "Escape" && header.hasAttribute("data-menu-open")) {
      event.preventDefault();
      setOpen(false, { restoreFocus: true });
    }
  });
  // Any other menu link (for example the account) simply closes the panel.
  menu.addEventListener("click", event => {
    if (event.target.closest?.("a[href]")) setOpen(false);
  });

  // Section links jump at once instead of animating: charts that render while
  // a smooth scroll is under way could otherwise stop it short of the target.
  // After the single jump nothing scrolls again, so the reader's own scrolling
  // is never overridden. Focus moves to the section heading, so a following
  // Tab continues there even when the chosen link vanished with the menu.
  // Registered after the favorites module: a pinned panel keeps its own jump.
  doc.addEventListener("click", event => {
    const link = event.target.closest?.('.mission-sections a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = sectionTarget(link);
    if (!target || target.closest("[hidden]")) return;
    event.preventDefault();
    setOpen(false);
    if (view.location.hash !== link.hash) view.history.pushState(null, "", link.hash);
    target.scrollIntoView({ block: "start", behavior: "instant" });
    const heading = target.querySelector("h2, h3") || target;
    if (!heading.matches("a, button, input, select, textarea, [tabindex]")) heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
  doc.addEventListener("click", event => {
    if (header.hasAttribute("data-menu-open") && !header.contains(event.target)) setOpen(false);
  });
  header.addEventListener("focusout", event => {
    if (header.hasAttribute("data-menu-open") && event.relatedTarget && !header.contains(event.relatedTarget)) setOpen(false);
  });
  compact.addEventListener("change", () => { setOpen(false); setOffset(); });
  new view.ResizeObserver(setOffset).observe(header);
  // Design changes switch between a pinned header and the NEXUS sidebar.
  new view.MutationObserver(setOffset).observe(doc.body, { attributes: true, attributeFilter: ["data-dashboard-design"] });
  setOffset();
  return { close: () => setOpen(false) };
}
