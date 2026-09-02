(()=>{(function(){let h=["👍","👎","🤞","🙏","🖕","😂","😲","😡","😜","🙄","🤦","😭","🤮","🎉","💩","FEIG!"];function l(){if(document.getElementById("emoji-ui-css"))return;let e=`
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
    `,t=document.createElement("style");t.id="emoji-ui-css",t.textContent=e,document.head.appendChild(t)}function b(e){let t=document.createElement("div");t.className="emoji-dock";let o=document.createElement("button");o.className="emoji-fab",o.type="button",o.title="Reaktionen",o.setAttribute("aria-expanded","false"),o.textContent="😊";let i=document.createElement("div");i.className="emoji-panel";let r=()=>{t.classList.remove("open"),o.setAttribute("aria-expanded","false")};return h.forEach(n=>{let a=document.createElement("button");a.className="emoji-btn",String(n).length>2&&a.classList.add("emoji-btn-text"),a.type="button",a.textContent=n,a.title=`Schnellreaktion ${n}`,a.setAttribute("aria-label",`Schnellreaktion ${n}`),a.addEventListener("click",()=>{e(n),r()}),i.appendChild(a)}),o.addEventListener("click",()=>{let n=t.classList.toggle("open");o.setAttribute("aria-expanded",n?"true":"false")}),document.addEventListener("pointerdown",n=>{t.classList.contains("open")&&(t.contains(n.target)||r())},!0),document.addEventListener("keydown",n=>{n.key==="Escape"&&t.classList.contains("open")&&r()}),t.appendChild(o),t.appendChild(i),t}function g(){let e=document.getElementById("emojiPopMount");return e||(e=document.createElement("div"),e.id="emojiPopMount",e.className="emoji-pop-wrap",document.body.appendChild(e)),e}function x(){try{let e=document.querySelector(".room-page .room-header"),t=e?Math.max(10,Math.ceil(e.getBoundingClientRect().bottom+8)):10;document.documentElement.style.setProperty("--emoji-pop-top",`${t}px`)}catch{}}function j(){let e=document.getElementById("chatPanel"),t=document.getElementById("chatToggle"),o=document.getElementById("chatBackdrop"),i=document.getElementById("chatToggleCount");e&&(e.classList.add("open"),document.documentElement.classList.add("chat-open"),document.body.classList.add("chat-open")),t&&t.setAttribute("aria-expanded","true"),o&&(o.hidden=!1),i&&(i.textContent="0",i.hidden=!0);let r=e||document.getElementById("chatBox");r&&r.scrollIntoView({behavior:"smooth",block:"start"});let n=document.getElementById("chatInput");if(n)try{n.focus({preventScroll:!0})}catch{n.focus()}}function k(e,t){return typeof window.ZDWA_PLAYER_NAME_MARKUP=="function"?window.ZDWA_PLAYER_NAME_MARKUP({name:e,achievement_rank:t},{compactRank:!0,fallback:"Spieler"}):m(e||"Spieler")}function p({from:e,emoji:t,text:o,kind:i,achievement_rank:r},{ttlMs:n=5e3}={}){l();let a=g();x();let s=document.createElement("div"),u=i==="chat";s.className=`emoji-pop${u?" chat-pop":""}`;let f=k(e,r);u?(s.innerHTML=`<span class="who">${f}:</span> <span class="txt">${m(o||"")}</span>`,s.addEventListener("click",j)):s.innerHTML=`<span class="who">${f}</span> <span class="em">${m(t)}</span>`,a.appendChild(s),setTimeout(()=>{s.classList.add("fade-out"),setTimeout(()=>s.remove(),320)},Math.max(1e3,n|0))}function m(e){return String(e).replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[t])}let d=null,c=null;function w({mount:e,ws:t,getMyName:o}={}){l(),d=t||d;let i=a=>{if(!d)return console.warn("emojiUI: ws fehlt");try{d.send(JSON.stringify({action:"send_emoji",emoji:a}))}catch(s){console.warn("emojiUI: send failed",s)}},r=e||document.getElementById("reactionsBar")||document.getElementById("roomStatusLine")||document.querySelector(".room-header")||document.body;c||(c=b(i));let n=c.classList.contains("open");if(r.appendChild(c),n){c.classList.add("open");let a=c.querySelector(".emoji-fab");a&&a.setAttribute("aria-expanded","true")}}function v(e){!e||!e.emoji||p({from:e.from||"Spieler",emoji:e.emoji,achievement_rank:e.achievement_rank})}function y(e){!e||!e.text||p({from:e.sender||e.from||"Spieler",text:e.text,kind:"chat",achievement_rank:e.achievement_rank})}window.emojiUI={init:w,handleRemote:v,handleChat:y}})();})();
