import { avatarMarkup } from "./avatar.js";

const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const ICONS = new Set([
  "achievement", "avatar", "comeback", "cpu", "die", "dice", "duel", "flag", "flame",
  "games", "github", "history", "language", "leaderboard", "ones", "pairs", "paper", "poker",
  "push", "rules", "score", "settings", "shield", "spark", "star", "statistics", "straight",
  "switch", "target", "theme", "trophy",
]);

function t(value) {
  return window.ZDWA_I18N?.t?.(value) || String(value ?? "");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function positiveInteger(value, fallback = 1) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function localizedAchievementText(achievement, field, fallback) {
  const key = achievement[`${field}_key`];
  if (key) {
    const translated = window.ZDWA_I18N?.message?.(key) || key;
    if (translated !== key || !achievement[field]) return translated;
  }
  const source = achievement[field];
  return source ? t(source) : t(fallback);
}

function normalizedDifficulty(achievement) {
  const difficulty = String(achievement.difficulty || "").toLowerCase();
  return DIFFICULTIES.has(difficulty) ? difficulty : "medium";
}

function difficultyLabel(difficulty) {
  if (difficulty === "easy") return t("Leicht");
  if (difficulty === "hard") return t("Schwer");
  return t("Mittel");
}

function normalizedIcon(achievement) {
  const icon = String(achievement.icon_key || achievement.icon || "trophy").toLowerCase();
  return ICONS.has(icon) ? icon : "trophy";
}

function playerName(player) {
  return String(player.username || t("Unbekannter Spieler")).trim();
}

function defaultProfileUrl(player, context) {
  const userId = Number(player.id);
  if (Number.isSafeInteger(userId) && userId > 0) {
    return `/api/players/by-id/${userId}/profile?game=${context === "zilch" ? "zilch" : "zdwa"}`;
  }
  return "";
}

function internalGameUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.startsWith("//")) return "";
  try {
    const url = new URL(raw, window.location.origin);
    return url.origin === window.location.origin && /^\/ergebnis\/[^/]+$/.test(url.pathname)
      ? `${url.pathname}${url.search}${url.hash}` : "";
  } catch (_) {
    return "";
  }
}

function formattedDateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return { raw: "", label: t("Zeitpunkt nicht verfügbar") };
  return {
    raw: date.toISOString(),
    label: new Intl.DateTimeFormat(window.ZDWA_I18N?.locale?.() || "de-CH", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date),
  };
}

function pointsText(points, context) {
  const value = Number(points);
  if (!Number.isFinite(value) || value < 0) return "";
  const rounded = Math.trunc(value);
  if (context === "zilch") return `${rounded} ${t(rounded === 1 ? "Zilch-Punkt" : "Zilch-Punkte")}`;
  return `${rounded} ${t(rounded === 1 ? "Ehrenberg-Marke" : "Ehrenberg-Marken")}`;
}

function playerMarkup(player, context) {
  const label = playerName(player);
  const identity = `${avatarMarkup(player, { size: "small" })}<span class="achievement-feed-player-name" translate="no">${escapeHtml(label)}</span>`;
  const href = defaultProfileUrl(player, context);
  return href
    ? `<a class="achievement-feed-player-link" href="${escapeHtml(href)}">${identity}</a>`
    : `<span class="achievement-feed-player-link">${identity}</span>`;
}

function itemMarkup(item, options) {
  const player = plainObject(item.player);
  const achievement = plainObject(item.achievement);
  const difficulty = normalizedDifficulty(achievement);
  const title = localizedAchievementText(achievement, "title", "Achievement");
  const date = formattedDateTime(item.unlocked_at);
  const points = pointsText(achievement.points, options.context);
  const icon = normalizedIcon(achievement);
  const gameUrl = options.linkGames ? internalGameUrl(item.game_url) : "";
  const awardContents = `<span class="achievement-feed-icon achievement-feed-icon--${escapeHtml(icon)}" aria-hidden="true"></span>
      <span class="achievement-feed-award-copy"><strong>${escapeHtml(title)}</strong><span class="achievement-feed-award-meta"><span class="achievement-feed-difficulty achievement-feed-difficulty--${difficulty}">${escapeHtml(difficultyLabel(difficulty))}</span>${points ? `<span>${escapeHtml(points)}</span>` : ""}${gameUrl ? `<span class="achievement-feed-game-label">${escapeHtml(t("Partie ansehen"))}</span>` : ""}</span></span>
      ${gameUrl ? '<span class="achievement-feed-open" aria-hidden="true">›</span>' : ""}`;
  return `<article class="achievement-feed-item" data-achievement-item data-achievement-difficulty="${difficulty}">
    <div class="achievement-feed-earned">
      <div class="achievement-feed-player">${playerMarkup(player, options.context)}</div>
      <time datetime="${escapeHtml(date.raw)}">${escapeHtml(date.label)}</time>
    </div>
    ${gameUrl
      ? `<a class="achievement-feed-award" data-achievement-game-link href="${escapeHtml(gameUrl)}" aria-label="${escapeHtml(`${title} · ${t("Partie ansehen")}`)}">${awardContents}</a>`
      : `<div class="achievement-feed-award">${awardContents}</div>`}
  </article>`;
}

function paginationTokens(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const visible = new Set([1, pages, page - 1, page, page + 1]);
  const numbers = [...visible].filter(value => value >= 1 && value <= pages).sort((a, b) => a - b);
  const tokens = [];
  numbers.forEach((value, index) => {
    if (index && value - numbers[index - 1] > 1) tokens.push("ellipsis");
    tokens.push(value);
  });
  return tokens;
}

function paginationMarkup(page, pages, total) {
  if (pages <= 1) return total ? `<p class="achievement-feed-count">${escapeHtml(`${total} ${t(total === 1 ? "Freischaltung" : "Freischaltungen")}`)}</p>` : "";
  const pageButtons = paginationTokens(page, pages).map((token, index) => token === "ellipsis"
    ? `<span class="achievement-feed-page-ellipsis" aria-hidden="true" data-page-gap="${index}">…</span>`
    : `<button type="button" class="achievement-feed-page-number" data-achievement-page="${token}"${token === page ? ' aria-current="page"' : ""} aria-label="${escapeHtml(`${t("Seite")} ${token}`)}">${token}</button>`).join("");
  return `<nav class="achievement-feed-pagination" data-achievement-pagination aria-label="${escapeHtml(t("Seitennavigation der Achievements"))}">
    <p>${escapeHtml(`${t("Seite")} ${page} ${t("von")} ${pages}`)}</p>
    <div class="achievement-feed-page-buttons">
      <button type="button" data-achievement-page="${page - 1}"${page <= 1 ? " disabled" : ""}>${escapeHtml(t("Zurück"))}</button>
      ${pageButtons}
      <button type="button" data-achievement-page="${page + 1}"${page >= pages ? " disabled" : ""}>${escapeHtml(t("Weiter"))}</button>
    </div>
  </nav>`;
}

function normalizedPayload(payload, requestedPage) {
  const data = plainObject(payload);
  if (!Array.isArray(data.items)) throw new Error("Invalid achievement feed");
  const page = positiveInteger(data.page, requestedPage);
  const total = Math.max(0, Number(data.total) || 0);
  const pages = positiveInteger(data.pages, 1);
  return { items: data.items, page, total, pages };
}

export function mountAchievementFeed(mount, {
  endpoint,
  context = "zdwa",
  linkGames = false,
  autoload = true,
} = {}) {
  if (!mount || !endpoint) return null;
  const options = { context, linkGames };
  const state = { difficulty: null, page: 1, pages: 1, requestVersion: 0, loaded: false };
  mount.classList.add("achievement-feed");
  mount.dataset.achievementFeed = context;
  mount.innerHTML = `<div class="achievement-feed-heading">
      <div><p class="eyebrow">${escapeHtml(t("Community"))}</p><h2 tabindex="-1">${escapeHtml(t("Neueste Erfolge"))}</h2><p>${escapeHtml(t("Wer hat zuletzt welches Achievement verdient? Die neuesten Freischaltungen stehen zuerst."))}</p></div>
      <div class="achievement-feed-filters" role="group" aria-label="${escapeHtml(t("Achievements nach Schwierigkeit filtern"))}">
        ${["easy", "medium", "hard"].map(difficulty => `<button type="button" data-achievement-filter="${difficulty}" data-achievement-difficulty-filter="${difficulty}" aria-pressed="false">${escapeHtml(difficultyLabel(difficulty))}</button>`).join("")}
      </div>
    </div>
    <div class="achievement-feed-status" data-achievement-feed-status aria-live="polite"></div>
    <div class="achievement-feed-list" data-achievement-feed-list></div>
    <div data-achievement-feed-pagination></div>`;
  const status = mount.querySelector("[data-achievement-feed-status]");
  const list = mount.querySelector("[data-achievement-feed-list]");
  const pagination = mount.querySelector("[data-achievement-feed-pagination]");

  function syncFilters() {
    mount.querySelectorAll("[data-achievement-difficulty-filter]").forEach(button => {
      const active = button.dataset.achievementDifficultyFilter === state.difficulty;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  async function load({ focus = "" } = {}) {
    const requestVersion = state.requestVersion + 1;
    state.requestVersion = requestVersion;
    mount.setAttribute("aria-busy", "true");
    status.textContent = t("Neueste Achievements werden geladen …");
    list.replaceChildren();
    pagination.replaceChildren();
    const params = new URLSearchParams({ page: String(state.page) });
    if (state.difficulty) params.set("difficulty", state.difficulty);
    try {
      const response = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = normalizedPayload(await response.json(), state.page);
      if (requestVersion !== state.requestVersion) return;
      state.page = payload.page;
      state.pages = payload.pages;
      state.loaded = true;
      status.textContent = "";
      list.innerHTML = payload.items.length
        ? payload.items.map(item => itemMarkup(plainObject(item), options)).join("")
        : `<div class="achievement-feed-empty" role="status"><strong>${escapeHtml(t("Noch keine passenden Achievements"))}</strong><span>${escapeHtml(t("Sobald jemand ein passendes Achievement verdient, erscheint es hier."))}</span></div>`;
      pagination.innerHTML = paginationMarkup(payload.page, payload.pages, payload.total);
      if (focus === "filter") mount.querySelector(`[data-achievement-difficulty-filter="${state.difficulty || ""}"]`)?.focus();
      if (focus === "page") {
        mount.querySelector("h2")?.focus({ preventScroll: true });
        mount.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth" });
      }
    } catch (_) {
      if (requestVersion !== state.requestVersion) return;
      status.innerHTML = `<span>${escapeHtml(t("Neueste Achievements sind gerade nicht verfügbar."))}</span><button type="button" class="small ghost" data-achievement-feed-retry>${escapeHtml(t("Erneut versuchen"))}</button>`;
    } finally {
      if (requestVersion === state.requestVersion) mount.removeAttribute("aria-busy");
    }
  }

  mount.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const filter = event.target.closest("[data-achievement-difficulty-filter]");
    if (filter instanceof HTMLButtonElement) {
      const difficulty = filter.dataset.achievementDifficultyFilter;
      if (!DIFFICULTIES.has(difficulty)) return;
      state.difficulty = state.difficulty === difficulty ? null : difficulty;
      state.page = 1;
      syncFilters();
      void load({ focus: "filter" });
      return;
    }
    const pageButton = event.target.closest("[data-achievement-page]");
    if (pageButton instanceof HTMLButtonElement && !pageButton.disabled) {
      const page = positiveInteger(pageButton.dataset.achievementPage, state.page);
      if (page === state.page || page > state.pages) return;
      state.page = page;
      void load({ focus: "page" });
      return;
    }
    if (event.target.closest("[data-achievement-feed-retry]")) void load();
  });

  syncFilters();
  if (autoload) void load();
  return {
    load() {
      if (!state.loaded) return load();
      return Promise.resolve();
    },
    refresh() {
      return load();
    },
  };
}
