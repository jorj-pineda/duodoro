# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Duodoro is a collaborative pomodoro web app for long-distance couples/friends. Users sign in (Google/Discord OAuth via Supabase), create a pixel-art avatar, and run synchronized focus/break sessions together in real time, in whichever themed "world" the clock is on. Friends, invites, presence, sticky-note tasks, and session stats are layered on top.

## Repo layout

Two independent npm packages (each with its own `package.json` and lockfile), plus infra:

- `client/` — Next.js 16 (App Router, React 19, TypeScript, Tailwind 4, framer-motion). Single-page app: `app/page.tsx` just renders `DuoTimer`.
- `server/` — Plain Node.js (CommonJS) Express + Socket.IO server. `server/index.js` is the production environment/signal bootstrap; the transport/handler app factory is `server/app.js`; pure session-state helpers live in `server/session.js`.
- `supabase/migrations/` — Canonical timestamped SQL migrations managed by Supabase CLI. Create new files with `supabase migration new <name>`; never apply repository migrations by hand in the SQL editor.
- `docker-compose.yml` — local/self-hosted Docker setup (client + server, no nginx); kept for local dev, not used by the current deploy.
- The root `package.json` is vestigial — don't add dependencies there; install into `client/` or `server/`.

## Commands

Run commands inside `client/` or `server/`, not the repo root.

Client (`cd client`):
- `npm run dev` — dev server on http://localhost:3000
- `npm run build` / `npm run lint`
- `npm run test:run` — vitest once; `npm test` for watch mode
- Single test: `npx vitest run src/lib/format.test.ts`

Server (`cd server`):
- `npm start` — runs on port 3001 (or `npx nodemon index.js` for reload)

Database (repository root, Docker + Supabase CLI 2.116.0):
- `supabase start` — starts the project-scoped local stack on the 5532x ports.
- `supabase db reset --local --no-seed` — rebuilds PostgreSQL 17 from every committed migration.
- `supabase db lint --local --level warning --fail-on error` — rejects schema errors.
- `supabase test db` — runs the pgTAP schema contract.
- `supabase gen types typescript --local --schema public > client/src/lib/database.types.ts` — refreshes the checked-in client contract after a schema change. CI regenerates it from a fresh reset and rejects drift.
- `supabase migration new <name>` — the only way to create the next migration filename.
- Follow `docs/DATABASE_WORKFLOW.md` for remote dry-run, push, verification, and rollback. Never use `db reset --linked`, `db push --include-all`, or remote Dashboard schema edits.
- `npm run test:run` — vitest once. Most of the suite is pure helpers, but
  `createSession.test.js` and `sessionCapacity.test.js` spawn the real server as
  a child process with `PORT=0` and talk to it over real sockets
  (`socket.io-client`, a devDependency) — so those runs bind ephemeral ports and
  scrape the boot log for them
- `npm run test:integration` — the live-database suite
  (`privilegedWrites.integration.test.js`), excluded from `test:run` because CI's
  server job has no Supabase. Needs `supabase start`; creates real confirmed
  users and deletes them (and their sessions) afterwards. It is the only test
  that exercises migrations 020/022 through PostgREST rather than a mock.
- Without `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` set, the server runs in dev mode: JWT verification and all persistence are skipped. In production those vars are required (it exits otherwise).

Local dev needs both processes running. Client env: `NEXT_PUBLIC_SOCKET_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Server env: see `server/.env.example`.

## Architecture

### Split of responsibilities

- **Socket.IO server** (`server/app.js`) is the source of truth for live session state: phases, timers, players, presence, invites. All session state is **in-memory** (the `sessions` map plus the presence registry in `server/presence.js`) — it does not survive a server restart, and nothing live is read back from the DB.
- **Supabase** handles auth (JWT), and persistence: profiles, friendships, tasks/sticky notes, and *completed* session history (`sessions` + `session_participants` rows written by the server with the service-role key, bypassing RLS). The client talks to Supabase directly (anon key + RLS) for friends, tasks, and stats.
- **Client** never trusts its own clock for the timer: the server broadcasts `phase_change` with `phaseStartTime` and durations; the client renders countdowns from `Date.now() - phaseStartTime`.
- **The world is not client input.** There is one world at a time, the same for everybody, derived from the wall clock — see the rotation section below.

### Server session lifecycle

Sessions are keyed by UUID. Phase state machine driven by `setTimeout` chains in `advancePhase()`:
`waiting → focus → celebration (4s) → break → returning (3.5s) → focus → …`

Two timer modes: `pomodoro` (fixed durations, server auto-advances) and `flow` (open-ended focus; client emits `finish_flow_focus`, break is computed as ~1/5 of elapsed focus). Focus is recorded to the DB when a focus phase completes or is stopped/abandoned early (`recordSession`, with `completed` flag). `beginFocusRound()` creates one private UUID when focus starts; every completion/stop retry sends that same key to the service-role-only `record_focus_session` RPC (migration 022), which inserts the session and participants in one transaction and rejects conflicting key reuse. In-flight recordings are drained on shutdown within the five-second exit deadline. Never replace this with separate Data API inserts or generate the key inside the retry loop.

A dropped socket doesn't eject its player immediately: authenticated players keep their slot for a reconnect grace window (`RECONNECT_GRACE_MS`, default 60 s), and `join_session` from the same `userId` re-keys the existing slot to the new socket instead of duplicating the player. The client mirrors the active session id into `sessionStorage` and auto-rejoins after a page reload.

Sessions have exactly two seats. A distinct third user gets `Session is full`,
while an existing user's reconnect is allowed to replace its current socket in
a full room. New joins reserve a seat synchronously in `server/session.js`
before awaiting the focus-total RPC; a plain count check before that await has a
race where two joins can both see the final seat. Every reservation is released
in `finally`, and it is private server state that never enters `sync_state`.

### The world rotation

`create_session` assigns `worldAt()` (`server/rotation.js`) — one world, everybody, changing on the **:30** of every hour, anchored to UTC. Nobody picks a world; there is no picker. Rules that keep it working:

- **Derived, never stored.** No row, no timer, no broadcast. Live session state is already in-memory and dies with the process, so a persisted rotation would be one more thing to resync after a restart and one more thing two instances can disagree about. Anything that needs to know the world computes it.
- **A session keeps the world it started in.** Rotation applies to new sessions only — swapping the scene 20 minutes into a focus block is worse than a slightly stale theme, and it would make the `sessions.world` history row ambiguous. `sync_state` carries the session's world; the client mirrors it and does not re-derive.
- **Two copies, one schedule.** `client/` and `server/` can't import each other, so the derivation is duplicated in `server/rotation.js` and `client/src/lib/rotation.ts`. What keeps them honest is that both test suites pin the **same table of timestamps** — edit one implementation and the *other* package's suite fails. Change both, or neither.
- **Integer hash, never `Math.sin`.** The per-cycle shuffle uses `Math.imul` + xor-shift. `lib/terrain.ts` and `lib/interior.ts` seed with `Math.sin`, which is fine when a 1-ULP difference between engines moves a rock; here it would put the client and the server in *different worlds*. ECMA-262 doesn't require transcendentals to be bit-identical across implementations. Anything two packages must agree on exactly stays in integer arithmetic.
- **The order reshuffles every cycle** (8 slots = every world once). A fixed order would be an 8-hour loop, and 8 divides 24, so a 9am regular would get the same world every day forever. A fix-up stops a cycle opening on the world the last one closed with.
- **`create_session` ignores an unknown `world` field rather than rejecting it**, so an older client still gets a session instead of an error. That is the general shape for removing a field from an event.

Adding a world now needs `ROTATION_WORLDS` (**both** copies), the client's `WorldId` and `WORLDS` in `lib/avatarData.ts`, and the SQL `sessions_world_check` (migration 008, last edited by 019). A world missing from the rotation is unreachable — there is no picker left to select it with, which is why `rotation.test.ts` asserts the two lists match.

Security conventions in the socket layer (preserve these when adding events):
- `shared/socketContract.d.ts` is the canonical application event map for both
  directions, including acknowledgements; `shared/socketContract.js` exposes
  the matching runtime name lists used by the parity test. Add or change an
  event there first, use `DuodoroSocket` in client props/hooks, and update both
  emitter and handler in the same change. This is compile-time coordination,
  not network validation: custom clients still require the parser boundary.
- `io.use()` middleware verifies the Supabase JWT and sets `socket.userId` — **never trust a client-sent userId**.
- Every event that accepts a payload is registered through `onPayload()` in
  `server/app.js`. It rejects null, arrays and primitives before field access,
  and `safeSocketHandler()` in `server/socketProtocol.js` contains both thrown
  exceptions and rejected promises. Do not attach a payload-bearing event with
  a bare `socket.on()` or destructure its argument in the listener signature.
- Every inbound payload delegates field validation and normalization to its
  pure parser in `server/payloadParsers.js`; keep I/O, session lookups, and
  authorization out of that module. Rate limits intentionally run before the
  parser where they already did, so malformed requests cannot bypass work
  bounds. The stronger move, where available, is not to take the field at all —
  that is what happened to `world`.
- Mutating events check the socket is actually a player in the session; create/join/invite are rate-limited per socket.
- Knowing a session id is not permission to use it: `join_session` requires an existing slot, an invite, or friendship with someone already in the session, and `send_invite` is friends-only. Server-side ids are read from `socketToSession`, never taken from the payload.

Account/presence events are registered by `server/accountHandlers.js`; online
friend lookup and invite relay are registered by `server/socialHandlers.js`.
Keep these services explicit about injected live state and side effects so they
remain directly testable. `server/app.js` composes them per connection; it must
not duplicate their event registrations.

Phase and companion events are registered by `server/phasePetHandlers.js`.
Preserve its ordering invariants: only start from `waiting`; snapshot an
interrupted focus before clearing its round id; keep flow focus at the safety
cap so later rounds remain open-ended; and derive pet stage from the private
server focus total, never a client field. Inject timer functions in direct tests
instead of waiting on wall-clock time.

Room creation, share links, admission, and reconnect re-keying are registered
by `server/roomMembershipHandlers.js`. Preserve its admission order: authorize
before leaving the caller's current room; reserve the final seat and consume a
new participant's bearer token synchronously before awaiting focus history;
release owned reservations in `finally`; and confirm the in-memory room is
still current after the await. Reconnect identity is always `socket.userId`,
and the stale socket/player mapping and host id must be re-keyed together.

Pets are part of session state, not just local UI: `set_pet` updates the player's slot server-side (allowlisted by `parseSetPet`) and relays `pet_changed` to the other player, so both sides see the same companion. `petStage` is derived from total completed focus (`server/petLevel.js` / `client/src/lib/petLevel.ts`, same two-copy pin as the rotation) and a client-sent stage is ignored. The total itself comes from the `total_focus_seconds` RPC (migration 021, `EXECUTE` to `service_role` only, because it takes a user id — a user's *own* total goes through `get_focus_stats`, which needs no argument because it reads `auth.uid()`). `server/focusTotal.js` is the only caller, and a failed read there returns `null`, which becomes `grown` rather than `young`: shrinking a veteran's pet is how "we couldn't tell" would otherwise render. Growth is more cells at `ART_PX`, never a scale multiplier.

Note: `server/session.js` holds the pure session-state helpers (`createSessionState`, `addPlayer`, `removePlayer`, `setPlayerPet`, `creditFocus`, `findPlayerByUserId`, `markPlayerDisconnected`, `sessionParticipantIds`, `buildSyncPayload`); the realtime app/services import them and `session.test.js` covers them. Put new pure session logic there, not inline in a transport handler.

`createRealtimeApp()` must remain safe to import: no port binding, process
handlers, environment reads, service-role client construction, or background
intervals before `start()`. Keep deployment-only configuration and the bounded
signal exit in `server/index.js`; inject dependencies into the app factory and
use `stop()` in tests or other embedders.

### Client structure

`DuoTimer.tsx` is the top-level orchestrator: it composes two hooks and switches screens on `appStep` (`loading → landing → avatar → home → game`, defined in `lib/sessionTypes.ts`).

- `hooks/useAuth.ts` — Supabase auth, profile load/save, drives `appStep`.
- `hooks/useSessionConnection.ts` — owns the one Socket.IO transport: handshake token, token refresh, connection state, retry exhaustion, manual reconnect, visibility/online recovery, `request_sync`, and rejoin snapshots. Keep room/game state out of it; callers provide one typed event-registration callback and a current snapshot getter. It exposes `connectionState`, which `ConnectionBanner` renders as a “reconnecting / connection lost” banner.
- `hooks/useGameSession.ts` — owns session/phase/player state, room events and actions, invites, and the `sessionStorage` mirror that drives rejoin-after-reload. It supplies the connection hook with refs-backed snapshots so reconnect handlers never capture stale avatar, pet, name, or room values. `myWorld` is read-only to callers — it mirrors the server's answer, and a setter would be a supported way to put the client back in charge of it.
- **Never read the clock directly during render.** `"use client"` marks a component as interactive; Next still renders it on the server, where "now" is a different number, so anything clock-derived in the first pass is a hydration mismatch. For ticking values, start at `null` and fill in from an effect (`useRotatingWorld`). For a one-shot browser value, give `useSyncExternalStore` a stable neutral server snapshot (`HomeDashboard`'s greeting). Static-render tests must prove the first frame contains no clock-derived output, because testing-library's `render()` already reaches the client snapshot and cannot show that frame. Ticking values must re-read the clock rather than decrementing stored state so throttled background tabs recover instead of drifting.
- `lib/supabase.ts` — browser Supabase singleton (PKCE flow, localStorage sessions — deliberately not cookie/SSR-based; `app/auth/callback/route.ts` exists for the OAuth redirect). It is parameterized by the generated `lib/database.types.ts`; regenerate that file after every migration and keep UI-specific null normalization in `lib/types.ts`.
- Direct-to-Supabase data hooks: `useFriendsList`, `useFriendSearch`, `useTasks`, `useStickyNotes`, `lib/useStats.ts`. In these, **check `error` on reads as well as writes** — `if (data) setX(data)` leaves the list at its old value and renders the empty state, which makes a hard failure indistinguishable from "you have nothing yet". That is exactly how the `42P17` outage fixed in migration 018 hid: every task read was erroring and the UI said "No tasks yet". Likewise, RLS refusing an UPDATE or DELETE is not an error — it matches zero rows — so those need `.select()` and a row-count check. For bulk mutations, reconcile by the returned IDs rather than dropping the requested set: RLS may accept only part of one request, and refused rows must remain visible with a partial-failure message.
- **An empty result and a failed request must never render the same way.** Zeros and "nothing here yet" are claims about the user's data; making them on a failed fetch tells someone their history is gone. Where a hook can return legitimately-empty data, expose a *loaded* flag alongside `error` — `useStats` does — and gate the empty state on it, because `personalStats === null` covers both "new account" and "never loaded". `StatsErrorState` is the shared "couldn't load, nothing was lost, retry" panel.
- `useOnlineFriends` is a hybrid — the friend list comes from Supabase, the online/offline dots from the socket (`get_online_friends` + `presence_update`).
- `public/sw.js` caches **nothing about the app** — only `/offline.html`, served as a fallback for failed *navigations*. Timer state is server-authoritative, so a stale socket.io or Supabase reply is worse than no reply; the fetch handler returns early for anything that isn't a navigation. Keep it that way. `offline.html` is standalone by necessity (no network means no hashed CSS bundle, no Google Fonts), so its theme tokens are a copy of `globals.css` — update both together.
- Server application logs are structured JSON through `server/observability.js`; do not add direct `console.*` calls. Never log raw account/socket/session IDs, display names, emails, tokens, authorization values, payloads, or arbitrary error messages. Use opaque `correlationRef()` values, fixed event/outcome names, and `safeErrorFields()`. `/health` is liveness; `/ready` is the cached, bounded Supabase dependency check. The event catalog and alert response live in `docs/OBSERVABILITY.md`.
- `lib/sounds.ts` owns audio *and* the mute flag. The flag is a module-level variable with its own listener set, not React state, because `playSound` is called from `useGameSession`'s socket handlers — outside the component tree, sometimes while nothing is mounted. `useSound` subscribes to it via `useSyncExternalStore`, so any number of `SoundToggle`s stay in agreement. Add new sounds to `FILES`; don't add a second playback path that bypasses the mute check.
- `lib/billing.ts` is the Stripe seam and contains no payment. The legacy/internal premium grant is currently issued free by `claim_premium` in exchange for a confirmed email; user-facing copy calls it **companion access**, never Premium, Upgrade, or Pro. Marketing consent is optional and independent. `PREMIUM_IS_FREE` is the flag to grep when that changes. `startCheckout()` **throws** rather than resolving — a mock checkout that quietly succeeds is the worst thing to leave in a codebase that will later move real money, because it looks like working code until it grants something nobody paid for. Whatever `PremiumModal` claims must exist: its feature list was four things, three of which were fiction, and a test now asserts each stays gone.
- Visuals: `GameWorld` renders the session scene; `PixelCharacter`/`PetCharacter`/`WorldDecorations` are hand-drawn SVG/CSS pixel art driven by `lib/avatarData.ts`. `lib/scene.ts` holds the two numbers the scene has to agree on — `GROUND` (the ground plane's height, which everything standing is anchored to) and `ART_PX` (one art pixel in CSS px). Both were duplicated literals; `GROUND` appeared six times across three files. Note what the server actually validates: `sanitizeAvatar` whitelists `hairStyle` and `eyeStyle`, but checks colours with a plain `/^#[0-9a-fA-F]{6}$/` regex — so recolouring the palette is client-only, while adding a *style* also needs `VALID_HAIR_STYLES`/`VALID_EYE_STYLES`. Adding a *world* is a separate checklist — see the rotation section; `VALID_WORLDS` no longer exists.

### Mobile / viewport conventions

The game screen is a fixed app shell (`h-dvh` + `overflow-hidden`) with an internal scroll region, so layout mistakes there strand controls off-screen with no gesture to reach them rather than just looking cramped.

- **Use `dvh`, never `vh`/`h-screen`.** On iOS Safari `100vh` is the *large* viewport — the height the page would have with the toolbar hidden — so a `vh`-sized shell is taller than what's visible, and anything at the bottom of an inner scroll region falls below the fold inside an `overflow-hidden` parent.
- `layout.tsx` sets `viewportFit: "cover"`, so any element flush to a screen edge must account for `env(safe-area-inset-*)`. **Fold the inset into the element's existing padding** (`pt-[calc(0.625rem+env(safe-area-inset-top))]`) rather than adding a `.pt-safe` helper class — a plain CSS class declaring `padding-top` lands later in the cascade than Tailwind's `py-*` and replaces it instead of adding to it.
- **Landscape phones need height queries, not width breakpoints.** A landscape phone is *wide*, so `sm:` fires exactly when vertical space has run out and makes things bigger. `globals.css` keys the HUD's compact form off `max-height: 520px`.
- Overlay panels go `inset-x-2 sm:inset-x-auto` + `w-full sm:w-80` — `FriendsPanel`, `StatsPanel` and `StickyNote` all follow this; a bare `w-80` is 320px of a 360px screen.
- Touch targets follow the `w-11 h-11 sm:w-7 sm:h-7` / `px-4 py-2.5 sm:px-0 sm:py-0` pattern already in `Button` and `AvatarCreator`.
- **The art pixel is responsive, and it is context, not an import.** `artPxFor(width, height)` (`lib/scene.ts`) answers `ART_PX` (3) or `ART_PX_COMPACT` (2) — whole numbers only, because a fractional art pixel resamples every edge into grey fringe. The thresholds are the codebase's own mobile lines, 640 (Tailwind `sm`) and 520 (the `max-height` query in `globals.css`), and the height clause is what gets landscape right: a landscape phone is *wide*, so a width query would call it a desktop exactly when the vertical room has run out. `GameWorld` measures its box (it is `absolute inset-0` in an `h-dvh` shell, so the box *is* the viewport) and publishes the answer through `ScenePixel`; sprites read it with `useArtPx()`. **Never import `ART_PX` into something that draws inside a scene** — the whole frame has to move together, and a prop threaded through ~20 components is a prop that gets forgotten on one. Outside a provider the hook returns the desktop size, which is what `AvatarCreator`'s preview and the landing page's hero card want: their boxes are cards, not viewports, so the viewport-derived thresholds do not apply to them.

### Database conventions

- `profiles` extends `auth.users`; usernames use Discord-style `username#discriminator` tags via the `claim_username` RPC (one-time change enforced in SQL, migration 005).
- Live presence is mirrored into `profiles.current_session_id` / `current_world_id` by the server so friends can see "in a session" from the client's Supabase queries. Because only the service key can write those columns (migration 010), they're trusted as proof of where a user is — migration 013's `tasks_read` policy relies on that.
- Socket presence is tracked per *user* with a set of sockets (`server/presence.js`), not one socket per user: extra tabs must not evict each other, and a user only counts as offline once their last socket closes.
- The DB mirror follows the same rule: leaving a session refreshes `profiles.current_session_id` to whichever session the user is *still* in (`refreshPresence`), and only clears it when they're in none. The server also sweeps stale presence on boot and drains it on SIGTERM — in-memory sessions die with the process but that column doesn't, and a stale value both shows friends a dead "Join" button and wrongly satisfies migration 013's `tasks_read`.
- RLS is on for all tables; the server's service-role key is what allows it to write session history and presence. Later migrations (004, 007, 009) tightened RLS and pinned function search paths — follow that pattern in new SQL.
- Completed-focus history is an atomic RPC write, not two table requests. Migration 022 adds nullable `sessions.recording_key` for migration-first deploy compatibility and grants `record_focus_session` only to `service_role`; the function remains `SECURITY INVOKER` with an empty `search_path`. Identical calls are idempotent, while changed data or participants under the same key raise `22023`.
- RLS gates which *rows* a client may write, never which *columns*. Anything privileged (`is_premium`, `username`, presence fields) is protected by column privileges instead — migration 010 revokes table-level UPDATE from `authenticated`/`anon` and grants back only the client-writable columns. A table-level UPDATE grant silently outranks column grants, so never re-grant one. Privileged writes go through `SECURITY DEFINER` RPCs or the service key.
- **Never let a policy's `USING`/`WITH CHECK` reference its own table.** Postgres applies RLS to the subquery too, re-expands the policy, and raises `42P17 infinite recursion detected in policy` at *rewrite* time — so the surrounding `OR` never short-circuits it and every statement touching the table fails regardless of the rows involved. `sp_read_own` (002) did this and took the whole `tasks` feature down with it, because `tasks_read` probes `session_participants`; migration 018 moves the membership check into the `SECURITY DEFINER` helper `is_session_participant()`, which runs as the owner and so isn't subject to RLS. Any new policy that needs to ask "is the caller a member of X" must go through a definer function, not a self-join.
- A policy can't express "you may change this column and no other": `WITH CHECK` sees only the new row, so it can't assert the rest of it stayed put. When two people need write access to *part* of a row, use a `SECURITY DEFINER` RPC that writes just that column — `toggle_shared_task` (017) is the pattern: either partner may flip `is_done` on a shared goal, while `content` edits and deletes stay owner-only via ordinary policies.
- Postgres is not the only place a permission check lives. A client that renders an action the database will refuse is a bug even when the refusal is correct — `StickyNote` drew a ✕ on notes only the owner can delete for as long as the feature existed. The mirror of that: an action the database has no way to perform is worse. `is_premium` was unwritable by anything (010 revoked it, nothing else set it) while the UI sold it, so premium was false for every user for the life of the feature.
- **Trust `auth.users`, not the client, for anything the client could otherwise assert about itself.** `claim_premium` (020) grants premium on a *confirmed* email address, and reads both the address and `email_confirmed_at` from `auth.users` inside a `SECURITY DEFINER` function — `authenticated` cannot read that table at all. Taking the address as an argument would have made the check meaningless: you would be confirming whatever the caller just typed. Every user arrives via Google or Discord OAuth, so the address is already provider-verified and no confirmation email is sent or needed; the column is still checked, so enabling email/password sign-in later doesn't quietly open a hole.
- Personal data doesn't belong on `profiles`. Friends can read profile rows (012 narrows it, but not to nothing), so email addresses live in `premium_grants`, readable only by their owner. Premium itself stays a boolean on `profiles` because that *is* shown to others.
- Account deletion is a verified server operation, never a client-side table sweep. The
  `delete_account` socket event takes only the exact confirmation phrase; identity and email
  come from the authenticated handshake. `auth.admin.deleteUser(..., false)` hard-deletes
  the Auth root and existing `ON DELETE` rules remove profiles, friendships, owned tasks,
  participant links, and premium consent. The legacy `waitlist` has no account foreign key,
  so `server/accountDeletion.js` removes its matching normalized email explicitly first.
  Keep the public Privacy page accurate whenever a new personal-data root or processor is
  added.
- Marketing consent is independent of premium. Migration 020's idempotent `claim_premium`
  RPC is also the authenticated update path for `marketing_opt_in`; withdrawing consent
  must not revoke pets or premium access. Never send commercial email without honoring the
  stored preference and an unsubscribe mechanism.

## Deployment

Push to `main` auto-deploys both halves independently — each host watches the repo itself,
there is no deploy workflow in this repo:
- **Client** (`client/`) → Vercel. `NEXT_PUBLIC_*` env vars are set in the Vercel project
  and baked in at build time — changing one requires a redeploy, not just an env edit.
- **Server** (`server/`) → Render (Node web service). `ALLOWED_ORIGIN` (comma-separated
  for multiple origins), `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` are set in Render's
  Environment tab; the server exits at boot if the Supabase vars are missing.

CI is separate from deploys: `.github/workflows/ci.yml` runs on PRs and pushes to `main` —
server tests, then client `tsc --noEmit` + **blocking** `npm run lint` + tests +
`next build` (with dummy `NEXT_PUBLIC_*` values, since they're inlined at build time).
It also builds the production client in a dedicated browser-smoke job and runs Playwright
against both the client and realtime health endpoint at desktop, phone portrait, and phone
landscape sizes. Failure evidence is uploaded for seven days. Lint is at zero violations
and every job is hard-failing; keep it that way rather than adding suppressions in bulk.

CI cannot prove OAuth, two real accounts, live Supabase state, background-tab behavior,
safe areas on hardware, or visual taste. `docs/RELEASE_CHECKLIST.md` is the required manual
half of the release gate; record a result and evidence instead of turning a blocked check
into a pass.

Both package jobs run `npm audit --omit=dev --audit-level=high` immediately after
install. Treat a new high/critical production advisory as a release blocker: update the
smallest compatible dependency set, commit every affected lockfile, and rerun the full
package plus browser gates. The root manifest is a legacy duplicate and is not deployed,
but keep its lockfile clean until that manifest is deliberately retired.

See `MIGRATE_TO_VERCEL.md` for the full migration history and gotchas. The old GCP VM /
Docker-Compose/Nginx/GHCR pipeline has been retired.

## How work gets done here

The repo owner has settled on these; follow them without being asked.

- **Never commit to `main`.** Every change goes on a feature branch, then a PR. `main` is
  auto-deployed, so a commit there is a production deploy.
- **Many small commits, not one big one.** Each commit should be one coherent change with a
  message explaining *why*, not what. A PR of 4–8 focused commits is the target shape; PR
  size itself stays moderate.
- **Merge with `--rebase`, never `--squash`.** Squashing collapses the whole PR into one
  commit on `main` and throws away exactly the granular history the small commits existed
  for.
- **A/B every fix.** A test for a bug must *fail against the previous commit* and pass with
  the fix — and say so in the PR. Tests that pass both ways are guards; label them as such
  rather than presenting them as evidence. For SQL, run the whole migration chain against
  Postgres 17 in Docker and show the before/after output.
- **Report honestly.** State what was not verified. The public production build has a
  Playwright smoke gate; that is not evidence for authenticated, two-account, live-data,
  real-device, or subjective visual behavior. Use the release checklist and name blocked
  checks rather than implying they work.
- **Verify claims before acting on them.** Findings handed over from an audit or a previous
  session are frequently wrong on specifics. Three reported sprite defects (eye centring,
  duplicate `long` hair, palm misalignment) turned out not to exist on inspection. Check
  the source, then fix.

`ROADMAP.md` in the repo root is the prioritised backlog. It carries file:line references,
a corrections section for debunked findings, and the recommended order of work. Read it
before proposing what to do next, and tick items off as they ship.

It used to be `ROADMAP.local.md`, gitignored via `*.local.md`. It is tracked now, which
changes how to edit it: it lands in PR diffs, so update it **in the PR that does the work**
rather than as a separate pass, and keep the file:line references honest — a stale line
number in a tracked file is worse than one in a scratch file, because the next person
believes it.

## Pixel art conventions

The art is generated at runtime — there are no image assets. `client/public/` holds six
SVGs, five of which are untouched Next.js starter files.

- `PixelSprite` (string map + palette → merged `<rect>`s, `shapeRendering: crispEdges`) is
  the right primitive, and everything now uses it. The avatar and the pets are string maps
  in `lib/characterMaps.ts` and `lib/petMaps.ts`; they were ~90 hand-placed `<rect x= y=>`
  elements until PR #39, which is why they were the two sprites that couldn't be
  palette-swapped, outlined or blinked.
- **Multi-layer sprites composite into one map before rendering** (`lib/pixelMap.ts`),
  never into stacked `<svg>` elements — separate SVGs put each layer's edges on their own
  rounding and the parts of one shape pick up seams. Layers share one key alphabet, so
  compositing is "last non-transparent wins" and no two layers can disagree about what a
  key means. `place()` **throws** on a block that overruns the canvas or a row of the wrong
  width: `PixelSprite`'s forgiveness is right for a standalone sprite and wrong for a
  layer, where a padded row lands on top of what the layer was supposed to let through.
- **Derive shading, never hand-pick it, and never scale RGB channels.** `shade()` and
  `flush()` in `lib/palette.ts` are the only shading in the art. A per-channel multiply
  moves a colour by an amount that depends on how bright it already is — the old
  `darken(skin, 0.08)` shifted the deepest skin by 0.016 lightness and the palest by 0.071,
  so the chin shadow was invisible on two of the six skins. Two obvious rewrites each fix
  half: blending toward a fixed dark tone leaves near-black *lighter* than its own shadow,
  and holding HSL saturation while dropping lightness turns pale colours vivid. `shade()`
  drops lightness by a fixed amount while holding chroma, with a cap. Both failure modes
  are regression tests in `lib/palette.test.ts`.
- **`lib/palette.ts` is the only file that names an art colour.** Material families are
  generated ramps (`FOLIAGE`, `STONE`, `SNOW`, `EMBER`…); individual props and ambient
  washes are curated constants at the bottom of the same file. A scene takes its colours
  from there — `paletteGuard.test.ts` fails if any other non-test source file contains a
  hex, with a short allowlist for UI chrome, brand marks, and *data that is itself the
  colour* (the avatar choices and per-world skies in `avatarData.ts`, the note colours).
  Adding a colour means adding it to the palette, not to the component that wanted it.
  A world's sky is `skyStops` plus the index of the horizon stop; both the CSS gradient and
  the `HORIZON` distance-blend colour are derived from that one list, so they can't drift.
  `WorldDecorations.colors.test.tsx` snapshots every colour each world paints, so a
  consolidation is provably colour-neutral and a deliberate recolour has to update the
  snapshot.
- **A sprite should change its own pixels.** `pixel-idle` translates the whole sprite up
  three px, which is motion *of* a drawing rather than motion *in* one, and a scene of
  those reads as posed dolls. The avatar blinks (4–6.5 s, jittered — a fixed interval reads
  as a tic — and off under `prefers-reduced-motion`). Walk cycles are separate maps, not
  transformed copies.
- **`PixelSprite` fails silently in three ways**, all covered by `lib/uiSprites.test.ts`:
  a short row is padded rather than rejected (the viewBox takes the *longest* row), a
  character with no palette entry is skipped, and two palette keys with the same colour
  render as one shape. The last was a real bug — the coffee cup's handle.
- **SVG clips out-of-bounds geometry without warning.** The cat and rabbit shipped with a
  leg drawn at row 10 inside a 10-row viewBox and simply never drew it. Rect counts don't
  catch this; comparing geometry to the declared viewBox does —
  `components/PetCharacter.test.tsx`. All four pets now share one 11-row grid.
- **Never rotate or non-integer-scale pixel art, and never place it on a fractional
  pixel.** All three resample hard edges into grey fringe, which is why sprites looked
  blurry *despite* `crispEdges` — the renderer was never the problem. `crispEdges` snaps
  edges within the SVG's own coordinate space; it cannot help once the whole element is
  offset by half a device pixel. The rule, enforced by
  `app/pixelMotion.test.ts`: every keyframe that moves a sprite uses `translateX`/
  `translateY` by whole pixels only, and holds each pose with `steps(1, end)` rather than
  easing through the gap — an eased tween between 0 and -3px is on a fraction for most of
  its cycle even though both endpoints are whole. `decor-shooting-star` is the one
  documented exemption (a div of light, not a sprite). Where a sprite's position is
  animated by framer-motion, round the *animated value* (`useTransform(raw, Math.round)`),
  not just the target — interpolating between two whole pixels still passes through every
  fraction between them. See `useCharacterPosition`.
- Squash-and-stretch is not available to this art: `scaleY(1.05)` of a 72px sprite is
  75.6px. Weight has to come from the arc, in whole pixels.
- **One art pixel per scene.** `ART_PX` (`lib/scene.ts`) is it; the characters and pets
  are on it. The scenery is not, and cannot be moved by editing its `scale` props: a
  sprite's apparent pixel size *is* its scale, so a 16-cell map at `ART_PX` is a 48px
  mountain, not a small-pixelled 128px one. Keeping current sizes at one density means
  redrawing each map at more cells — `MOUNTAIN` needs 43×27 instead of 16×10. The full
  cost is tabulated at the top of `WorldDecorations.tsx`. Never "fix" a density mismatch
  by rescaling a small map up; that is the same picture with bigger pixels.
- Anything that stands in the world anchors to `GROUND`, and its wrapper's bottom edge
  must be the sprite's feet. A name tag or caption inside the wrapper silently becomes
  the bottom edge and lifts the sprite off the ground — that is what `calc(19% - 4px)`
  was compensating for. The wrapper also has to be shrink-wrapped to the sprite, because
  `ContactShadow` centres on it: a wrapper that stretches centres the shadow on the row
  instead of on the character.
- **Contact shadows are a shared recipe, not a per-component choice.** `ContactShadow`
  (one art pixel tall, `#000` at 0.26, one art pixel below the wrapper) is used by both
  `Grounded` in the scenery and `Standing` in `GameWorld` — a character whose shadow is
  darker than the tree beside it reads as lit by a different sun.
- **The characters carry no keyline, and that is a decision, not an omission.** Outlining
  them was tried across all eight worlds and rejected on looks (2026-08-15). The scenery
  keeps its own. Before adding one back, note what it costs: an outline is drawn on all
  eight worlds to fix three, and it changes the sprite's size (below). The legibility
  problem it was for is real and measured — a black-haired avatar's head sits at 1.06
  contrast against Space's air — and is written up under item 4 in ROADMAP.md.
- **An outline changes a sprite's size.** `PixelSprite` grows the viewBox and the rendered
  box by one cell on every side, so a 16×24 avatar renders 18×26. That is not neutral
  across sprites of different sizes: the same border is +8% on a 24-row person and +29% on
  a 7-row pet, which moved the pet-to-person ratio from 0.29 to 0.35 when outlines were
  turned on. Measure proportions off the rendered SVG heights, never off the map constants
  — a test asserting `PET_H / CHAR_H` passes on a number nobody can see.
- To review sprite changes without a browser, render the component in jsdom and dump the
  SVG to a static HTML page — that is how the pet fix was reviewed. Screenshots and visual
  judgement still need the repo owner; say so instead of guessing.
