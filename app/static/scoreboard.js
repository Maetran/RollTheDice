(()=>{var X=["1","2","3","4","5","6","S","B","ZTO","+","-","D","K","F","P","60","ZTU","T"],U=["1","2","3","4","5","6",null,null,null,"max","min",null,"kenter","full","poker","60",null,null],K=["Summe der ⚀ (nur Einsen)","Summe der ⚁ (nur Zweien)","Summe der ⚂ (nur Dreien)","Summe der ⚃ (nur Vieren)","Summe der ⚄ (nur Fünfen)","Summe der ⚅ (nur Sechsen)","Zwischensumme oben (1–6)","Bonus +30 (Normal: ≥ 60 • Hardcore: ≥ 40)","ZwTotalOben = ZwSumme + Bonus","Max: Summe aller 5 Würfel (höchster Wurf)","Min: Summe aller 5 Würfel (niedrigster Wurf)","Diff = Einsen × (Max − Min), niemals negativ","Kenter: immer 35 Punkte, wenn alle 5 Augen verschieden","Full House: 3 gleiche + 2 gleiche → 40 + 3×Augenzahl der Drilling-Augen","Poker (Vierling): ⬇︎／／⬆︎ → Punkte nur im Wurf des ersten Vierlings oder bei 5 gleichen; ❗ + aktive Poker-Ansage → Punkte in jedem späteren Wurf, solange 4/5 gleiche liegen","60 (Fünfling): 5 gleiche → 60 + 5×Augenzahl","ZwTotalUnten = Kenter + Full + Poker + 60","Reihentotal = ZwTotalOben + Diff + ZwTotalUnten"];var ee=new Set([6,7,8,11,16,17]);function ue(e){return e>=6&&e<=8?{group:"top",start:e===6,end:e===8}:e===11?{group:"diff",start:!0,end:!0}:e>=16&&e<=17?{group:"bottom",start:e===16,end:e===17}:{group:null,start:!1,end:!1}}var M=e=>{if(e===""||e===null||e===void 0)return null;let n=Number(e);return Number.isFinite(n)?n:null};function T(e,n,t){return e[`${n},${t}`]}function te(e,n,{hardcore:t=!1}={}){let r=0;for(let b=0;b<=5;b++){let y=M(T(e,b,n));y!==null&&(r+=y)}let c=r>=(t?40:60)?30:0,i=r+c,a=M(T(e,0,n)),o=M(T(e,9,n)),l=M(T(e,10,n)),f=a!==null&&o!==null&&l!==null?a*(o-l):null;f!==null&&f<0&&(f=0);let _=M(T(e,12,n))||0,w=M(T(e,13,n))||0,$=M(T(e,14,n))||0,v=M(T(e,15,n))||0,k=_+w+$+v,u=i+(f??0)+k;return{sumTop:r,bonusVal:c,totalTop:i,diff:f,sumBottom:k,totalColumn:u}}function de(e,{hardcore:n=!1}={}){return["down","free","up","ang"].reduce((r,s)=>r+te(e,s,{hardcore:n}).totalColumn,0)}function x(e){return(e&&e._mode!=null?String(e._mode).toLowerCase():"")==="2v2"}function re(e){return e?Array.isArray(e._teams)?e._teams.map(t=>({id:t.id,name:t.name||`Team ${t.id}`,members:t.members||[]})):e._teams&&typeof e._teams=="object"?Object.keys(e._teams).map(t=>{let r=e._teams[t]||{};return{id:r.id||t,name:r.name||`Team ${t}`,members:r.members||[]}}):Object.keys(e._scoreboards_by_team||{}).map(t=>({id:t,name:`Team ${t}`,members:[]})):[]}function G(e,n){let t=re(e);for(let r of t)if((r.members||[]).some(s=>String(s)===String(n)))return r.id;return null}function j(e){let n=M(e);return n===null?"":String(n)}function me(e){let o=({1:[[50,50]],2:[[30,30],[70,70]],3:[[30,30],[50,50],[70,70]],4:[[30,30],[70,30],[30,70],[70,70]],5:[[30,30],[70,30],[50,50],[30,70],[70,70]],6:[[30,30],[30,50],[30,70],[70,30],[70,50],[70,70]]}[e]||[]).map(([l,f])=>`<circle cx="${l}" cy="${f}" r="8"></circle>`).join("");return`
    <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label="Würfel ${e}">
      <rect x="5" y="5" width="90" height="90" rx="12" ry="12" fill="white" stroke="black" stroke-width="6"></rect>
      <g fill="black">${o}</g>
    </svg>
  `}function m(e){return String(e).replace(/[&<>"]/g,n=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[n])}function ne(e){let n=Number(e);return Number.isFinite(n)?new Intl.NumberFormat(window.ZDWA_I18N?.locale?.()||"de-CH",{maximumFractionDigits:0}).format(n):"0"}function fe(e,{compact:n=!1,owner:t=""}={}){let r=e?.achievement_rank;if(!r||typeof r!="object")return"";let s=String(r.key||"newbie").replace(/[^a-z0-9-]/gi,"")||"newbie",c=Math.max(0,Math.min(5,Math.trunc(Number(r.stars)||0))),i=Math.max(0,Math.trunc(Number(r.points)||0)),a=Math.max(0,Math.trunc(Number(r.points_possible)||0)),o=c?"★".repeat(c):"☆",l=window.ZDWA_I18N?.t||(w=>String(w??"")),f=l(r.title||"Newbie"),_=`${l("Rang")}: ${f} · ${ne(i)} / ${ne(a)} ${l("Ehrenberg-Marken")} · ${l("Rangabzeichen öffnen")}`;return`<span class="player-rank player-rank--${m(s)}${n?" player-rank--compact":""}" role="link" tabindex="0" data-rank-legend data-rank-key="${m(s)}" data-rank-points="${i}" data-rank-points-possible="${a}"${t?` data-rank-owner="${m(t)}"`:""} title="${m(_)}" aria-label="${m(_)}"><span class="player-rank-stars" aria-hidden="true">${o}</span><span class="player-rank-title">${m(f)}</span></span>`}function D(e,{name:n,compactRank:t=!1,fallback:r="Spieler"}={}){let s=n??e?.name??e?.username??r;return`<span class="player-name-with-rank"><span class="player-name-label">${m(s)}</span>${fe(e,{compact:t,owner:s})}</span>`}window.ZDWA_PLAYER_NAME_MARKUP=D;function ge(e,n,{myPlayerId:t,iAmTurn:r,rollsUsed:s,rollsMax:c,announcedRow4:i,canRequestCorrection:a=!1,readOnly:o=!1}={}){if(!n){e&&(e.innerHTML="");return}let l=x(n),f=document.getElementById("roomGameName"),_=e||document.getElementById("scoreOut"),w=n._dice||[],$=n._holds||[!1,!1,!1,!1,!1],v=n?._turn?.player_id||null,k=(n?._players||[]).find(p=>String(p.id)===String(v)),u=k?.name||"—",b=n?._correction||{active:!1},y=!!b.active,H=y&&String(b.player_id)===String(t);f&&(f.textContent=n?._name||"");let F=l?re(n):[],A=l?F:n._players||[];if(l){let p=G(n,t);A=A.slice().sort((d,O)=>d.id===p?-1:O.id===p?1:0)}else A=A.slice().sort((p,d)=>String(p.id)===String(t)?-1:String(d.id)===String(t)?1:0);let S=!!(n&&n._hardcore),g=Number(s??n?._rolls_used??0),B=Number(c??n?._rolls_max??3),E=!r||y||g!==1?"disabled":"",P=!r||y||g>=B?"disabled":"",L=a&&!S?'<button id="requestCorrectionBtn" class="small">Letzten Eintrag ändern</button>':"",q=o?"":`
    <div class="topbar">
      <div id="actionFeedback" class="action-feedback" role="status" aria-live="polite"></div>
      <div id="diceBar">
        <div id="mobileRowQuickActions" class="mobile-row-quick-actions" aria-label="Mobile Schnelleingabe" hidden>
          <button type="button" class="mobile-row-quick-button" data-quick-field="down" aria-label="Nächstes Feld der Abwärtsreihe eintragen" title="Abwärtsreihe schnell eintragen">⬇︎</button>
          <button type="button" class="mobile-row-quick-button" data-quick-field="up" aria-label="Nächstes Feld der Aufwärtsreihe eintragen" title="Aufwärtsreihe schnell eintragen">⬆︎</button>
        </div>
        <div class="dice-main">
          <div class="dice-row">
            ${w.map((p,d)=>`<button type="button" class="die ${$[d]?"held":""}" data-i="${d}" aria-label="Würfel ${d+1} halten oder lösen" aria-pressed="${$[d]?"true":"false"}" title="halten/lösen">${me(p||0)}</button>`).join("")}
          </div>
          <div class="dice-actions">
            ${S?"":`<button id="announceBtnInline" class="small" ${E}>Ansagen</button>`}
            ${S?"":`<button id="rollBtnInline" data-action="roll" ${P}>🎲 Würfeln</button>`}
            ${L}
          </div>
        </div>
      </div>
      ${S?"":'<section id="mobileAnnouncePicker" class="mobile-announce-picker" aria-label="Ansagefeld auswählen" hidden></section>'}
    </div>
    <div class="muted turn-status">
      <span id="mobileReactionsBar" class="mobile-reactions-host" aria-label="Reaktionen"></span>
      <span class="turn-status-text">Am Zug: ${D(k,{name:u,compactRank:!0})} • ${S?'<span class="hc-badge">Hardcore</span>':`Würfe: ${s??0}/${c??3} <span id="announceHint"></span>`}</span>
    </div>
  `,N='<div class="players-grid">';for(let p of A){let d=p.id,O=l?n._scoreboards_by_team?.[d]||{}:n._scoreboards?.[d]||{},Y=l?G(n,v)===d:String(v)===String(d),z=de(O,{hardcore:S}),W=l?G(n,t)===d:String(d)===String(t),Z="";l&&(Z=(p.members||[]).map(R=>n._players.find(V=>String(V.id)===String(R))||{id:R,name:R}).filter(Boolean).map(R=>`<span class="badge">${D(R,{compactRank:!0})}</span>`).join(" ")),N+=`
      <div class="player-card${Y?" turn":""}${W?" me":""}" data-board-id="${m(d)}">
        <div class="pc-head">
          <div class="pc-name">${l?m(p.name||"—"):D(p,{compactRank:!0,fallback:"—"})}</div>
          <div class="pc-total">Total: ${z}</div>
        </div>
        ${l?`<div class="pc-members">${Z}</div>`:""}
        <div class="table-wrap">
          <table class="grid compact">
            <thead>
              <tr>
                <th class="sticky" title="Feld"></th>
                <th title="Abwärts">⬇︎</th>
                <th title="Freireihe">／</th>
                <th title="Aufwärts">⬆︎</th>
                <th title="Angesagt">❗</th>
              </tr>
            </thead>
            <tbody>
              ${pe(O,n,{myPlayerId:t,pid:d,isMyBoard:W,iAmTurn:r,rollsUsed:s,correctionActive:y,highlightAnnounce:l?d===(n._announced_board||null):String(d)===String(n._announced_by||"")})}
            </tbody>
          </table>
        </div>
      </div>
    `}N+="</div>",(_||e).innerHTML=q+(o?"":'<div class="suggestions-area"><div id="suggestions" class="suggestions"></div></div>')+'<div id="overlayMount"></div>'+N}function pe(e,n,t){let r=n._announced_row4||null,s=(t.rollsUsed??0)>0,i=(()=>{let k=0,u=["down","free","up","ang"];for(let b=0;b<X.length;b++)if(U[b])for(let y of u){let H=`${b},${y}`,F=e[H];(F==null||F==="")&&k++}return k})()===1,a=!!(t.correctionActive&&n?._correction?.player_id&&String(n._correction.player_id)===String(t.myPlayerId)),o=!x(n)&&n._last_write_public?n._last_write_public:null,l=o&&o[t.pid]?o[t.pid]:null,f=["down","free","up","ang"],_={},w=!!(n&&n._hardcore);for(let k of f)_[k]=te(e,k,{hardcore:w});let $=Array.isArray(n?._last_write)||typeof n?._last_write=="object"?n._last_write:null,v=null;if(!x(n)&&$){for(let[k,u]of Object.entries($))if(String(k)!==String(t.myPlayerId)){v=u;break}}return X.map((k,u)=>{let b=ue(u),y=ee.has(u),H=K[u]||"";function F(g){if(u===6)return j(_[g].sumTop);if(u===7)return j(_[g].bonusVal);if(u===8)return j(_[g].totalTop);if(u===11)return _[g].diff===null?"":String(_[g].diff);if(u===16)return j(_[g].sumBottom);if(u===17)return j(_[g].totalColumn);let B=T(e,u,g);return B==null||B===""?"":String(B)}function A(g,B){let E=T(e,u,g),P=!(E==null||E===""),L=F(g),q=L!==""&&L!==void 0&&L!==null,N=U[u],p=N&&n?._admin_edits?.[t.pid]?.[`${u},${g}`]||null,d=!!(r&&B===4&&N===r&&t.highlightAnnounce),O=!t.highlightAnnounce&&Array.isArray(l)&&u===Number(l[0])&&String(g)===String(l[1]),z=!!(!x(n)&&String(t.pid)!==String(t.myPlayerId)&&Array.isArray(v)&&u===Number(v[0])&&String(g)===String(v[1])),W=ee.has(u),Z=(t.rollsUsed??0)>0,I=!!(t.correctionActive&&n?._correction?.player_id&&String(n._correction.player_id)===String(t.myPlayerId)),R=Number(n?._correction?.roll_index||0),V=!r||d||N==="poker",ae=t.isMyBoard&&!t.correctionActive&&!W&&!P&&t.iAmTurn&&(Z||i)&&(V||i),Q=t.isMyBoard&&I&&!W&&!P&&(g!=="ang"||R<=1),J=ae||Q,h=K[u]||"";W||(P?h="Bereits befüllt":t.isMyBoard?t.correctionActive&&!I?h="Gegner korrigiert – bitte warten":t.correctionActive&&I&&g==="ang"&&R>1?h="❗ im Korrekturmodus nur im 1. Wurf erlaubt":Q?h="Klicke, um deinen letzten Eintrag hierher zu verschieben":t.iAmTurn?!Z&&!i?h=(h?h+" • ":"")+"Erst würfeln":r&&!d&&!i?h="Ansage aktiv: Nur ❗ (angekündigtes Feld) ist erlaubt":J&&(h=(h?h+" • ":"")+"Klicke, um zu schreiben"):h=(h?h+" • ":"")+"Nicht an der Reihe":h="Nur dein eigenes Board ist beschreibbar");let C=["cell"];if(W&&C.push("compute"),p&&C.push("admin-edited"),d&&C.push("announced"),O&&C.push("last-write"),z&&C.push("last-write"),J&&C.push("clickable"),p){let oe=p.old??"",le=p.new??"",ce=p.by_name?` durch ${p.by_name}`:"";h=`${h?h+" • ":""}Superadmin-Änderung${ce}: ${oe} → ${le}`}let ie=N?` data-row="${u}" data-field="${g}"`:"",se=h?` title="${m(h)}"`:"";return`<td class="${C.join(" ")}"${ie}${se}>${q?m(String(L)):""}</td>`}let S=[];return b.group&&S.push(`grp-${b.group}`),b.start&&S.push("grp-start"),b.end&&S.push("grp-end"),y&&S.push("is-compute"),`
      <tr class="${S.join(" ")}">
        <td class="desc sticky${y?" compute":""}" title="${m(H)}">${m(k)}</td>        ${A("down",1)}
        ${A("free",2)}
        ${A("up",3)}
        ${A("ang",4)}
      </tr>
    `}).join("")}window.renderScoreboard=ge;function he(e){if(!e||typeof e!="object")return null;let t=(e.mode||"").toString().toLowerCase()==="2v2",r=c=>{for(let i=0;i<U.length;i++)if(U[i]===c)return i;return null},s=c=>{let i={},a={1:"down",2:"free",3:"up",4:"ang"};return(c||[]).forEach(o=>{let l=a[o.index]||null;if(!l)return;let f=o.rows||{};Object.keys(f).forEach(_=>{let w=r(_);if(w==null)return;let $=f[_];typeof $=="number"&&Number.isFinite($)&&(i[`${w},${l}`]=$)})}),i};if(t){let c=[{id:"A",name:"Team A",members:[]},{id:"B",name:"Team B",members:[]}];(e.players||[]).forEach(a=>{let o=a&&a.team?String(a.team):null;if(o==="A"||o==="B"){let l=c.find(f=>f.id===o);l&&a.id&&l.members.push(String(a.id))}});let i={};return Object.keys(e.scoreboards||{}).forEach(a=>{let o=e.scoreboards[a]||{};i[String(a)]=s(o.reihen||[])}),{_name:e.gamename||"",_mode:"2v2",_hardcore:!!e.hardcore,_players:(e.players||[]).map(a=>({id:String(a.id),name:String(a.name||"Player"),user_id:a.user_id??null,achievement_rank:a.achievement_rank||null})),_teams:c,_scoreboards_by_team:i,_scoreboards:{},_admin_edits:e.admin_edits||{},_turn:null,_dice:[0,0,0,0,0],_holds:[!1,!1,!1,!1,!1],_rolls_used:0,_rolls_max:0,_announced_row4:null,_correction:{active:!1},suggestions:[]}}else{let c={};return Object.keys(e.scoreboards||{}).forEach(i=>{let a=e.scoreboards[i]||{};c[String(i)]=s(a.reihen||[])}),{_name:e.gamename||"",_mode:e.mode,_hardcore:!!e.hardcore,_players:(e.players||[]).map(i=>({id:String(i.id),name:String(i.name||"Player"),user_id:i.user_id??null,achievement_rank:i.achievement_rank||null})),_teams:[],_scoreboards_by_team:{},_scoreboards:c,_admin_edits:e.admin_edits||{},_turn:null,_dice:[0,0,0,0,0],_holds:[!1,!1,!1,!1,!1],_rolls_used:0,_rolls_max:0,_announced_row4:null,_correction:{active:!1},suggestions:[]}}}window.renderReadOnlyFromLeaderboard=function(e,n){let t=he(n);if(!t){e&&(e.innerHTML="<div class='muted'>Kein Inhalt</div>");return}window.renderScoreboard(e,t,{myPlayerId:null,iAmTurn:!1,rollsUsed:0,rollsMax:0,announcedRow4:null,canRequestCorrection:!1,readOnly:!0}),be(e,n.players||[]),ke(e,n.chat_history||[])};function _e(e){return{points:"◆",games:"▦",score:"★",upper:"↑",row:"≡",strike:"×",sixty:"6",full:"●",poker:"♠",diff:"Δ",kenter:"◇",bonus:"+",office:"◫",night:"☾",weekend:"☀",early:"↗",statistics:"⌁",account:"✓"}[String(e||"")]||"✦"}function be(e,n){if(!e||!Array.isArray(n))return;let t=n.map(s=>{let c=new Set,i=(Array.isArray(s?.earned_achievements)?s.earned_achievements:[]).filter(a=>{if(!a||typeof a!="object")return!1;let o=String(a.key||"").trim();return!o||c.has(o)?!1:(c.add(o),!0)});return{player:s,achievements:i}}).filter(s=>s.achievements.length>0);if(t.length===0)return;let r=t.map(({player:s,achievements:c})=>{let i=c.map(a=>{let o=Math.max(0,Math.trunc(Number(a.points)||0));return`<li class="readonly-achievement-card">
        <span class="readonly-achievement-icon" aria-hidden="true">${m(_e(a.icon_key))}</span>
        <span class="readonly-achievement-copy"><strong>${m(a.name||"Erfolg")}</strong>${a.description?`<small>${m(a.description)}</small>`:""}</span>
        <span class="readonly-achievement-points">+${m(o)} ${m(o===1?"Ehrenberg-Marke":"Ehrenberg-Marken")}</span>
      </li>`}).join("");return`<section class="readonly-achievement-player" aria-label="${m(s?.name||"Spieler")}">
      <h3>${m(s?.name||"Spieler")}</h3>
      <ul class="readonly-achievement-list">${i}</ul>
    </section>`}).join("");e.insertAdjacentHTML("beforeend",`
    <section class="readonly-achievements" aria-labelledby="readonlyAchievementsTitle">
      <p class="eyebrow">Partie-Erfolge</p>
      <h2 id="readonlyAchievementsTitle">In dieser Partie erreicht</h2>
      <div class="readonly-achievement-players">${r}</div>
    </section>
  `)}function ke(e,n){if(!e||!Array.isArray(n)||n.length===0)return;let t=n.slice().reverse().map(r=>{let s=r&&r.ts?new Date(r.ts):null,c=s&&!Number.isNaN(s.getTime())?s.toLocaleTimeString(window.ZDWA_I18N?.locale?.()||[],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"",i=r&&r.sender?r.sender:"System",a=r&&r.text?r.text:"",o=r&&r.kind?String(r.kind):"chat";return`<div class="readonly-chat-line ${m(o)}">
      <span class="ts">${m(c)}</span><b>${D(r&&r.achievement_rank?{name:i,achievement_rank:r.achievement_rank}:{name:i},{compactRank:!0})}:</b> ${m(a)}
    </div>`}).join("");e.insertAdjacentHTML("beforeend",`
    <section class="readonly-chat">
      <h2>Chatverlauf</h2>
      <div class="readonly-chat-box">${t}</div>
    </section>
  `)}})();
