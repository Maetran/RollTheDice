import { apiFetch, escapeHtml, loadAuth } from "../shared/auth.js";
import { ADMIN_FEATURE_MESSAGES } from "../i18n/catalog.js";

async function initialize() {
const panel = document.getElementById("featuresPanel");
const logPanel = document.getElementById("featureAuditPanel");
const language = () => window.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de";
const text = key => ADMIN_FEATURE_MESSAGES[language()][key] || key;
const esc = escapeHtml;
const gameNames = { suite: "Suite", zdwa: "ZDWA", zilch: "Zilch", hausdepp: "Hausdepp", watten: "Watten" };
let snapshot = null;
let revision = 0;
let pending = false;
let suspended = false;
let mountedAuth;
try { mountedAuth = await loadAuth(); } catch (_) { message(text("loadFailed"), true); return; }
const viewerId = mountedAuth?.authenticated && mountedAuth.user?.is_admin ? mountedAuth.user.id : null;
const expectedHeaders = { "X-Account-Expected-Id": String(viewerId) };

function message(value, error = false) {
  for (const id of ["featureFeedback", "featureAuditFeedback"]) {
    const output = document.getElementById(id);
    output.textContent = value;
    output.classList.toggle("error", error);
  }
}

function retire() {
  suspended = true;
  revision += 1;
  pending = false;
  snapshot = null;
  panel.setAttribute("aria-busy", "false");
  logPanel.setAttribute("aria-busy", "false");
  document.getElementById("featureGroups").replaceChildren();
  document.getElementById("featureAuditRows").replaceChildren();
  message(text("accessLost"), true);
}

function localized(value) {
  return typeof value === "object" && value ? value[language()] || value.de || "" : String(value || "");
}

function timestamp(value) {
  const date = value && new Date(value);
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString(language() === "en" ? "en-GB" : "de-CH") : "–";
}

function renderAudit() {
  if (!logPanel) return;
  const audit = snapshot?.audit || [];
  const summary = value => [value?.status && text(value.status), `${text("beta")}: ${text(value?.beta ? "on" : "offLabel")}`].filter(Boolean).join(" · ");
  document.getElementById("featureAuditRows").innerHTML = audit.length ? audit.map(entry => {
    const feature = snapshot.features.find(item => item.key === entry.key);
    const label = feature ? localized(feature.label) : gameNames[entry.key] || entry.key;
    return `<li><strong>${esc(label)}</strong><span>${esc(timestamp(entry.created_at))} · ${esc(text("actor"))}: ${esc(entry.actor_username || entry.actor_user_id)}</span>
    <span>${esc(summary(entry.before))} → ${esc(summary(entry.after))}</span></li>`;
  }).join("")
    : `<li>${esc(text("noHistory"))}</li>`;
}

function render() {
  if (!snapshot || suspended) return;
  const canManage = snapshot.can_manage === true;
  const disabled = !canManage || pending ? " disabled" : "";
  document.getElementById("featurePermission").textContent = text(canManage ? "ownerHint" : "adminHint");
  const features = snapshot.features || [];
  const games = snapshot.games || [];
  document.getElementById("featureGroups").innerHTML = ["suite", "zdwa", "zilch", "hausdepp", "watten"].map(game => {
    const options = features.filter(feature => feature.game === game);
    const settings = games.find(item => item.key === game);
    return `<section class="admin-feature-group" data-feature-game="${game}">
      <header><h3>${gameNames[game]}</h3>${settings ? `<form data-game-beta="${game}" class="admin-game-beta">
        <label><input name="beta" type="checkbox"${settings.beta ? " checked" : ""}${disabled}> ${esc(text("gameBeta"))}</label>
        <button class="small secondary"${disabled}>${esc(text("save"))}</button></form>` : ""}</header>
      ${options.length ? options.map(feature => `<form class="admin-feature-row" data-feature-key="${esc(feature.key)}">
        <div class="admin-feature-description"><h4>${esc(localized(feature.label))}</h4><p>${esc(localized(feature.description))}</p>
        <small>${esc(text("updated"))}: ${esc(feature.updated_at ? timestamp(feature.updated_at) : text("notChanged"))}</small></div>
        <div class="admin-feature-controls"><label>${esc(text("availability"))}<select name="status"${disabled}>
        ${["off", "internal", "public"].map(status => `<option value="${status}"${status === feature.status ? " selected" : ""}>${esc(text(status))}</option>`).join("")}
        </select></label><label class="admin-feature-beta"><input name="beta" type="checkbox"${feature.status === "public" && feature.beta ? " checked" : ""}${disabled || (feature.status !== "public" ? " disabled" : "")}> ${esc(text("featureBeta"))}</label>
        <button class="small primary"${disabled}>${esc(text("save"))}</button></div></form>`).join("") : `<p class="muted small">${esc(text("noFeatures"))}</p>`}
    </section>`;
  }).join("");
  renderAudit();
}

async function load() {
  if (pending || suspended) return;
  const current = ++revision;
  pending = true;
  panel.setAttribute("aria-busy", "true");
  logPanel.setAttribute("aria-busy", "true");
  render();
  message(text("loading"));
  try {
    const auth = await loadAuth({ refresh: true });
    if (current !== revision || suspended) return;
    if (!auth?.authenticated || auth.user?.id !== viewerId || !auth.user?.is_admin) { retire(); return; }
    const response = await apiFetch("/api/admin/features", { headers: expectedHeaders });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "access" : "load");
    const data = await response.json();
    if (current !== revision || suspended) return;
    if (data.viewer_id !== viewerId) { retire(); return; }
    snapshot = data;
    message("");
  } catch (error) {
    if (current !== revision || suspended) return;
    snapshot = null;
    document.getElementById("featureGroups").replaceChildren();
    document.getElementById("featureAuditRows").replaceChildren();
    message(text(error.message === "access" ? "accessLost" : "loadFailed"), true);
  } finally {
    if (current === revision) {
      pending = false;
      panel.setAttribute("aria-busy", "false");
      logPanel.setAttribute("aria-busy", "false");
      render();
    }
  }
}

async function save(event) {
  const form = event.target.closest("form[data-feature-key], form[data-game-beta]");
  if (!form) return;
  event.preventDefault();
  if (pending || !snapshot?.can_manage || suspended) return;
  const feature = form.dataset.featureKey;
  const game = form.dataset.gameBeta;
  const previous = feature ? snapshot.features.find(item => item.key === feature) : snapshot.games.find(item => item.key === game);
  if (!previous) return;
  const status = form.elements.status?.value;
  const body = { version: previous.version, beta: form.elements.beta.checked && (!feature || status === "public"), ...(feature ? { status } : {}) };
  const path = feature ? `/api/admin/features/${encodeURIComponent(feature)}` : `/api/admin/features/games/${encodeURIComponent(game)}/beta`;
  pending = true;
  const current = ++revision;
  render();
  message(text("saving"));
  try {
    const response = await apiFetch(path, { method: "PUT", headers: { ...expectedHeaders, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (current !== revision || suspended) return;
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      if (failure.detail === "account_changed") { retire(); return; }
      if (response.status === 401 || response.status === 403) {
        retire();
        return;
      }
      throw new Error(response.status === 409 ? "conflict" : "saveFailed");
    }
    pending = false;
    await load();
    if (snapshot && current + 1 === revision) message(text("saved"));
  } catch (error) {
    if (current === revision && !suspended) message(text(error.message in ADMIN_FEATURE_MESSAGES.de ? error.message : "saveFailed"), true);
  } finally {
    if (current === revision) { pending = false; render(); }
  }
}

if (panel) {
  panel.addEventListener("submit", save);
  panel.addEventListener("change", event => {
    if (event.target.name !== "status") return;
    const beta = event.target.form.elements.beta;
    beta.disabled = event.target.value !== "public";
    if (beta.disabled) beta.checked = false;
  });
  document.getElementById("reloadFeatures").addEventListener("click", load);
  document.getElementById("reloadFeatureAudit").addEventListener("click", load);
  new MutationObserver(() => { if (!panel.hidden || !logPanel.hidden) load(); }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  new MutationObserver(() => { if (!logPanel.hidden) load(); }).observe(logPanel, { attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("zdwa:languagechange", render);
  window.addEventListener("zdwa:auth-state", event => {
    const auth = event.detail;
    if (!auth?.authenticated || auth.user?.id !== viewerId || auth.user?.is_admin !== true
        || snapshot?.can_manage && !auth.user?.is_owner && !auth.user?.is_founder) retire();
  });
  window.addEventListener("focus", () => { if (!suspended && (!panel.hidden || !logPanel.hidden)) load(); });
  window.addEventListener("pagehide", () => {
    suspended = true;
    revision += 1;
    pending = false;
    snapshot = null;
    document.getElementById("featureGroups").replaceChildren();
    document.getElementById("featureAuditRows").replaceChildren();
  });
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    suspended = false;
    if (!panel.hidden || !logPanel.hidden) load();
  });
  if (!viewerId) retire();
  else if (!panel.hidden || !logPanel.hidden) load();
}
}

void initialize();
