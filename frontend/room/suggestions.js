  function renderSuggestions(suggestions){
    try{
      const mountEl = document.querySelector("#suggestions");
      if (!mountEl) return;
      const items = (suggestions || []).filter(s => s && s.eligible);
      const order = { POKER:0, SIXTY:1, FULL:2, KENTER:3, MAX:4, MIN:5 };
      const shortLabels = {
        POKER: "Poker",
        SIXTY: "60er",
        FULL: "Full",
        KENTER: "Kenter",
        MAX: "Max",
        MIN: "Min",
        "Gutes Maximum": "Max",
        "Gutes Minimum": "Min",
        "Full House": "Full"
      };
      items.sort((a,b) => (order[a.type] ?? 99) - (order[b.type] ?? 99));
      const html = items.map(s => {
        const label = shortLabels[s.type] || shortLabels[s.label] || s.label || s.type || "";
        const pts = (typeof s.points === "number") ? ` <span class="points">${s.points}</span>` : "";
        return `<div class="suggestion-btn" aria-hidden="true">${label}${pts}</div>`;
      }).join("");
      mountEl.innerHTML = html;
    } catch {}
  }

  function renderSuggestionsForSnapshot(snapshot){
    try {
      if (isRollAnimationActive()) {
        deferredSuggestionSnapshot = snapshot || null;
        renderSuggestions([]);
        return;
      }
      renderSuggestions(Array.isArray(snapshot?.suggestions) ? snapshot.suggestions : []);
    } catch {}
  }
  const localTestMode = ["127.0.0.1", "localhost"].includes(location.hostname)
    && new URLSearchParams(location.search).get("__test") === "1";
  if (localTestMode) {
    window.__rtDebugRenderSuggestionsForSnapshot = renderSuggestionsForSnapshot;
    window.__rtDebugIsLastAllowedRoll = isLastAllowedRoll;
    window.__rtDebugShowGameResults = showGameResults;
  }

  // --- DiceBar: Hold/Unhold, Roll, Correction-Request, ESC-Cancel ---
  /**
   * Verdrahtet die Würfel-Leiste: Hold/Unhold, Würfeln, Korrekturanfrage,
   * sowie ESC-Handling zum Abbrechen des Korrekturmodus.
   */
