// iOS leaves the layout viewport behind the keyboard. Size game surfaces
// from the visible viewport, while leaving pinch zoom under browser control.
export function initializeGameViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  let frame = 0;
  const update = () => {
    frame = 0;
    const style = document.documentElement.style;
    if (Math.abs(viewport.scale - 1) > .01) {
      style.removeProperty("--game-viewport-height");
      style.removeProperty("--game-viewport-top");
      style.removeProperty("--game-viewport-bottom");
      return;
    }
    style.setProperty("--game-viewport-height", `${viewport.height}px`);
    style.setProperty("--game-viewport-top", `${viewport.offsetTop}px`);
    style.setProperty("--game-viewport-bottom", `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  viewport.addEventListener("resize", schedule, { passive: true });
  viewport.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  update();
}
