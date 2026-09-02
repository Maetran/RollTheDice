import { dom, storageKeys } from "./context.js";

function syncChoices() {
  const selectedMode = dom.modeSelect.value || "1";
  for (const button of dom.modeButtons) {
    const active = button.dataset.gameMode === selectedMode;
    button.setAttribute("aria-checked", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const button of dom.hardcoreModeButtons) {
    const active = (button.dataset.hardcore === "true") === dom.hardcoreCheckbox.checked;
    button.setAttribute("aria-checked", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  if (dom.hardcoreHelp) dom.hardcoreHelp.hidden = !dom.hardcoreCheckbox.checked;
}

function moveFocus(buttons, current, direction, activate) {
  const index = buttons.indexOf(current);
  if (index < 0) return;
  const nextIndex = direction === "first"
    ? 0
    : direction === "last"
      ? buttons.length - 1
      : (index + direction + buttons.length) % buttons.length;
  activate(buttons[nextIndex]);
  buttons[nextIndex].focus();
}

function wireChoices(buttons, activate) {
  for (const button of buttons) {
    button.addEventListener("click", () => activate(button));
    button.addEventListener("keydown", (event) => {
      const direction = ["ArrowRight", "ArrowDown"].includes(event.key)
        ? 1
        : ["ArrowLeft", "ArrowUp"].includes(event.key)
          ? -1
          : event.key === "Home"
            ? "first"
            : event.key === "End"
              ? "last"
              : null;
      if (direction === null) return;
      event.preventDefault();
      moveFocus(buttons, button, direction, activate);
    });
  }
}

export function initializeGameSetup() {
  wireChoices(dom.modeButtons, (button) => {
    dom.modeSelect.value = button.dataset.gameMode;
    dom.modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  wireChoices(dom.hardcoreModeButtons, (button) => {
    dom.hardcoreCheckbox.checked = button.dataset.hardcore === "true";
    dom.hardcoreCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
  });
  dom.modeSelect.addEventListener("change", syncChoices);
  dom.hardcoreCheckbox.addEventListener("change", syncChoices);

  try {
    if (new URLSearchParams(location.search).get("new_game") === "1") {
      const defaults = JSON.parse(sessionStorage.getItem("zdwa_new_game_defaults") || "{}");
      if (["1", "2", "3", "2v2"].includes(String(defaults.mode))) {
        dom.modeSelect.value = String(defaults.mode);
      }
      dom.hardcoreCheckbox.checked = defaults.hardcore === true;
      sessionStorage.removeItem("zdwa_new_game_defaults");
      setTimeout(
        () => document.querySelector(".create-row")?.scrollIntoView({ behavior: "smooth", block: "center" }),
        100,
      );
    }
  } catch {}
  syncChoices();

  dom.nameInput.value = localStorage.getItem(storageKeys.name) || "";
  dom.nameInput.addEventListener("input", () => {
    if (!dom.nameInput.disabled) {
      localStorage.setItem(storageKeys.name, dom.nameInput.value.trim());
    }
  });
}
