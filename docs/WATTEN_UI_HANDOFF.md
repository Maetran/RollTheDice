# Watten: native human multiplayer UI package

Implement this bounded package now in `codex/watten-ui` in the existing own
worktree. Read AGENTS.md, PRODUCT_DELIVERY.md, WATTEN_OWNER_DECISIONS.md and
WATTEN_DESIGN_REFERENCES.md. The branch includes the real pure engine and runtime
through independently reviewed lifecycle fix `314fcfa`, plus root-owned local
page routes. A broad runtime audit proceeds elsewhere. Production remains closed.
No source from UltraWatten may be copied. Reuse the existing Hausdepp card art.

## Ownership

Own only these files (new unless noted):

- `frontend/watten/game.js`, `waiting-room.js`, `table.js`, `cards.js`, `motion.js`
- `frontend/styles/watten-game.css`
- `app/static/watten-game.html`, `app/static/watten-rules.html`
- existing `frontend/i18n/catalog.js` (append translations, preserve old entries)
- `tests/browser/watten-game.spec.js`

Root owns Python/backend/routes, shared route helpers, build targets, test config,
navigation tests, docs/version/release metadata and final generated asset commit.
Another agent writes disjoint backend page tests in this worktree. Do not stage
their files, reset anything, switch branches, change dependencies or spawn agents.
No production, push, billing, settings or permission changes. No external LLM.
Commit only your ten listed files when complete. Root reviews and integrates.

The root already registered `game.js`/CSS build targets. `npm run build:static`
is allowed to prepare local browser testing; leave generated bundle/fingerprint
changes unstaged for root. Templates reference `/static/watten-game.js` and
`/static/watten-game.css` (version sync supplies hashes). The game template uses
`<html lang="de" data-game="watten" data-watten-page="{watten_page}"
data-game-id="{game_id}">`. Root substitutes lobby/table/spectator and exact ID.
Rules can be static bilingual markup using the same entry module.

## Product scope in this package

Provide a complete usable human 2/3/4 journey: public local lobby/rules/account
links, native shared-account login, create/options/password, manual seating and
opposite teams, manual host start, announcements/original inspection/ACK, actual
cards, bids and responses, private partner advice, auto-Danke, scoring, next deal,
match winners, intentional leave/pause and explicit return. CPU autoplay is still
false; do not offer CPU seats as playable or invent progression/achievements.
Those, chat/reactions/deco/favourites/rankings remain required later packages.

Creation defaults: 2 open normal, 3 open normal, 4 blind Ladinisch. Two may choose
Ladinisch, four open/normal supported if recipe allows; never permit blind 2/3 or
Ladinisch 3. Critical off, target11 (target3 usable for short tests), no Guter.
Reference/history off; open partner hand only with open play. Inspect strict
`app/watten_recipe.py` rather than guessing valid combinations. Preserve selected
choices when a request fails. No technical flags/debug jargon in product flows.

## Real routes, authentication and protocol

Local preview only, both WATTEN_ACCOUNT_PREVIEW and WATTEN_GAME_PREVIEW enabled.
`/watten` lobby; `/watten/regeln`; `/watten/spiel/{16hex}`;
`/watten/spiel/{16hex}/zuschauen`. Root serves noindex/no-store and rejects real
Watten host. Account routes already work; reuse shared auth and native Watten
signin/settings links and safe canonical return helper.

Before private requests confirm fresh `/api/auth/me`. On unavailable auth or
anonymous state keep public rules/signin usable; no private requests. Bind each
mutation/socket generation to the account that mounted it. Recheck account and
CSRF before mutation; never adopt a different account token into an old action.
Account switch/logout/BFCache closes old socket, cancels pending commands and
clears private DOM synchronously. Avoid stale callbacks resurrecting private data.

Read actual `app/watten_http.py`, `watten_websocket.py`, `watten_runtime.py` and
`watten_views.py` for exact projection and errors; do not implement another engine.

- POST `/api/games`: CSRF, `{name, mode:"2"|"3"|"4", game_type:"watten",
  watten_recipe:<full strict recipe>, pass?:<password>}`. Full recipe has
  kind:watten_recipe,schema_version:1,ruleset_id:watten-house,ruleset_version:1,
  player_count,determination:normal|ladinisch,blind,critical,target_points,
  cpu_seats:[],show_rechter,trick_history,partner_hand,password_required.
- GET `/api/games?game_type=watten` gives games list and online_users:null.
- GET `/api/games/{id}` gives own full snapshot or info-poor lobby entry.
- WebSocket same-origin `/ws/{id}` greets with id,room_revision,locked,
  lifecycle_revision and capabilities.cpu_autoplay:false.
- Join `{action:"join_game",revision,passphrase?}`. Rejoin
  `{action:"rejoin_game",revision,player_id?}`. Intentional return adds
  `resume:true,lifecycle_revision:<current>`. Never auto-retry stale resume as
  new intent. Spectator `{action:"spectate_game",passphrase?}`.
- Incoming `{scoreboard:<snapshot>}`, `{watten_command:<ACK>}`,
  `{error,error_code,fatal}`. Adopt accepted snapshot immediately.
- Room commands each require action,command_id,revision,lifecycle_revision.
  `watten_take_seat` adds seat,team (4 opposite seat%2 explicit; 2/3 team:null).
  `watten_start`, `leave_waiting_game`, `watten_leave`.
  `watten_next_deal` adds deal_id,opportunity (host only).
  `watten_delivery_ack` adds delivery_ids array (max2, own only).
- Engine commands have ALL keys:
  `{action:"watten_command",command_id,deal_id,opportunity,phase,kind,value,
  private_opportunity,lifecycle_revision}`; unused value/private_opportunity null.
  Kinds announce_strike (7..A or weli), announce_colour
  (hearts/bells/leaves/acorns), show_ready, inspection_ack, play_card (card ID),
  bid (null), respond (hold/go/counter), partner_feedback (good/bad/unsure with
  private_opportunity from personal feedback_opportunity). View action names
  respond_hold/respond_go/respond_counter map to kind respond, not wire kinds.

Outer snapshot contains room recipe/revision/status/host/seats/members, viewer,
engine, paused,awaited_participant_ids,lifecycle_revision,can_resume,
pending_call_events and result_persisted. Inner engine is the actual own DTO.
Render ONLY provided fields/actions. No client legal-card filtering or hidden
call inference, hints, strength sorting, UI knowledge from someone else's DTO.
Sort hand in fixed suit/rank order independent of trump/strike.

Normal/open calls arrive in pending_call_events with delivery_id,deal_id,kind,
seat,value. Display each newly received allowed call transiently, ACK only after
consuming it, keep bounded local dedup. OFF reference means no persistent call
text after this presentation. Never reconstruct a missed/denied call. Spectator
gets only live ephemeral watten_public_call_events, no history replay. Blind
non-inspectors cannot see call. Optional reference_card face back/card follows
projection; not original shown card. Original inspection is one window only;
do not add reopen or expose original bottom after acknowledgement.

Intentional leave is a durable pause: explain waiting for that named player,
retain seat/cards/score/bid, leave to lobby only after accepted leave. Plain
rejoin reads paused view; explicit Fortsetzen/Resume fresh epoch clears own
absence. Others remain awaited. No automatic forfeit/CPU/abort/countdown.
Only permitted private partner advice may continue while paused; gameplay is
blocked. No repeated original inspection. Network reconnection alone is separate.

Pending bid dominates action area: named decider and hold/go/counter, no card
play. Private advice goes only to actual partner, never public announcement or
shared activity indicator. End third trick immediately; display accepted result,
all actual winner IDs, no guessed XP. Last_trick is presentation tail only; no
history browser when trick_history OFF. Do not expose password in URL/history,
link/clipboard/storage/referrer; send only join body, canonical copy-link only.

## Visual and interaction requirements

Own calm green table, warm paper, clear type, restrained gold/ink accents.
Reuse `frontend/hausdepp/cards.js` cardArt/prepareCardAssets and existing atlas/
back; Watten is 33 cards, Weli is bells-6. Preserve asset attribution in rules.
Study `docs/HAUSDEPP_ASSETS.md`. No image generation or downloaded assets.
Stable keyed hand nodes, visible pointer hit areas and keyboard/screenreader
names. Minimum44px controls, no click-through to adjacent card after animation.
Accepted model advances immediately; animations are a cancellable presentation
layer. Deal/trick collection modest; never delay commands until animation ends,
replay old moves on reconnect, or animate faces denied to that viewer.
Use initializeGameViewport. Rotation cancels stale geometry, preserves state,
commands, inspection and bid. Respect reduced motion. Both orientations work
at320x568,568x320,667x375 and tablet splitview, no horizontal overflow. Discreet
dismissible landscape suggestion, no blocking overlay. Safe areas, dialog inner
scroll and keyboard viewport must preserve visible controls. German/English
complete, including labels/errors/accessibility/card names/rules. Existing i18n
catalog/source supports dynamic strings; avoid untranslated concatenation.

## Validation and delivery

Small actual one-worker browser flow via `node node_modules/@playwright/test/cli.js
test --config=playwright.watten.config.js` only, own local server/tempDB/accounts,
no emails/push/real accounts. Config root-owned, port8034 and both preview flags.
Use PATH supplied by root and .venv Python. Do not run main browser pool, backend
full suite, containers, dependency installs or concurrent own test servers.
Write meaningful 2-human short target3 real completion and bid/hold/leave/resume,
4-manual-team blind inspection role privacy and basic3-seat roles. Random first
dealer means follow actual allowed actions. Additional layout/switch/BFCache cases
can use projected fixtures, clearly separate from real transport acceptance.
Record exact commands/results and limitations honestly. Do not claim whole P4 or
all81 complete. On real Claude limit preserve source and clean bounded checkpoint.
