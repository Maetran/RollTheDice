(()=>{var Q=["1","2","3","4","5","6","S","B","ZTO","+","-","D","K","F","P","60","ZTU","T"],U=["1","2","3","4","5","6",null,null,null,"max","min",null,"kenter","full","poker","60",null,null],J=["Summe der ⚀ (nur Einsen)","Summe der ⚁ (nur Zweien)","Summe der ⚂ (nur Dreien)","Summe der ⚃ (nur Vieren)","Summe der ⚄ (nur Fünfen)","Summe der ⚅ (nur Sechsen)","Zwischensumme oben (1–6)","Bonus +30 (Normal: ≥ 60 • Hardcore: ≥ 40)","ZwTotalOben = ZwSumme + Bonus","Max: Summe aller 5 Würfel (höchster Wurf)","Min: Summe aller 5 Würfel (niedrigster Wurf)","Diff = Einsen × (Max − Min), niemals negativ","Kenter: immer 35 Punkte, wenn alle 5 Augen verschieden","Full House: 3 gleiche + 2 gleiche → 40 + 3×Augenzahl der Drilling-Augen","Poker (Vierling): ⬇︎／／⬆︎ → Punkte nur im Wurf des ersten Vierlings oder bei 5 gleichen; ❗ + aktive Poker-Ansage → Punkte in jedem späteren Wurf, solange 4/5 gleiche liegen","60 (Fünfling): 5 gleiche → 60 + 5×Augenzahl","ZwTotalUnten = Kenter + Full + Poker + 60","Reihentotal = ZwTotalOben + Diff + ZwTotalUnten"];var X=new Set([6,7,8,11,16,17]);function le(e){return e>=6&&e<=8?{group:"top",start:e===6,end:e===8}:e===11?{group:"diff",start:!0,end:!0}:e>=16&&e<=17?{group:"bottom",start:e===16,end:e===17}:{group:null,start:!1,end:!1}}var A=e=>{if(e===""||e===null||e===void 0)return null;let n=Number(e);return Number.isFinite(n)?n:null};function T(e,n,t){return e[`${n},${t}`]}function K(e,n,{hardcore:t=!1}={}){let r=0;for(let f=0;f<=5;f++){let B=A(T(e,f,n));B!==null&&(r+=B)}let u=r>=(t?40:60)?30:0,o=r+u,a=A(T(e,0,n)),c=A(T(e,9,n)),l=A(T(e,10,n)),h=a!==null&&c!==null&&l!==null?a*(c-l):null;h!==null&&h<0&&(h=0);let _=A(T(e,12,n))||0,k=A(T(e,13,n))||0,w=A(T(e,14,n))||0,v=A(T(e,15,n))||0,b=_+k+w+v,i=o+(h??0)+b;return{sumTop:r,bonusVal:u,totalTop:o,diff:h,sumBottom:b,totalColumn:i}}function ce(e,{hardcore:n=!1}={}){return["down","free","up","ang"].reduce((r,g)=>r+K(e,g,{hardcore:n}).totalColumn,0)}function I(e){return(e&&e._mode!=null?String(e._mode).toLowerCase():"")==="2v2"}function ee(e){return e?Array.isArray(e._teams)?e._teams.map(t=>({id:t.id,name:t.name||`Team ${t.id}`,members:t.members||[]})):e._teams&&typeof e._teams=="object"?Object.keys(e._teams).map(t=>{let r=e._teams[t]||{};return{id:r.id||t,name:r.name||`Team ${t}`,members:r.members||[]}}):Object.keys(e._scoreboards_by_team||{}).map(t=>({id:t,name:`Team ${t}`,members:[]})):[]}function x(e,n){let t=ee(e);for(let r of t)if((r.members||[]).some(g=>String(g)===String(n)))return r.id;return null}function j(e){let n=A(e);return n===null?"":String(n)}function de(e){let c=({1:[[50,50]],2:[[30,30],[70,70]],3:[[30,30],[50,50],[70,70]],4:[[30,30],[70,30],[30,70],[70,70]],5:[[30,30],[70,30],[50,50],[30,70],[70,70]],6:[[30,30],[30,50],[30,70],[70,30],[70,50],[70,70]]}[e]||[]).map(([l,h])=>`<circle cx="${l}" cy="${h}" r="8"></circle>`).join("");return`
    <svg viewBox="0 0 100 100" width="100%" height="100%" role="img" aria-label="Würfel ${e}">
      <rect x="5" y="5" width="90" height="90" rx="12" ry="12" fill="white" stroke="black" stroke-width="6"></rect>
      <g fill="black">${c}</g>
    </svg>
  `}function S(e){return String(e).replace(/[&<>"]/g,n=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[n])}function ue(e,n,{myPlayerId:t,iAmTurn:r,rollsUsed:g,rollsMax:u,announcedRow4:o,canRequestCorrection:a=!1,readOnly:c=!1}={}){if(!n){e&&(e.innerHTML="");return}let l=I(n),h=document.getElementById("roomGameName"),_=e||document.getElementById("scoreOut"),k=n._dice||[],w=n._holds||[!1,!1,!1,!1,!1],v=n?._turn?.player_id||null,b=(n?._players||[]).find(p=>String(p.id)===String(v))?.name||"—",i=n?._correction||{active:!1},f=!!i.active,B=f&&String(i.player_id)===String(t);h&&(h.textContent=n?._name||"");let R=l?ee(n):[],$=l?R:n._players||[];if(l){let p=x(n,t);$=$.slice().sort((s,C)=>s.id===p?-1:C.id===p?1:0)}else $=$.slice().sort((p,s)=>String(p.id)===String(t)?-1:String(s.id)===String(t)?1:0);let y=!!(n&&n._hardcore),M=Number(g??n?._rolls_used??0),m=Number(u??n?._rolls_max??3),F=!r||f||M!==1?"disabled":"",E=!r||f||M>=m?"disabled":"",Z=a&&!y?'<button id="requestCorrectionBtn" class="small">Letzten Eintrag ändern</button>':"",N=c?"":`
    <div class="topbar">
      <div id="actionFeedback" class="action-feedback" role="status" aria-live="polite"></div>
      <div id="diceBar">
        <div id="mobileRowQuickActions" class="mobile-row-quick-actions" aria-label="Mobile Schnelleingabe" hidden>
          <button type="button" class="mobile-row-quick-button" data-quick-field="down" aria-label="Nächstes Feld der Abwärtsreihe eintragen" title="Abwärtsreihe schnell eintragen">⬇︎</button>
          <button type="button" class="mobile-row-quick-button" data-quick-field="up" aria-label="Nächstes Feld der Aufwärtsreihe eintragen" title="Aufwärtsreihe schnell eintragen">⬆︎</button>
        </div>
        <div class="dice-main">
          <div class="dice-row">
            ${k.map((p,s)=>`<button type="button" class="die ${w[s]?"held":""}" data-i="${s}" aria-label="Würfel ${s+1} halten oder lösen" aria-pressed="${w[s]?"true":"false"}" title="halten/lösen">${de(p||0)}</button>`).join("")}
          </div>
          <div class="dice-actions">
            ${y?"":`<button id="announceBtnInline" class="small" ${F}>Ansagen</button>`}
            ${y?"":`<button id="rollBtnInline" data-action="roll" ${E}>🎲 Würfeln</button>`}
            ${Z}
          </div>
        </div>
      </div>
      ${y?"":'<section id="mobileAnnouncePicker" class="mobile-announce-picker" aria-label="Ansagefeld auswählen" hidden></section>'}
    </div>
    <div class="muted turn-status">
      <span id="mobileReactionsBar" class="mobile-reactions-host" aria-label="Reaktionen"></span>
      <span class="turn-status-text">Am Zug: ${S(b)} • ${y?'<span class="hc-badge">Hardcore</span>':`Würfe: ${g??0}/${u??3} <span id="announceHint"></span>`}</span>
    </div>
  `,P='<div class="players-grid">';for(let p of $){let s=p.id,C=l?n._scoreboards_by_team?.[s]||{}:n._scoreboards?.[s]||{},V=l?x(n,v)===s:String(v)===String(s),z=ce(C,{hardcore:y}),D=l?x(n,t)===s:String(s)===String(t),O="";l&&(O=(p.members||[]).map(L=>n._players.find(H=>String(H.id)===String(L))?.name||L).filter(Boolean).map(L=>`<span class="badge">${S(L)}</span>`).join(" ")),P+=`
      <div class="player-card${V?" turn":""}${D?" me":""}" data-board-id="${S(s)}">
        <div class="pc-head">
          <div class="pc-name">${S(p.name||"—")}</div>
          <div class="pc-total">Total: ${z}</div>
        </div>
        ${l?`<div class="pc-members">${O}</div>`:""}
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
              ${me(C,n,{myPlayerId:t,pid:s,isMyBoard:D,iAmTurn:r,rollsUsed:g,correctionActive:f,highlightAnnounce:l?s===(n._announced_board||null):String(s)===String(n._announced_by||"")})}
            </tbody>
          </table>
        </div>
      </div>
    `}P+="</div>",(_||e).innerHTML=N+(c?"":'<div class="suggestions-area"><div id="suggestions" class="suggestions"></div></div>')+'<div id="overlayMount"></div>'+P}function me(e,n,t){let r=n._announced_row4||null,g=(t.rollsUsed??0)>0,o=(()=>{let b=0,i=["down","free","up","ang"];for(let f=0;f<Q.length;f++)if(U[f])for(let B of i){let R=`${f},${B}`,$=e[R];($==null||$==="")&&b++}return b})()===1,a=!!(t.correctionActive&&n?._correction?.player_id&&String(n._correction.player_id)===String(t.myPlayerId)),c=!I(n)&&n._last_write_public?n._last_write_public:null,l=c&&c[t.pid]?c[t.pid]:null,h=["down","free","up","ang"],_={},k=!!(n&&n._hardcore);for(let b of h)_[b]=K(e,b,{hardcore:k});let w=Array.isArray(n?._last_write)||typeof n?._last_write=="object"?n._last_write:null,v=null;if(!I(n)&&w){for(let[b,i]of Object.entries(w))if(String(b)!==String(t.myPlayerId)){v=i;break}}return Q.map((b,i)=>{let f=le(i),B=X.has(i),R=J[i]||"";function $(m){if(i===6)return j(_[m].sumTop);if(i===7)return j(_[m].bonusVal);if(i===8)return j(_[m].totalTop);if(i===11)return _[m].diff===null?"":String(_[m].diff);if(i===16)return j(_[m].sumBottom);if(i===17)return j(_[m].totalColumn);let F=T(e,i,m);return F==null||F===""?"":String(F)}function y(m,F){let E=T(e,i,m),Z=!(E==null||E===""),N=$(m),P=N!==""&&N!==void 0&&N!==null,p=U[i],s=p&&n?._admin_edits?.[t.pid]?.[`${i},${m}`]||null,C=!!(r&&F===4&&p===r&&t.highlightAnnounce),V=!t.highlightAnnounce&&Array.isArray(l)&&i===Number(l[0])&&String(m)===String(l[1]),D=!!(!I(n)&&String(t.pid)!==String(t.myPlayerId)&&Array.isArray(v)&&i===Number(v[0])&&String(m)===String(v[1])),O=X.has(i),q=(t.rollsUsed??0)>0,L=!!(t.correctionActive&&n?._correction?.player_id&&String(n._correction.player_id)===String(t.myPlayerId)),H=Number(n?._correction?.roll_index||0),ne=!r||C||p==="poker",te=t.isMyBoard&&!t.correctionActive&&!O&&!Z&&t.iAmTurn&&q&&(ne||o),G=t.isMyBoard&&L&&!O&&!Z&&(m!=="ang"||H<=1),Y=te||G,d=J[i]||"";O||(Z?d="Bereits befüllt":t.isMyBoard?t.correctionActive&&!L?d="Gegner korrigiert – bitte warten":t.correctionActive&&L&&m==="ang"&&H>1?d="❗ im Korrekturmodus nur im 1. Wurf erlaubt":G?d="Klicke, um deinen letzten Eintrag hierher zu verschieben":t.iAmTurn?q?r&&!C&&!o?d="Ansage aktiv: Nur ❗ (angekündigtes Feld) ist erlaubt":Y&&(d=(d?d+" • ":"")+"Klicke, um zu schreiben"):d=(d?d+" • ":"")+"Erst würfeln":d=(d?d+" • ":"")+"Nicht an der Reihe":d="Nur dein eigenes Board ist beschreibbar");let W=["cell"];if(O&&W.push("compute"),s&&W.push("admin-edited"),C&&W.push("announced"),V&&W.push("last-write"),D&&W.push("last-write"),Y&&W.push("clickable"),s){let oe=s.old??"",se=s.new??"",ae=s.by_name?` durch ${s.by_name}`:"";d=`${d?d+" • ":""}Superadmin-Änderung${ae}: ${oe} → ${se}`}let re=p?` data-row="${i}" data-field="${m}"`:"",ie=d?` title="${S(d)}"`:"";return`<td class="${W.join(" ")}"${re}${ie}>${P?S(String(N)):""}</td>`}let M=[];return f.group&&M.push(`grp-${f.group}`),f.start&&M.push("grp-start"),f.end&&M.push("grp-end"),B&&M.push("is-compute"),`
      <tr class="${M.join(" ")}">
        <td class="desc sticky${B?" compute":""}" title="${S(R)}">${S(b)}</td>        ${y("down",1)}
        ${y("free",2)}
        ${y("up",3)}
        ${y("ang",4)}
      </tr>
    `}).join("")}window.renderScoreboard=ue;function fe(e){if(!e||typeof e!="object")return null;let t=(e.mode||"").toString().toLowerCase()==="2v2",r=u=>{for(let o=0;o<U.length;o++)if(U[o]===u)return o;return null},g=u=>{let o={},a={1:"down",2:"free",3:"up",4:"ang"};return(u||[]).forEach(c=>{let l=a[c.index]||null;if(!l)return;let h=c.rows||{};Object.keys(h).forEach(_=>{let k=r(_);if(k==null)return;let w=h[_];typeof w=="number"&&Number.isFinite(w)&&(o[`${k},${l}`]=w)})}),o};if(t){let u=[{id:"A",name:"Team A",members:[]},{id:"B",name:"Team B",members:[]}];(e.players||[]).forEach(a=>{let c=a&&a.team?String(a.team):null;if(c==="A"||c==="B"){let l=u.find(h=>h.id===c);l&&a.id&&l.members.push(String(a.id))}});let o={};return Object.keys(e.scoreboards||{}).forEach(a=>{let c=e.scoreboards[a]||{};o[String(a)]=g(c.reihen||[])}),{_name:e.gamename||"",_mode:"2v2",_hardcore:!!e.hardcore,_players:(e.players||[]).map(a=>({id:String(a.id),name:String(a.name||"Player")})),_teams:u,_scoreboards_by_team:o,_scoreboards:{},_admin_edits:e.admin_edits||{},_turn:null,_dice:[0,0,0,0,0],_holds:[!1,!1,!1,!1,!1],_rolls_used:0,_rolls_max:0,_announced_row4:null,_correction:{active:!1},suggestions:[]}}else{let u={};return Object.keys(e.scoreboards||{}).forEach(o=>{let a=e.scoreboards[o]||{};u[String(o)]=g(a.reihen||[])}),{_name:e.gamename||"",_mode:e.mode,_hardcore:!!e.hardcore,_players:(e.players||[]).map(o=>({id:String(o.id),name:String(o.name||"Player")})),_teams:[],_scoreboards_by_team:{},_scoreboards:u,_admin_edits:e.admin_edits||{},_turn:null,_dice:[0,0,0,0,0],_holds:[!1,!1,!1,!1,!1],_rolls_used:0,_rolls_max:0,_announced_row4:null,_correction:{active:!1},suggestions:[]}}}window.renderReadOnlyFromLeaderboard=function(e,n){let t=fe(n);if(!t){e&&(e.innerHTML="<div class='muted'>Kein Inhalt</div>");return}window.renderScoreboard(e,t,{myPlayerId:null,iAmTurn:!1,rollsUsed:0,rollsMax:0,announcedRow4:null,canRequestCorrection:!1,readOnly:!0}),ge(e,n.chat_history||[])};function ge(e,n){if(!e||!Array.isArray(n)||n.length===0)return;let t=n.slice().reverse().map(r=>{let g=r&&r.ts?new Date(r.ts):null,u=g&&!Number.isNaN(g.getTime())?g.toLocaleTimeString(window.ZDWA_I18N?.locale?.()||[],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"",o=r&&r.sender?r.sender:"System",a=r&&r.text?r.text:"",c=r&&r.kind?String(r.kind):"chat";return`<div class="readonly-chat-line ${S(c)}">
      <span class="ts">${S(u)}</span><b>${S(o)}:</b> ${S(a)}
    </div>`}).join("");e.insertAdjacentHTML("beforeend",`
    <section class="readonly-chat">
      <h2>Chatverlauf</h2>
      <div class="readonly-chat-box">${t}</div>
    </section>
  `)}})();
