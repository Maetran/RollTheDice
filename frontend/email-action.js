import {
  completePasswordReset,
  completeRegistration,
  confirmEmail,
  inspectEmailConfirmation,
  inspectPasswordReset,
  inspectRegistration,
  requestPasswordReset,
} from "./shared/auth.js";

import { EN } from "./i18n/catalog.js";

const language = (() => {
  const requested = new URLSearchParams(window.location.search).get('lang');
  if (['de', 'en'].includes(requested)) return requested;
  try {
    return localStorage.getItem("zdwa_language") === "en" ? "en" : "de";
  } catch (_) {
    return "de";
  }
})();

document.documentElement.lang = language;
// Action pages deliberately do not load the app shell or register a worker.
// Supply only the language hooks used by the shared account request helpers.
window.ZDWA_I18N = { getLanguage: () => language, t, syncAccountLanguage: () => {} };

function t(value) {
  return language === "en" ? (EN[value] || value) : value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function tokenFromFragment() {
  const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") || "";
  if (window.location.hash) {
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }
  return token;
}

function showError(container, value) {
  container.innerHTML = `<h1>${escapeHtml(document.title)}</h1><p class="connection-error" role="alert">${escapeHtml(t(value))}</p>`;
}

function successMarkup(heading, href, label) {
  return `<h1>${escapeHtml(t(heading))}</h1><p><a class="button-link primary" href="${escapeHtml(href)}">${escapeHtml(t(label))}</a></p>`;
}

async function renderRegistration(container) {
  document.title = t("Konto bestätigen");
  const token = tokenFromFragment();
  if (!token || !(await inspectRegistration(token)).valid) {
    showError(container, "Der Bestätigungslink fehlt, ist ungültig oder abgelaufen.");
    return;
  }
  container.innerHTML = `<h1>${escapeHtml(t("Konto bestätigen"))}</h1><p>${escapeHtml(t("Bitte wähle ein Passwort mit mindestens 8 Zeichen."))}</p>
    <form class="form-stack" data-password-form>
      <label>${escapeHtml(t("Neues Passwort"))}<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></label>
      <label>${escapeHtml(t("Neues Passwort wiederholen"))}<input name="confirmation" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></label>
      <button class="primary" type="submit">${escapeHtml(t("Passwort festlegen"))}</button>
      <p data-message role="status"></p>
    </form>`;
  const form = container.querySelector("form");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const password = form.elements.password.value;
    const confirmation = form.elements.confirmation.value;
    const message = form.querySelector("[data-message]");
    if (password !== confirmation) {
      message.textContent = t("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    const button = form.querySelector("button");
    button.disabled = true;
    message.textContent = t("Bitte warte …");
    try {
      await completeRegistration(token, password);
      container.innerHTML = successMarkup("Dein Konto ist bestätigt.", "/konto", "Zum Konto");
    } catch (error) {
      message.textContent = t(error.message || "Der Bestätigungslink fehlt, ist ungültig oder abgelaufen.");
    } finally {
      if (document.contains(button)) button.disabled = false;
    }
  });
}

async function renderForgotPassword(container) {
  document.title = t("Passwort vergessen");
  container.innerHTML = `<h1>${escapeHtml(t("Passwort vergessen"))}</h1><p>${escapeHtml(t("Hinterlege deine E-Mail-Adresse, damit wir dir einen Link zum Zurücksetzen senden können."))}</p>
    <form class="form-stack" data-forgot-form>
      <label>${escapeHtml(t("E-Mail-Adresse"))}<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
      <button class="primary" type="submit">${escapeHtml(t("Link zum Zurücksetzen senden"))}</button>
      <p data-message role="status"></p>
    </form>`;
  const form = container.querySelector("form");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const message = form.querySelector("[data-message]");
    const button = form.querySelector("button");
    button.disabled = true;
    message.textContent = t("Bitte warte …");
    try {
      await requestPasswordReset(form.elements.email.value.trim());
      form.reset();
      message.textContent = t("Falls die Adresse zu einem bestätigten Konto gehört, wurde ein Link gesendet.");
    } catch (error) {
      message.textContent = t(error.message || "E-Mail-Anfrage konnte nicht gesendet werden.");
    } finally {
      button.disabled = false;
    }
  });
}

async function renderPasswordReset(container) {
  document.title = t("Passwort zurücksetzen");
  const token = tokenFromFragment();
  if (!token || !(await inspectPasswordReset(token)).valid) {
    showError(container, "Dieser Passwort-Link ist ungültig oder abgelaufen.");
    return;
  }
  container.innerHTML = `<h1>${escapeHtml(t("Passwort zurücksetzen"))}</h1><p>${escapeHtml(t("Dabei werden alle Geräte abgemeldet und bisherige Passkeys entfernt. Du kannst sie danach in den Einstellungen neu hinzufügen."))}</p><form class="form-stack" data-password-form>
      <label>${escapeHtml(t("Neues Passwort"))}<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></label>
      <label>${escapeHtml(t("Neues Passwort wiederholen"))}<input name="confirmation" type="password" autocomplete="new-password" minlength="8" maxlength="256" required></label>
      <button class="primary" type="submit">${escapeHtml(t("Passwort speichern"))}</button>
      <p data-message role="status"></p>
    </form>`;
  const form = container.querySelector("form");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const password = form.elements.password.value;
    const confirmation = form.elements.confirmation.value;
    const message = form.querySelector("[data-message]");
    if (password !== confirmation) {
      message.textContent = t("Die beiden Passwörter stimmen nicht überein.");
      return;
    }
    const button = form.querySelector("button");
    button.disabled = true;
    message.textContent = t("Bitte warte …");
    try {
      await completePasswordReset(token, password);
      container.innerHTML = successMarkup("Dein Passwort wurde geändert.", "/", "Zur Anmeldung");
    } catch (error) {
      message.textContent = t(error.message || "Dieser Passwort-Link ist ungültig oder abgelaufen.");
    } finally {
      if (document.contains(button)) button.disabled = false;
    }
  });
}

async function renderEmailConfirmation(container) {
  document.title = t("E-Mail-Adresse bestätigen");
  const token = tokenFromFragment();
  if (!token || !(await inspectEmailConfirmation(token)).valid) {
    showError(container, "Dieser E-Mail-Link ist ungültig oder abgelaufen.");
    return;
  }
  container.innerHTML = `<h1>${escapeHtml(t("E-Mail-Adresse bestätigen"))}</h1><p>${escapeHtml(t("Bestätige diese Adresse für Anmeldung und Passwort-Reset."))}</p>
    <button class="primary" type="button">${escapeHtml(t("Bestätigung abschließen"))}</button><p data-message role="status"></p>`;
  const button = container.querySelector("button");
  const message = container.querySelector("[data-message]");
  button.addEventListener("click", async () => {
    button.disabled = true;
    message.textContent = t("Bitte warte …");
    try {
      await confirmEmail(token);
      container.innerHTML = successMarkup("Deine E-Mail-Adresse ist bestätigt.", "/konto", "Zum Konto");
    } catch (error) {
      message.textContent = t(error.message || "Dieser E-Mail-Link ist ungültig oder abgelaufen.");
      button.disabled = false;
    }
  });
}

async function start() {
  const container = document.querySelector("[data-email-action]");
  if (!container) return;
  document.title = t(document.title);
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = t(description.content);
  container.querySelectorAll('h1, p').forEach(element => { element.textContent = t(element.textContent); });
  try {
    switch (container.dataset.emailAction) {
      case "registration": await renderRegistration(container); break;
      case "forgot": await renderForgotPassword(container); break;
      case "reset": await renderPasswordReset(container); break;
      case "confirm-email": await renderEmailConfirmation(container); break;
      default: showError(container, "Der Bestätigungslink fehlt, ist ungültig oder abgelaufen.");
    }
  } catch (_) {
    showError(container, "Der Bestätigungslink fehlt, ist ungültig oder abgelaufen.");
  }
}

void start();
