// Keep normal/rotated game surfaces on CSS's dynamic viewport. Only use the
// visual viewport for a keyboard: iOS can retain its old size/offset on rotation.
export function initializeGameViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  let frame = 0;
  let keyboardVisible = false;
  let layoutWidth = window.innerWidth;
  let settleTimers = [];
  const hasEditableFocus = () => {
    const element = document.activeElement;
    return element instanceof HTMLElement && (
      element.isContentEditable ||
      (element.matches('textarea, input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="hidden"])') &&
        !element.disabled && !element.readOnly)
    );
  };
  const reset = style => {
    style.removeProperty("--game-viewport-height");
    style.removeProperty("--game-viewport-top");
    style.removeProperty("--game-viewport-bottom");
  };
  const restorePageOrigin = () => {
    // iOS may leave the root scroll origin displaced after rotating a locked
    // game surface. Its native hit testing can then disagree with the paint.
    // Never move a normal document (Watten), a zoomed page or a focused input;
    // score sheets, card fans and chat histories keep their own scroll state.
    if (hasEditableFocus() || keyboardVisible ||
        !["absolute", "fixed"].includes(getComputedStyle(document.body).position) ||
        getComputedStyle(document.documentElement).overflow !== "hidden") return;
    if (window.scrollX || window.scrollY || document.documentElement.scrollTop ||
        document.documentElement.scrollLeft || document.body.scrollTop || document.body.scrollLeft) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      document.documentElement.scrollTop = document.documentElement.scrollLeft = 0;
      document.body.scrollTop = document.body.scrollLeft = 0;
    }
  };
  const update = () => {
    frame = 0;
    const style = document.documentElement.style;
    if (Math.abs(viewport.scale - 1) > .01) {
      keyboardVisible = false;
      reset(style);
      return;
    }
    const height = viewport.height;
    const availableOffset = window.innerHeight - height;
    // A small toolbar/safe-area discrepancy is not a software keyboard. Reject
    // metrics from the previous orientation before applying them to fixed UI.
    const keyboardGeometry = Number.isFinite(height) && height > 0 &&
      Math.abs(viewport.width - window.innerWidth) <= 2 && availableOffset > 100;
    keyboardVisible = keyboardGeometry && (hasEditableFocus() || keyboardVisible);
    if (!keyboardVisible) {
      reset(style);
      restorePageOrigin();
      return;
    }
    // Keep tracking the dismissal animation after blur until the viewport
    // grows again; otherwise the chat would jump behind the closing keyboard.
    const top = Math.min(availableOffset, Math.max(0, viewport.offsetTop || 0));
    style.setProperty("--game-viewport-height", `${height}px`);
    style.setProperty("--game-viewport-top", `${top}px`);
    style.setProperty("--game-viewport-bottom", `${availableOffset - top}px`);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const settle = () => {
    settleTimers.forEach(clearTimeout);
    // Mobile engines can finish rotating after their final resize event.
    // Resample briefly, without a permanent animation loop.
    settleTimers = [100, 250, 500, 1000].map(delay => setTimeout(schedule, delay));
    schedule();
  };
  const onRotation = () => {
    keyboardVisible = false;
    layoutWidth = window.innerWidth;
    settle();
  };
  viewport.addEventListener("resize", schedule, { passive: true });
  viewport.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", () => {
    if (window.innerWidth !== layoutWidth) onRotation();
    else settle();
  }, { passive: true });
  window.addEventListener("orientationchange", onRotation, { passive: true });
  window.screen.orientation?.addEventListener("change", onRotation);
  window.addEventListener("pageshow", onRotation, { passive: true });
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", settle);
  update();
}
