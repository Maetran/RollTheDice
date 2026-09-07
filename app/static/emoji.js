(()=>{(function(){let h=["👍","👎","🤞","🙏","🖕","😂","😲","😡","😜","🙄","🤦","😭","🤮","🎉","💩","FEIG!"];function p(){if(document.getElementById("emoji-ui-css"))return;let e=`
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
        width:min(34rem, calc(100vw - 24px));
      }
      .emoji-pop .who{
        flex:0 1 auto;
        min-width:0;
        max-width:min(11rem, 38vw);
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        font-weight:700; color:#333; font-size:.95rem;
      }
      .emoji-pop .player-name-with-rank,
      .emoji-pop-identity{
        display:inline-flex;
        align-items:center;
        gap:.35rem;
        min-width:0;
        max-width:100%;
        flex-wrap:nowrap;
      }
      .emoji-pop .player-avatar,
      .emoji-pop-avatar{
        width:24px;
        height:24px;
        flex:0 0 24px;
        border-radius:50%;
        object-fit:cover;
      }
      .emoji-pop .txt{
        flex:1 1 auto;
        min-width:2rem;
        max-width:none;
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
    `,t=document.createElement("style");t.id="emoji-ui-css",t.textContent=e,document.head.appendChild(t)}function g(e){let t=document.createElement("div");t.className="emoji-dock";let n=document.createElement("button");n.className="emoji-fab",n.type="button",n.title="Reaktionen",n.setAttribute("aria-expanded","false"),n.textContent="😊";let i=document.createElement("div");i.className="emoji-panel";let r=()=>{t.classList.remove("open"),n.setAttribute("aria-expanded","false")};return h.forEach(o=>{let a=document.createElement("button");a.className="emoji-btn",String(o).length>2&&a.classList.add("emoji-btn-text"),a.type="button",a.textContent=o,a.title=`Schnellreaktion ${o}`,a.setAttribute("aria-label",`Schnellreaktion ${o}`),a.addEventListener("click",()=>{e(o),r()}),i.appendChild(a)}),n.addEventListener("click",()=>{let o=t.classList.toggle("open");n.setAttribute("aria-expanded",o?"true":"false")}),document.addEventListener("pointerdown",o=>{t.classList.contains("open")&&(t.contains(o.target)||r())},!0),document.addEventListener("keydown",o=>{o.key==="Escape"&&t.classList.contains("open")&&r()}),t.appendChild(n),t.appendChild(i),t}function b(){let e=document.getElementById("emojiPopMount");return e||(e=document.createElement("div"),e.id="emojiPopMount",e.className="emoji-pop-wrap",document.body.appendChild(e)),e}function x(){try{let e=document.querySelector(".room-page .room-header, .zilch-page .zilch-header"),t=e?Math.max(10,Math.ceil(e.getBoundingClientRect().bottom+8)):10;document.documentElement.style.setProperty("--emoji-pop-top",`${t}px`)}catch{}}function j(){let e=document.getElementById("chatPanel"),t=document.getElementById("chatToggle"),n=document.getElementById("chatBackdrop"),i=document.getElementById("chatToggleCount");e&&(e.classList.add("open"),document.documentElement.classList.add("chat-open"),document.body.classList.add("chat-open")),t&&t.setAttribute("aria-expanded","true"),n&&(n.hidden=!1),i&&(i.textContent="0",i.hidden=!0);let r=e||document.getElementById("chatBox");r&&r.scrollIntoView({behavior:"smooth",block:"start"});let o=document.getElementById("chatInput");if(o)try{o.focus({preventScroll:!0})}catch{o.focus()}}function w(e){let t=Number(e);return`<img class="emoji-pop-avatar" src="${Number.isSafeInteger(t)&&t>0?`/api/avatars/${t}`:"/static/default-avatar.svg"}" alt="" width="24" height="24" loading="lazy" decoding="async">`}function y(e,t){return typeof window.ZDWA_PLAYER_NAME_MARKUP=="function"?window.ZDWA_PLAYER_NAME_MARKUP({name:e,user_id:t},{showRank:!1,fallback:"Spieler"}):`<span class="emoji-pop-identity">${w(t)}<span class="player-name-label">${l(e||"Spieler")}</span></span>`}function m({from:e,user_id:t,emoji:n,text:i,kind:r},{ttlMs:o=5e3}={}){p();let a=b();x();let s=document.createElement("div"),u=r==="chat";s.className=`emoji-pop${u?" chat-pop":""}`;let f=y(e,t);u?(s.innerHTML=`<span class="who">${f}:</span> <span class="txt">${l(i||"")}</span>`,s.addEventListener("click",j)):s.innerHTML=`<span class="who">${f}</span> <span class="em">${l(n)}</span>`,a.appendChild(s),setTimeout(()=>{s.classList.add("fade-out"),setTimeout(()=>s.remove(),320)},Math.max(1e3,o|0))}function l(e){return String(e).replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[t])}let d=null,c=null;function v({mount:e,ws:t,getMyName:n}={}){p(),d=t||d;let i=a=>{if(!d)return console.warn("emojiUI: ws fehlt");try{d.send(JSON.stringify({action:"send_emoji",emoji:a}))}catch(s){console.warn("emojiUI: send failed",s)}},r=e||document.getElementById("reactionsBar")||document.getElementById("roomStatusLine")||document.querySelector(".room-header")||document.body;c||(c=g(i));let o=c.classList.contains("open");if(r.appendChild(c),o){c.classList.add("open");let a=c.querySelector(".emoji-fab");a&&a.setAttribute("aria-expanded","true")}}function k(e){!e||!e.emoji||m({from:e.from||"Spieler",user_id:e.user_id,emoji:e.emoji})}function E(e){!e||!e.text||m({from:e.sender||e.from||"Spieler",user_id:e.user_id,text:e.text,kind:"chat"})}window.emojiUI={init:v,handleRemote:k,handleChat:E}})();})();
