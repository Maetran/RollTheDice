(()=>{var S=new Set(["tiny","small","medium","large"]),L="/static/default-avatar.svg";function w(n){let a=Number(typeof n=="object"&&n!==null?n.user_id??n.id:n);return Number.isSafeInteger(a)&&a>0?a:null}function M(n){let a=w(n);return a?`/api/avatars/${a}`:L}function k(n){return String(n).replace(/[&<>"']/g,a=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[a])}function C(n){return n?.is_admin===!0&&w(n)!==null&&n?.type!=="cpu"&&n?.participant_type!=="cpu"}function I(){let n="Admin · Ansprechperson bei Fragen";return k(window.ZDWA_I18N?.t?.(n)||n)}function z(n){if(!C(n))return"";let a=I();return`<span class="player-admin-badge" role="img" aria-label="${a}" title="${a}"><svg viewBox="0 0 16 18" aria-hidden="true" focusable="false"><path d="M8 1 14 3v5c0 4-3 7-6 9-3-2-6-5-6-9V3Z" fill="currentColor"/><path d="m5 9 2 2 4-5" fill="none" stroke="var(--admin-badge-mark, #fff)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`}function A(n,{size:a="tiny",avatarKey:b="",showAdminBadge:x=!1}={}){let s=S.has(a)?a:"tiny",f=w(n),h=k(b),u=`<img class="player-avatar player-avatar--${s}" src="${M(n)}"${f?` data-user-avatar="${f}"`:""}${h?` data-avatar-key="${h}"`:""} alt="" width="${s==="large"?80:s==="medium"?48:s==="small"?28:20}" height="${s==="large"?80:s==="medium"?48:s==="small"?28:20}" loading="lazy" decoding="async">`,p=x?z(n):"";return p?`<span class="player-avatar-wrap">${u}${p}</span>`:u}(function(){let n=["👍","👎","🤞","🙏","🖕","😂","😲","😡","😜","🙄","🤦","😭","🤮","🎉","💩","FEIG!"];function a(){if(document.getElementById("emoji-ui-css"))return;let e=`
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
    `,t=document.createElement("style");t.id="emoji-ui-css",t.textContent=e,document.head.appendChild(t)}function b(e){let t=document.createElement("div");t.className="emoji-dock";let r=document.createElement("button");r.className="emoji-fab",r.type="button",r.title="Reaktionen",r.setAttribute("aria-expanded","false"),r.textContent="😊";let c=document.createElement("div");c.className="emoji-panel";let d=()=>{t.classList.remove("open"),r.setAttribute("aria-expanded","false")};return n.forEach(o=>{let i=document.createElement("button");i.className="emoji-btn",String(o).length>2&&i.classList.add("emoji-btn-text"),i.type="button",i.textContent=o,i.title=`Schnellreaktion ${o}`,i.setAttribute("aria-label",`Schnellreaktion ${o}`),i.addEventListener("click",()=>{e(o),d()}),c.appendChild(i)}),r.addEventListener("click",()=>{let o=t.classList.toggle("open");r.setAttribute("aria-expanded",o?"true":"false")}),document.addEventListener("pointerdown",o=>{t.classList.contains("open")&&(t.contains(o.target)||d())},!0),document.addEventListener("keydown",o=>{o.key==="Escape"&&t.classList.contains("open")&&d()}),t.appendChild(r),t.appendChild(c),t}function x(){let e=document.getElementById("emojiPopMount");return e||(e=document.createElement("div"),e.id="emojiPopMount",e.className="emoji-pop-wrap",document.body.appendChild(e)),e}function s(){try{let e=document.querySelector(".room-page .room-header, .zilch-page .zilch-header"),t=e?Math.max(10,Math.ceil(e.getBoundingClientRect().bottom+8)):10;document.documentElement.style.setProperty("--emoji-pop-top",`${t}px`)}catch{}}function f(){let e=document.getElementById("chatToggle")||document.querySelector("[data-zilch-chat-toggle]");e&&e.getAttribute("aria-expanded")!=="true"&&e.click();let t=document.getElementById("chatInput")||document.getElementById("zilchChatInput");if(t)try{t.focus({preventScroll:!0})}catch{t.focus()}}function h(e,t,r){return typeof window.ZDWA_PLAYER_NAME_MARKUP=="function"?window.ZDWA_PLAYER_NAME_MARKUP({name:e,user_id:t,is_admin:r},{showRank:!1,fallback:"Spieler",showAdminBadge:!0}):`<span class="emoji-pop-identity">${A({user_id:t,is_admin:r},{showAdminBadge:!0})}<span class="player-name-label">${p(e||"Spieler")}</span></span>`}function u({from:e,user_id:t,is_admin:r,emoji:c,text:d,kind:o},{ttlMs:i=5e3}={}){a();let v=x();s();let l=document.createElement("div"),y=o==="chat";l.className=`emoji-pop${y?" chat-pop":""}`;let j=h(e,t,r);y?(l.innerHTML=`<span class="who">${j}:</span> <span class="txt">${p(d||"")}</span>`,l.addEventListener("click",f)):l.innerHTML=`<span class="who">${j}</span> <span class="em">${p(c)}</span>`,v.appendChild(l),setTimeout(()=>{l.classList.add("fade-out"),setTimeout(()=>l.remove(),320)},Math.max(1e3,i|0))}function p(e){return String(e).replace(/[&<>"']/g,t=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[t])}let g=null,m=null;function E({mount:e,ws:t,getMyName:r}={}){a(),g=t||g;let c=i=>{if(!g)return console.warn("emojiUI: ws fehlt");try{g.send(JSON.stringify({action:"send_emoji",emoji:i}))}catch(v){console.warn("emojiUI: send failed",v)}},d=e||document.getElementById("reactionsBar")||document.getElementById("roomStatusLine")||document.querySelector(".room-header")||document.body;m||(m=b(c));let o=m.classList.contains("open");if(d.appendChild(m),o){m.classList.add("open");let i=m.querySelector(".emoji-fab");i&&i.setAttribute("aria-expanded","true")}}function _(e){!e||!e.emoji||u({from:e.from||"Spieler",user_id:e.user_id,is_admin:e.is_admin,emoji:e.emoji})}function $(e){!e||!e.text||u({from:e.sender||e.from||"Spieler",user_id:e.user_id,is_admin:e.is_admin,text:e.text,kind:"chat"})}window.emojiUI={init:E,handleRemote:_,handleChat:$}})();})();
