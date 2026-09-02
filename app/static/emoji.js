(()=>{(function(){let u=["👍","👎","🤞","🙏","🖕","😂","😲","😡","😜","🙄","🤦","😭","🤮","🎉","💩","FEIG!"];function m(){if(document.getElementById("emoji-ui-css"))return;let e=`
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
    `,t=document.createElement("style");t.id="emoji-ui-css",t.textContent=e,document.head.appendChild(t)}function f(e){let t=document.createElement("div");t.className="emoji-dock";let i=document.createElement("button");i.className="emoji-fab",i.type="button",i.title="Reaktionen",i.setAttribute("aria-expanded","false"),i.textContent="😊";let a=document.createElement("div");a.className="emoji-panel";let r=()=>{t.classList.remove("open"),i.setAttribute("aria-expanded","false")};return u.forEach(n=>{let o=document.createElement("button");o.className="emoji-btn",String(n).length>2&&o.classList.add("emoji-btn-text"),o.type="button",o.textContent=n,o.title=`Schnellreaktion ${n}`,o.setAttribute("aria-label",`Schnellreaktion ${n}`),o.addEventListener("click",()=>{e(n),r()}),a.appendChild(o)}),i.addEventListener("click",()=>{let n=t.classList.toggle("open");i.setAttribute("aria-expanded",n?"true":"false")}),document.addEventListener("pointerdown",n=>{t.classList.contains("open")&&(t.contains(n.target)||r())},!0),document.addEventListener("keydown",n=>{n.key==="Escape"&&t.classList.contains("open")&&r()}),t.appendChild(i),t.appendChild(a),t}function h(){let e=document.getElementById("emojiPopMount");return e||(e=document.createElement("div"),e.id="emojiPopMount",e.className="emoji-pop-wrap",document.body.appendChild(e)),e}function b(){try{let e=document.querySelector(".room-page .room-header"),t=e?Math.max(10,Math.ceil(e.getBoundingClientRect().bottom+8)):10;document.documentElement.style.setProperty("--emoji-pop-top",`${t}px`)}catch{}}function g(){let e=document.getElementById("chatPanel"),t=document.getElementById("chatToggle"),i=document.getElementById("chatBackdrop"),a=document.getElementById("chatToggleCount");e&&(e.classList.add("open"),document.documentElement.classList.add("chat-open"),document.body.classList.add("chat-open")),t&&t.setAttribute("aria-expanded","true"),i&&(i.hidden=!1),a&&(a.textContent="0",a.hidden=!0);let r=e||document.getElementById("chatBox");r&&r.scrollIntoView({behavior:"smooth",block:"start"});let n=document.getElementById("chatInput");if(n)try{n.focus({preventScroll:!0})}catch{n.focus()}}function p({from:e,emoji:t,text:i,kind:a},{ttlMs:r=5e3}={}){m();let n=h();b();let o=document.createElement("div"),l=a==="chat";o.className=`emoji-pop${l?" chat-pop":""}`,l?(o.innerHTML=`<span class="who">${c(e)}:</span> <span class="txt">${c(i||"")}</span>`,o.addEventListener("click",g)):o.innerHTML=`<span class="who">${c(e)}</span> <span class="em">${c(t)}</span>`,n.appendChild(o),setTimeout(()=>{o.classList.add("fade-out"),setTimeout(()=>o.remove(),320)},Math.max(1e3,r|0))}function c(e){return String(e).replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[t])}let d=null,s=null;function x({mount:e,ws:t,getMyName:i}={}){m(),d=t||d;let a=o=>{if(!d)return console.warn("emojiUI: ws fehlt");try{d.send(JSON.stringify({action:"send_emoji",emoji:o}))}catch(l){console.warn("emojiUI: send failed",l)}},r=e||document.getElementById("reactionsBar")||document.getElementById("roomStatusLine")||document.querySelector(".room-header")||document.body;s||(s=f(a));let n=s.classList.contains("open");if(r.appendChild(s),n){s.classList.add("open");let o=s.querySelector(".emoji-fab");o&&o.setAttribute("aria-expanded","true")}}function j(e){!e||!e.emoji||p({from:e.from||"Spieler",emoji:e.emoji})}function w(e){!e||!e.text||p({from:e.sender||e.from||"Spieler",text:e.text,kind:"chat"})}window.emojiUI={init:x,handleRemote:j,handleChat:w}})();})();
