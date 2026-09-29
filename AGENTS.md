# AGENTS.md

Guidance for coding agents working in Duodoro. Updated against the repository on
2026-09-29, after PRs #91–#93. Explicit user instructions take precedence.

## Project and layout

Duodoro is a collaborative focus timer for couples and friends. Supabase provides
Google/Discord OAuth and persisted data; a Socket.IO server synchronizes two-person
rooms. Pixel-art worlds rotate globally; users can also focus solo.

There are two independent npm packages. Install dependencies in the relevant
package; the root `package.json` and lockfile are legacy, not a workspace manager.

| Path | Responsibility |
| --- | --- |
| `client/` | Next.js 16.3 App Router, React 19, TypeScript, Tailwind 4, Framer Motion |
| `client/src/app/` | Main page, root metadata/layout, OAuth callback, invite route, Terms/Privacy, manifest and social images |
| `client/src/components/` | `DuoTimer` orchestration, Home, room HUD/world, panels, avatars and companions |
| `client/src/hooks/` | Auth, room state, socket transport/recovery, tasks, friends, preferences and accessibility |
| `client/src/lib/` | Shared client types, Supabase singleton/generated DB types, stats, sound manager, timer preferences, site metadata and pixel-art helpers |
| `client/src/test/`, `client/e2e/` | Vitest setup/accessibility helpers and Playwright public release smoke tests |
| `client/public/` | Icons, offline fallback/service worker and actual sound assets |
| `client/scripts/` | Dependency-free break-finished sound generator |
| `server/` | CommonJS Node.js, Express, Socket.IO and Redis focus recovery |
| `shared/socketContract.d.ts`, `shared/socketContract.js` | Canonical event types and runtime event-name lists for both packages |
| `supabase/migrations/`, `supabase/tests/` | Timestamped SQL source of truth and pgTAP schema contract |
| `docs/` | Database/deployment verification, observability and release checklists; some local documents are gitignored |
| `.github/workflows/ci.yml` | Database, server, client and browser smoke jobs |
| `docker-compose.yml`, package Dockerfiles | Local/self-hosted setup; current production uses Vercel and Render |
| `ROADMAP.md` | Tracked backlog and historical findings/corrections; verify old claims against source |

## Commands and verification

Use Node 22 to match CI. Each package has its own lockfile; use `npm ci` there.

From `client/`:

```sh
npm run dev                         # default port 3000
npx tsc --noEmit
npm run lint
npm run test:run
npx vitest run src/lib/format.test.ts # targeted test example
npm run build
npm run test:e2e                    # production browser smoke; see playwright.config.ts
```

From `server/`:

```sh
npm start                           # default port 3001
npm run test:run
npm run test:integration             # real local Supabase; separate from the default suite
```

`npm test` runs Vitest in watch mode in either package. Some server tests bind
real ephemeral ports. Integration tests create/delete real local Auth users and
session data; read their setup before running them.

On this workstation, Node 26's experimental web storage conflicts with jsdom.
If using that version, run client tests with
`NODE_OPTIONS=--no-experimental-webstorage npm run test:run`; prefer Node 22.
Next's generated `.next/dev/types` can retain removed temporary preview routes.
If that causes a missing-route type error, move aside the obsolete generated
cache and regenerate; do not change application types to conceal it.

Client builds need syntactically valid `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SOCKET_URL`. Never print or
commit real environment values. Server configuration is documented in
`server/.env.example`.

Next 16.3 can generate `client/AGENTS.md`/`client/CLAUDE.md` when `next dev` starts.
Read applicable generated guidance and the installed version's relevant docs in
`client/node_modules/next/dist/docs/` when touching framework APIs. Inspect the
git diff afterwards so temporary previews and generated instruction files do not
accidentally enter a feature PR.

## Client architecture

- `app/page.tsx` renders `components/DuoTimer.tsx`, the screen orchestrator.
  `useAuth` controls `appStep` (`loading`, `landing`, `avatar`, `home`, `game`).
- `hooks/useGameSession.ts` owns room membership, phase/player state, derived timer
  values and actions. `hooks/useSessionConnection.ts` owns the single transport,
  JWT refresh, connection state, retries, online/visibility recovery and rejoin
  snapshots. Keep these responsibilities separate; use refs for current reconnect
  snapshots rather than stale captured state.
- `SessionHUD.tsx` renders Start, Go again, Stop timer and Leave room. Stopping a
  timer keeps the room; leaving exits it. `completedRounds` is a server-synced room
  count, not a history total. It survives repeat rounds/stops while the room exists;
  interrupted focus does not increment it, and server restarts do not restore rooms.
- The client derives countdowns/Flow elapsed time from server timestamps and
  durations. Re-read the clock on ticks; do not decrement a second local timer.
  `timerPrefs.ts` persists local settings, while Go again repeats the room's actual
  server settings, which may have been chosen by the other participant.
- `HomeDashboard` uses `DailyFocusGoal` and `useDailyFocusGoal`. Targets are saved
  per account in this browser, with a memory fallback. Progress uses completed focus
  from the timezone-aware `get_daily_focus` RPC. Refresh on Home mount, local-day
  rollover and visibility/focus return. There is no separate goal database table.
- `lib/useStats.ts` shares a short cache/in-flight requests for stats consumers.
  Check reads and writes for errors. Empty results/zero progress are valid only
  after successful loading; preserve explicit loading/error/retry states. For RLS
  mutations, request returned rows and reconcile actual IDs, including partial
  success; a zero-row mutation can have no API error.
- `lib/supabase.ts` is the typed browser singleton with PKCE/localStorage auth.
  `lib/database.types.ts` is generated; normalize UI nulls in `lib/types.ts`.
- `lib/sounds.ts` owns playback, cache, persisted mute and mute subscriptions.
  `useSound`/`SoundToggle` subscribe to it. All sounds must respect that manager.
  Break completion rings on live `break → returning` events in both modes; room
  snapshots and duplicate events must not replay it. Sound assets live in
  `public/sounds/`; the original WAV can be regenerated with
  `python3 client/scripts/generate-break-finished-sound.py` from the root.
- Keep browser-only effects out of server rendering. A client component still
  has a server-rendered first frame: use a neutral server snapshot or mount state
  for clock/storage-derived UI and verify hydration behavior where relevant.
- `lib/site.ts` is the source of branding/site metadata. Keep runtime document
  title changes separate from canonical metadata and restore the normal title
  when a room is no longer displayed.
- `public/sw.js` caches only the standalone offline navigation fallback, never
  app bundles, sockets or Supabase responses. Its offline theme tokens mirror
  `app/globals.css`.
- Companion access is currently free. Internal premium names/fields are legacy;
  user-facing copy calls it companion access. `lib/billing.ts` is an inactive
  payment seam; never treat mock checkout as a successful purchase. Marketing
  consent is independent of access.

## Server architecture and invariants

- `index.js` loads deployment configuration, constructs Supabase/Redis clients,
  starts the app and handles signals with a bounded 25-second shutdown deadline.
  Production requires Supabase credentials and `FOCUS_QUEUE_URL`. Without
  Supabase configuration, development skips verified auth/persistence; that is
  not evidence that production authorization works.
- `app.js` exports `createRealtimeApp()` with `start()`/`stop()`. Importing it must
  not start listeners, install signal handlers, read deployment secrets or start
  background work. Inject dependencies for tests.
- `session.js` holds pure room/player state and helpers. `phaseSequence.js` defines
  transitions; `phasePetHandlers.js` registers start/stop/Flow/companion actions.
  Pomodoro: `waiting → focus → celebration (4s) → break → returning (3.5s) → ready`.
  Go again starts focus from `ready`. Flow returns directly to open-ended focus
  after the break, and Take break derives break duration from elapsed focus.
- Live rooms/timers remain in memory. `beginFocusRound()` creates one private
  recording UUID per actual focus round. Preserve that key across retries;
  snapshot elapsed time and participants before removing/changing room state.
  Completion counts are separate from asynchronous database-save success.
- `focusRecorder.js` calls the atomic, service-role-only `record_focus_session`
  RPC. `focusRecovery.js` manages persistence/retry and pending/unconfirmed status;
  `focusQueue.js` persists queued payloads in Redis so pending saves can recover
  across process restarts. This queue restores writes, not live room state.
  Never replace the atomic RPC with separate session/participant inserts, generate
  a new key on retries, or report pending/unconfirmed saves as saved.
- Graceful shutdown cancels reconnect timers before snapshotting interrupted
  focus, drains persistence/recovery and cleans presence. Preserve the shutdown
  ordering and duplicate-recording guards.
- `roomMembershipHandlers.js` handles creation, bearer share links, admission and
  reconnect re-keying. Rooms have two seats. Authorize before leaving the old room;
  reserve seats/consume new-join tokens synchronously before awaited reads; release
  reservations in `finally`; verify the room still exists after awaits.
- Authenticated disconnects retain a slot for `RECONNECT_GRACE_MS` (default 60s).
  Rejoin matches the verified user and re-keys socket/player/host mappings together.
  Client resume IDs are mirrored in sessionStorage/localStorage. A dead room after
  server restart must give an honest message and direct users to History.
- `accountHandlers.js` and `socialHandlers.js` handle accounts, presence/friends
  and invites; `presence.js` tracks sets of sockets per user so another tab cannot
  evict them. Refresh the trusted profile presence mirror after room changes, and
  clear stale presence on startup/shutdown.
- Companion stage comes from server completed-focus totals (`focusTotal.js`,
  `petLevel.js`), not client claims. Failed total reads must not shrink a veteran's
  companion. Growth uses more map cells at the same art pixel size.

## Socket, privacy and database boundaries

- Update shared event types/runtime name lists, emitters and handlers together.
  Use typed `DuodoroSocket`; compile-time types do not validate network payloads.
- Payload events go through `onPayload()` and `safeSocketHandler()`; parsers in
  `payloadParsers.js` validate/normalize fields without I/O or authorization.
  Preserve rate limits and membership checks. Identity comes from the verified
  JWT (`socket.userId`), never a payload user ID. A room UUID alone grants no access.
- Server logs use `observability.js` structured events, opaque `correlationRef()`
  and `safeErrorFields()`. Never log raw identifiers, names, emails, tokens,
  authorization headers, request payloads or arbitrary upstream error messages.
  `/health` is liveness; `/ready` checks bounded/cached database readiness.
  Consult `docs/OBSERVABILITY.md` before changing logging or alerts.
- RLS and column grants both matter. Never re-grant broad client UPDATE privileges
  on privileged profile fields. Avoid policies querying their own protected table;
  use narrowly scoped definer helpers for membership checks. Pin function search
  paths and revoke default PUBLIC execution for privileged functions.
- Shared task toggles use their scoped RPC; edits/deletes remain owner-only.
  Account deletion is a verified server/Auth operation with dependent cleanup,
  including durable pending records, not a client-side table sweep.
- Keep personal consent/email data out of friend-readable profiles. Derive verified
  email from Auth on the server/in SQL; marketing opt-out must not revoke access.

Database work uses Docker, PostgreSQL 17 and Supabase CLI **2.116.0** from the root:

```sh
supabase migration new short_snake_case_name
supabase start
supabase db reset --local --no-seed
supabase db lint --local --level warning --fail-on error
supabase test db
supabase gen types typescript --local --schema public > client/src/lib/database.types.ts
```

Validate the entire committed migration chain, update schema tests/generated
Typescript types, and follow `docs/DATABASE_WORKFLOW.md` for remote dry-run,
push and verification. Apply required migrations before deploying dependent code.
Never run `db reset --linked`, bypass mismatches with `db push --include-all`, or
edit production schema manually in the Dashboard.

## Worlds, pixel art and mobile UI

- New rooms get `worldAt()` from the server; there is no world picker. Rotation
  changes hourly at :30 UTC; existing rooms keep their original world. Keep
  `server/rotation.js` and `client/src/lib/rotation.ts` plus their pinned tests in
  agreement. Deterministic cross-package schedules use integer arithmetic.
- Adding a world also updates both rotation lists, `avatarData.ts` world types/data
  and the database world constraint through a migration.
- `PixelSprite` renders string maps. Composite layers with `lib/pixelMap.ts` before
  rendering; avoid stacked SVG rounding/seams and validate map dimensions/palettes.
- Art colors and shading come from `lib/palette.ts` (`shade`, `flush`); preserve
  palette guards and per-world color snapshots. Never scale RGB channels ad hoc.
- A scene uses one responsive integer art pixel via `ScenePixel`/`useArtPx()` and
  `lib/scene.ts`. Redraw maps to resolve density differences; do not upscale a
  low-resolution map as a substitute. Anchor standing art to `GROUND` with feet
  at the wrapper bottom; name tags must not shift that anchor. Use `ContactShadow`.
- Sprite animation uses whole-pixel translations/poses, with reduced-motion
  support. No rotation, fractional scaling, eased fractional positions or
  squash/stretch. Round animated values, not just their destinations.
- Avatar keylines were intentionally removed; do not restore them casually.
  Outlines change rendered proportions, so measure rendered SVG bounds. Real
  screenshots are needed for visual judgments; geometry tests do not prove taste.
- Game uses an `h-dvh` shell with reachable internal scrolling. Use dynamic viewport
  units and include safe-area insets in existing padding. Landscape compact styles
  need height queries, not width breakpoints alone. Preserve phone touch targets
  and narrow-screen overlay sizing.

## Delivery workflow

- Keep features free unless the user explicitly changes that preference.
- Inspect existing work and user edits before modifying files. Branch from current
  main for feature work; never commit directly to auto-deployed `main`.
- Use focused, coherent commits. The repository's default merge policy is rebase
  (`gh pr merge --rebase`), not squash; explicit session instructions take priority.
  Merge only when authorized and required CI is complete and successful.
- Preserve uncommitted user changes. In particular, this AGENTS.md replacement and
  the deletion of CLAUDE.md are intentionally uncommitted until the user requests
  otherwise; exclude them from unrelated feature commits.
- Verify bug claims against source. Regression tests should fail before a bug fix
  and pass after; distinguish regression evidence from general guard tests.
  Run checks appropriate to the change and report what they actually prove.
- Update `ROADMAP.md` in the feature PR that ships the item. Historical audit prose
  and old line numbers may be stale; maintain concrete current references.
- Current CI gates: database reset/types/lint/pgTAP, server audit/tests, client
  audit/types/lint/tests/build, and production browser smoke/accessibility. Node 22
  is pinned. Database images use GHCR to avoid ECR anonymous pull quotas; the pinned
  postgres-meta staging tag must stay consistent with the Supabase CLI version.
- Main automatically deploys client to Vercel and server to Render independently.
  `NEXT_PUBLIC_*` values are baked into Vercel builds. Render needs allowed origins,
  Supabase service credentials and the durable queue URL. Keep the current free
  hosting setup; a CI success is not proof that a production deployment succeeded.
- Public smoke tests do not verify authenticated two-account behavior, live data,
  sleeping mobile tabs or subjective visuals. Use `docs/RELEASE_CHECKLIST.md` and
  report those limits honestly. Never claim a deployment or manual check you did
  not observe.
