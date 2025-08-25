// static/emoji.js
// Quick‑Reactions: Toolbar + ephemere Einblendungen
//
// Verwendung (in room.html / room.js):
//   emojiUI.init({
//     mount: document.getElementById('emojiMount'),  // Container oben im Bereich
//     ws,                                             // WebSocket-Instanz
//     getMyName: () => currentPlayerName || 'Gast'    // optional
//   });
//   // und in ws.onmessage(msg):
//   //   if (data.emoji) emojiUI.handleRemote(data.emoji);

(function(){
  const QUICK_EMOJIS = ['👍','👎','🎉','😡','😜','🤞','🙏','🖕'];

  function ensureStyles(){
    if (document.getElementById('emoji-ui-css')) return;
    const css = `
      .emoji-toolbar{ display:flex; gap:.4rem; align-items:center; flex-wrap:wrap; }
      .emoji-toolbar .emoji-btn{
        border:1px solid var(--border,#e0e0e0);
        background:#fff; border-radius:.55rem; padding:.25rem .45rem; cursor:pointer;
        font-size:1.05rem; line-height:1; transition:transform .06s ease;
      }
      .emoji-toolbar .emoji-btn:hover{ background:#f7faff; }
      .emoji-toolbar .emoji-btn:active{ transform:scale(.96); }
      /* Badge-Overlay (zentral oben, stapelbar) */
      .emoji-pop-wrap{
        position:fixed; left:50%; top:10px; transform:translateX(-50%);
        display:flex; flex-direction:column; gap:.4rem; align-items:center;
        z-index: 3000; pointer-events:none;
      }
      .emoji-pop{
        background:rgba(255,255,255,.95);
        border:1px solid rgba(0,0,0,.08);
        box-shadow:0 6px 18px rgba(0,0,0,.12);
        border-radius:999px;
        padding:.3rem .7rem;
        font-size:1.05rem;
        display:flex; align-items:center; gap:.45rem;
        pointer-events:auto;
        transition: opacity .3s ease, transform .3s ease;
      }
      .emoji-pop .who{
        font-weight:700; color:#333; font-size:.95rem;
      }
      .emoji-pop.fade-out{
        opacity:0; transform:translateY(-6px);
      }
      @media (max-width: 480px){
        .emoji-toolbar .emoji-btn{ font-size:1rem; padding:.2rem .4rem; }
        .emoji-pop{ font-size:1rem; }
      }
    `;
    const style = document.createElement('style');
    style.id = 'emoji-ui-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function makeToolbar(onSend){
    const wrap = document.createElement('div');
    wrap.className = 'emoji-toolbar';
    QUICK_EMOJIS.forEach(em => {
      const b = document.createElement('button');
      b.className = 'emoji-btn';
      b.type = 'button';
      b.textContent = em;
      b.title = `Schnellreaktion ${em}`;
      b.addEventListener('click', () => onSend(em));
      wrap.appendChild(b);
    });
    return wrap;
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

  function showPop({from, emoji}, {ttlMs=5000}={}){
    ensureStyles();
    const mount = ensurePopMount();
    const el = document.createElement('div');
    el.className = 'emoji-pop';
    el.innerHTML = `<span class="who">${escapeHtml(from)}</span> <span class="em">${escapeHtml(emoji)}</span>`;
    mount.appendChild(el);
    // Auto-Remove
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

    // Toolbar in Mount einsetzen (oder oberhalb Statusbereich)
    const host = mount || document.getElementById('emojiMount') || document.getElementById('roomStatusLine') || document.body;
    host.appendChild(makeToolbar(onSend));

    // Exemplarische Selbst-Preview optional (lokal)
    // on remote kommt sowieso die Broadcast-Nachricht zurück
  }

  function handleRemote(payload){
    // payload: {from_id, from, emoji, ts}
    if (!payload || !payload.emoji) return;
    showPop({from: payload.from || 'Spieler', emoji: payload.emoji});
  }

  window.emojiUI = { init, handleRemote };
})();