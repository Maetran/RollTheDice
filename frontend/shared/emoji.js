(function(){
  const QUICK_EMOJIS = [
    '👍','👎','🤞','🙏','🖕',
    '😂','😲','😡','😜','🙄','🤦','😭','🤮',
    '🎉','💩','FEIG!'
  ];

  function ensureStyles(){
    if (document.getElementById('emoji-ui-css')) return;
    const css = `
      .emoji-dock{
        position:relative;
        display:inline-flex;
        align-items:center;
        margin-left:.5rem;
      }
      .emoji-fab{
        width:40px; height:40px;
        border-radius:9999px;
        border:1px solid var(--border,#e0e0e0);
        background:#fff;
        cursor:pointer;
        display:flex; align-items:center; justify-content:center;
        padding:0; line-height:1; text-align:center;
        box-shadow:0 2px 6px rgba(0,0,0,.08);
        transition:transform .06s ease;
      }
      .emoji-fab:hover{ background:#f7faff; }
      .emoji-fab:active{ transform:scale(.96); }
      
      .emoji-panel{
        position:absolute;
        top:calc(100% + .35rem);
        left:0;
        display:none;
        grid-template-columns:repeat(4, 40px);
        gap:.35rem;
        padding:.45rem;
        background:rgba(255,255,255,.98);
        border:1px solid var(--border,#e0e0e0);
        border-radius:8px;
        box-shadow:0 12px 28px rgba(15,23,42,.16);
        z-index:3000;
      }
      .emoji-dock.open .emoji-panel{ display:grid; }
      
      .emoji-btn{
        width:40px; height:40px;
        border-radius:9999px;
        border:1px solid var(--border,#e0e0e0);
        background:#fff; cursor:pointer;
        font-size:1.05rem; line-height:1; text-align:center;
        display:flex; align-items:center; justify-content:center;
        padding:0;
        transition:transform .06s ease;
      }
      .emoji-btn-text{
        font-size:.72rem;
        font-weight:800;
        letter-spacing:0;
        color:#111827;
      }
      .emoji-btn:hover{ background:#f7faff; }
      .emoji-btn:active{ transform:scale(.96); }
      :root[data-theme="dark"] .emoji-fab,
      :root[data-theme="dark"] .emoji-btn{
        background:#f8fafc;
        border-color:#64748b;
        color:#020617;
      }
      :root[data-theme="dark"] .emoji-fab:hover,
      :root[data-theme="dark"] .emoji-btn:hover{
        background:#e2e8f0;
        border-color:#94a3b8;
      }
      /* Badge-Overlay (zentral oben, stapelbar) */
      .emoji-pop-wrap{
        position:fixed; left:50%; top:var(--emoji-pop-top, 10px); transform:translateX(-50%);
        display:flex; flex-direction:column; gap:.4rem; align-items:center;
        z-index: 3000; pointer-events:none;
      }
      .emoji-pop{
        max-width:calc(100vw - 24px);
        background:rgba(255,255,255,.95);
        color:#111827;
        border:1px solid rgba(0,0,0,.08);
        box-shadow:0 6px 18px rgba(0,0,0,.12);
        border-radius:999px;
        padding:.3rem .7rem;
        font-size:1.05rem;
        display:flex; align-items:center; gap:.45rem;
        pointer-events:auto;
        transition: opacity .3s ease, transform .3s ease;
      }
      .emoji-pop.chat-pop{
        cursor:pointer;
      }
      .emoji-pop .who{
        flex:0 0 auto;
        font-weight:700; color:#333; font-size:.95rem;
      }
      .emoji-pop .txt{
        min-width:0;
        max-width:min(520px, 70vw);
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
      }
      .emoji-pop.fade-out{
        opacity:0; transform:translateY(-6px);
      }
      @media (max-width: 480px){
        .emoji-panel{
          grid-template-columns:repeat(4, 38px);
          gap:.3rem;
          padding:.35rem;
        }
        .emoji-btn{ width:38px; height:38px; font-size:1rem; }
        .emoji-btn-text{ font-size:.68rem; }
        .emoji-pop{ font-size:1rem; }
        .emoji-pop .txt{ max-width:62vw; }
      }
    `;
    const style = document.createElement('style');
    style.id = 'emoji-ui-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function makeToolbar(onSend){
    const dock  = document.createElement('div');
    dock.className = 'emoji-dock';

    const fab = document.createElement('button');
    fab.className = 'emoji-fab';
    fab.type = 'button';
    fab.title = 'Reaktionen';
    fab.setAttribute('aria-expanded', 'false');
    fab.textContent = '😊';

    const panel = document.createElement('div');
    panel.className = 'emoji-panel';

    const closePanel = () => {
      dock.classList.remove('open');
      fab.setAttribute('aria-expanded','false');
    };

    QUICK_EMOJIS.forEach(em => {
      const b = document.createElement('button');
      b.className = 'emoji-btn';
      if (String(em).length > 2) b.classList.add('emoji-btn-text');
      b.type = 'button';
      b.textContent = em;
      b.title = `Schnellreaktion ${em}`;
      b.setAttribute('aria-label', `Schnellreaktion ${em}`);
      b.addEventListener('click', () => {
        onSend(em);
        closePanel();
      });
      panel.appendChild(b);
    });

    fab.addEventListener('click', () => {
      const open = dock.classList.toggle('open');
      fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('pointerdown', (event) => {
      if (!dock.classList.contains('open')) return;
      if (dock.contains(event.target)) return;
      closePanel();
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && dock.classList.contains('open')) {
        closePanel();
      }
    });

    dock.appendChild(fab);
    dock.appendChild(panel);
    return dock;
  }

  function ensurePopMount(){
    let m = document.getElementById('emojiPopMount');
    if (!m){
      m = document.createElement('div');
      m.id = 'emojiPopMount';
      m.className = 'emoji-pop-wrap';
      document.body.appendChild(m);
    }
    return m;
  }

  function syncPopMountPosition(){
    try {
      const header = document.querySelector('.room-page .room-header, .zilch-page .zilch-header');
      const top = header ? Math.max(10, Math.ceil(header.getBoundingClientRect().bottom + 8)) : 10;
      document.documentElement.style.setProperty('--emoji-pop-top', `${top}px`);
    } catch {}
  }

  function scrollToChat(){
    const panel = document.getElementById('chatPanel');
    const toggle = document.getElementById('chatToggle');
    const backdrop = document.getElementById('chatBackdrop');
    const count = document.getElementById('chatToggleCount');
    if (panel) {
      panel.classList.add('open');
      document.documentElement.classList.add('chat-open');
      document.body.classList.add('chat-open');
    }
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    if (backdrop) backdrop.hidden = false;
    if (count) {
      count.textContent = '0';
      count.hidden = true;
    }
    const target = panel || document.getElementById('chatBox');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const input = document.getElementById('chatInput');
    if (input) {
      try { input.focus({ preventScroll: true }); }
      catch { input.focus(); }
    }
  }

  function playerNameMarkup(name, achievementRank){
    if (typeof window.ZDWA_PLAYER_NAME_MARKUP === 'function') {
      return window.ZDWA_PLAYER_NAME_MARKUP(
        { name, achievement_rank: achievementRank },
        { compactRank: true, fallback: 'Spieler' },
      );
    }
    return escapeHtml(name || 'Spieler');
  }

  function showPop({from, emoji, text, kind, achievement_rank: achievementRank}, {ttlMs=5000}={}){
    ensureStyles();
    const mount = ensurePopMount();
    syncPopMountPosition();
    const el = document.createElement('div');
    const isChat = kind === 'chat';
    el.className = `emoji-pop${isChat ? ' chat-pop' : ''}`;
    const senderMarkup = playerNameMarkup(from, achievementRank);
    if (isChat) {
      el.innerHTML = `<span class="who">${senderMarkup}:</span> <span class="txt">${escapeHtml(text || '')}</span>`;
      el.addEventListener('click', scrollToChat);
    } else {
      el.innerHTML = `<span class="who">${senderMarkup}</span> <span class="em">${escapeHtml(emoji)}</span>`;
    }
    mount.appendChild(el);
    setTimeout(() => {
      el.classList.add('fade-out');
      setTimeout(() => el.remove(), 320);
    }, Math.max(1000, ttlMs|0));
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"
    }[c]));
  }

  // öffentliche API
  let _ws = null;
  let _dockEl = null; // Toolbar nur einmal erzeugen

  function init({mount, ws, getMyName}={}){
    ensureStyles();
    _ws = ws || _ws;
    const onSend = (emoji) => {
      if (!_ws) return console.warn('emojiUI: ws fehlt');
      try {
        _ws.send(JSON.stringify({ action: 'send_emoji', emoji }));
      } catch(e) {
        console.warn('emojiUI: send failed', e);
      }
    };

    const host =
      mount ||
      document.getElementById('reactionsBar') ||
      document.getElementById('roomStatusLine') ||
      document.querySelector('.room-header') ||
      document.body;

    if (!_dockEl) {
      _dockEl = makeToolbar(onSend);
    }

    const wasOpen = _dockEl.classList.contains('open');
    host.appendChild(_dockEl);

    if (wasOpen) {
      _dockEl.classList.add('open');
      const fabEl = _dockEl.querySelector('.emoji-fab');
      if (fabEl) fabEl.setAttribute('aria-expanded','true');
    }
  }

  function handleRemote(payload){
    if (!payload || !payload.emoji) return;
    showPop({
      from: payload.from || 'Spieler',
      emoji: payload.emoji,
      achievement_rank: payload.achievement_rank,
    });
  }

  function handleChat(payload){
    if (!payload || !payload.text) return;
    showPop({
      from: payload.sender || payload.from || 'Spieler',
      text: payload.text,
      kind: 'chat',
      achievement_rank: payload.achievement_rank,
    });
  }

  window.emojiUI = { init, handleRemote, handleChat };
})();
