# Duodoro — what to work on next

The prioritised backlog. Tick items off as they ship; update this in the PR
that does the work, not afterwards. Ordered by value; each line names the real
files. Was `ROADMAP.local.md` and gitignored until PR #38 — it is tracked now,
so the file:line references land in diffs and want keeping honest.

Last updated: 2026-09-13. PRs #35–#75 merged. Migrations 016–023 are applied to
production. **020 verified in production**
2026-08-15: RLS on, one SELECT-only policy, zero client write grants, EXECUTE
limited to authenticated/service_role, SECURITY DEFINER with a pinned
search_path. It went in *after* #40 reached main, so there was a window where
the unlock button called a function that did not exist — it failed soft and
nobody had claimed, so the window cost nothing. Nothing has claimed since
either: `premium_grants` is empty, so the round trip is still unproven against
the live database.

Migration 022 was applied to production and recorded by Supabase as
`20260828021445_atomic_focus_recording` on 2026-08-27. Production verification
confirmed its nullable UUID key, partial unique index, invoker mode, empty
search path, and service-role-only execution. A completed two-account focus is
still a required manual release check; schema inspection is not a substitute
for exercising the deployed client → server → database flow.

~~Open infra issue: `ALLOWED_ORIGIN` missing the www host~~ — **fixed
2026-08-12.** Verified: both `https://duodoro.live` and
`https://www.duodoro.live` now get a matching ACAO from Render.

---

## Done

- [x] **5. Mobile game screen** — PR #31, merged
- [x] **6. Silent failures read as data loss** — PR #32, merged
- [x] **7a. Sprite geometry** — PR #33, merged. The objectively-checkable half of 7.
- [x] **1. De-blur** — PR #35, **merged** (rebase, 7 commits on main).
      Whole-pixel transforms everywhere; the rule is in CLAUDE.md and enforced
      by `app/pixelMotion.test.ts`. Confirmed by eye on localhost: characters
      no longer float, walk reads clean.
- [x] **3b. GROUND + ART_PX** — PR #36, **merged** (rebase, 5 commits).
      The mechanical half. The density collapse moved into 7b — see below.

## Post-audit hardening

- [x] **14a. Socket payload boundary** — PR #48. Payload-bearing events reject
      non-object containers before field access; synchronous exceptions and
      async rejections stay inside the handler. Real-socket regression coverage
      proves malformed events do not stop the process.
- [x] **14b. Two-person session capacity** — PR #49. A distinct third user is
      rejected server-side, an existing participant can reconnect into a full
      room, and synchronous seat reservations close the concurrent-join race.
      Full rooms stop issuing invitations, and the rejected client clears its
      optimistic room state instead of remaining on an empty game screen.
- [x] **14c. Atomic focus recording** — PR #50. Migration 022 adds the
      service-role-only `record_focus_session` transaction and a unique,
      nullable per-round recording key. The server snapshots one key and one
      payload per focus round, retries transient failures without duplicating
      credit, rejects conflicting key reuse, and drains in-flight writes during
      shutdown. PostgreSQL verification covered first insert, identical retry,
      conflict rejection, participant-FK rollback, grants, invoker mode, and
      the pinned empty search path. **Migration 022 must precede deployment.**
- [x] **14d. Release confidence gate** — PR #51. A blocking Playwright job
      boots the production client and realtime server, then checks health,
      public sign-in entry points, social metadata, framework/browser errors,
      and portrait/landscape phone overflow. Failures retain screenshots,
      video, traces, and an HTML report. `docs/RELEASE_CHECKLIST.md` owns the
      credentialed two-account, live-data, real-device, OAuth, pet-art, and
      link-preview checks that CI cannot honestly prove.
- [x] **14e. Legal trust baseline** — PR #52. Inspectable Terms and Privacy
      pages now sit beside sign-in; authenticated users can review and withdraw
      marketing consent or permanently delete their account and linked data.
      The server accepts only the verified socket identity, removes the legacy
      email-keyed waitlist row, hard-deletes Supabase Auth, and relies on the
      audited foreign-key cascades for application records. Public legal copy
      describes actual processors, retention, deletion, contact, and marketing
      behavior. It remains product-authored and needs jurisdiction-specific
      review by qualified counsel before being treated as legal advice.
- [x] **14f. Production dependency advisories** — PR #54. Next.js moved from
      16.1.6 to the patched 16.3.3 release, React and its types moved to their
      matching patch versions, and compatible lockfile refreshes moved the
      Socket.IO, Engine.IO, `ws`, Express, PostCSS, Sharp, and Nano ID trees
      beyond their reported ranges. Production audits now report zero findings
      in the client, server, and legacy root manifest. Client/server CI fails
      on future high or critical production advisories.
- [x] **14g. Social reads fail visibly** — PR #55. Friend and request reads
      now publish explicit loading, loaded, and retryable failure states, and
      replace both lists atomically only after both queries succeed. The home
      presence summary reports an outage instead of disappearing like an empty
      result and can recover on retry or a realtime change. Accepting a friend
      request must return the updated row, so an RLS-filtered zero-row update
      is no longer treated as success.
- [x] **14h. Reproducible Supabase migrations** — PR #56. The legacy files
      now have canonical timestamp versions, a committed PostgreSQL 17 local
      project rebuilds the entire chain, and CI blocks on reset, schema lint,
      and a 37-assertion pgTAP contract. Production passed the corresponding
      read-only contract check before its 12 schema-present/history-missing
      versions were repaired; repository and production now list the same 22
      versions. `docs/DATABASE_WORKFLOW.md` owns creation, dry-run, deployment,
      verification, and rollback rules going forward.
- [x] **14i. Shareable first-session invites** — PR #57. A participant can
      copy a clean `/join/<token>` URL from the waiting room. Its opaque
      256-bit bearer token expires after 15 minutes, rotates when another link
      is created, is consumed with exactly one new-seat reservation, and never
      exposes the room UUID. The recipient's tab retains the invite across
      OAuth and first-run avatar setup, then redeems it automatically when the
      authenticated socket is ready. Expired, replayed, full-room, and
      non-participant attempts fail visibly.
- [x] **14j. Accessibility baseline** — PR #58. Mobile-hidden and icon-only
      controls retain accessible names; form controls, selection states,
      progress, phase changes, timers, errors, and success notices expose
      native or ARIA semantics. Critical overlays manage initial focus, trap
      Tab, close on Escape, and restore the opener; account popovers also
      support Escape. A global focus-visible ring and reduced-motion rules
      cover the full interface. WCAG A/AA axe scans now block the public
      light/dark surfaces and semantic component scans cover authenticated
      home, friends, account, and invite states. Light and dark semantic color
      tokens meet AA contrast on their application surfaces.
- [x] **14k. Honest companion positioning** — PR #59. Customer-facing Premium,
      Upgrade, and Pro language is replaced by one accurate offer: companion
      access is free with the OAuth-confirmed account email, while marketing is
      separate and optional. Home, session, pet locks, account settings, Terms,
      Privacy, and the release checklist now agree. Internal `is_premium`,
      `premium_grants`, and `claim_premium` names remain stable to avoid a
      cosmetic schema migration.
- [x] **14l. Realtime and RPC observability** — PR #60. The server emits
      privacy-safe structured JSON with opaque correlation references; raw
      identity, tokens, payloads, and arbitrary error messages are excluded.
      Every `record_focus_session` and `total_focus_seconds` attempt reports
      latency, outcome, retry state, and safe error classification. Runtime
      snapshots track connections, rooms, reconnects, rejected joins,
      persistence, presence, protocol failures, and process lifetime. `/health`
      remains liveness while cached, bounded `/ready` reports Supabase
      availability without upstream detail. The operations guide defines alert
      conditions; its external notification destination remains deployment
      configuration.
- [x] **14m. Hydration-safe local greeting** — PR #61. Home renders the stable
      neutral greeting “Hello” on the server, then reads the browser-local hour
      through `useSyncExternalStore` after hydration. A static-render regression
      test proves morning, afternoon, and evening copy cannot enter the server
      markup, while a client test pins the local-time result.
- [x] **14n. Injectable realtime app factory** — PR #62. `server/index.js` is
      now a thin environment and signal bootstrap; `server/app.js` owns one
      isolated HTTP/Socket.IO application instance with explicit `start()` and
      `stop()` lifecycle methods. Importing the factory does not bind a port,
      install process handlers, load service-role credentials, or start metric
      intervals. Probe and teardown tests protect that seam while the existing
      process and real-socket integration tests preserve production behavior.
- [x] **14o. Realtime payload parsers** — PR #63. Every payload-bearing socket
      event delegates field validation and normalization to pure parsers in
      `server/payloadParsers.js`. Avatar and pet allowlists, display-name caps,
      friend-list work bounds, invite-token limits, session references, and
      timer defaults/clamps are unit-tested independently of transport and live
      state. Rate limits and verified-socket authorization retain their original
      ordering, and unknown legacy fields remain ignored for compatibility.
- [x] **14p. Account and social handler services** — PR #64. Presence
      registration, account deletion, bounded online-friend lookup, and invite
      relay now live outside the app factory behind explicit dependencies.
      Direct service tests prove verified socket identity wins over payload
      claims, deletion failure remains retryable, all matching account tabs are
      disconnected, online results require friendship, invite presentation uses
      server-owned room state, and rate limiting still precedes parsing.
- [x] **14q. Phase and pet handler service** — PR #65. Start, flow-finish,
      stop, and companion-change events now live in an injected service outside
      the app factory. Direct tests preserve participant authorization, duplicate
      start rejection, authoritative timer scheduling, open-ended flow safety
      caps, elapsed-time break calculation, recording before round reset, timer
      cleanup, and focus-total-derived pet stages that ignore client claims.
- [x] **14r. Room membership handler service** — PR #66. Room creation,
      share-link issuance, and room admission now live behind explicit service
      dependencies. Direct tests pin server-owned worlds and pet stages,
      participant-only share links, authorization before leaving an existing
      room, synchronous seat reservation and token consumption before database
      reads, reservation cleanup, and reconnect socket/host re-keying.
- [x] **14s. Verified bulk task deletion** — PR #67. Personal-task and
      sticky-note bulk clears now request deleted IDs from Supabase, remove only
      rows the database confirms, and report partial success. RLS-filtered
      partner goals remain visible instead of disappearing from local state;
      hook tests cover partial and zero-row deletion responses.
- [x] **14t. Shared typed Socket.IO contract** — PR #68. One root declaration
      now defines every application event, payload, and acknowledgement for
      both directions. Client sockets and consumers use its generics instead of
      untyped `Socket`, the server app references the same maps, and a parity
      test proves every declared event is emitted and handled on both sides.
      Runtime payload parsing remains mandatory for custom clients.
- [x] **14u. Client connection/resume hook** — PR #69. Socket creation,
      handshake-token refresh, retry state, exhausted-retry recovery, manual
      reconnect, visibility/online handling, resync, and verified rejoin
      snapshots now live in `useSessionConnection`. `useGameSession` retains
      room/game events and actions behind one typed registration callback.
      Existing lifecycle regressions plus direct token-refresh and teardown
      tests protect the extracted boundary.
- [x] **14v. Generated Supabase database types** — PR #70. The browser client
      now carries a schema-generated `Database` contract and supplies it to
      `createClient`, so table writes, RPC arguments, and RPC results are
      checked against the rebuilt migration chain. Small row normalizers keep
      nullable database defaults out of UI state, and CI regenerates the file
      from a fresh local database and rejects schema/type drift.
- [x] **14w. `qs` denial-of-service advisories** — PR #71. The server lockfile
      now resolves Express and body-parser's compatible transitive `qs` range
      to 6.16.0, clearing both moderate advisories without changing Express or
      application code. The server production audit is back to zero findings.
- [x] **14x. Presence, invite, and reload resume** — PRs #72–#74 plus this
      follow-up. A two-account production pass still showed grey dots, refused
      in-app invites with “You can only invite friends,” and left a closed-tab
      player grayed-out in a waiting room. Friend lookup now unwraps a nested
      UUID[] RPC result and confirms via table filters when that parse is
      empty; resume lives in localStorage and returns to the game screen even
      from waiting, instead of treating Focus as “create a new session.”

## Next up (recommended order)

- [x] **3a. One palette** — this PR. Every art colour now lives in
      `lib/palette.ts`; the generated material ramps were already what the
      character and scenery art ran on, so the work left was the curated props,
      the UI sprites, and the fixed avatar ink. The eight `HORIZON` colours were
      a second copy of each world's sky and are now derived. No value changed —
      `WorldDecorations.colors.test.tsx` snapshots all eight worlds and proves
      it. `paletteGuard.test.ts` keeps a new literal from creeping back in.
      **Not verified in a browser:** it is a no-op by construction, but nobody
      has looked at a screen.
- [x] **7b-bg. Backgrounds** — PR #37, **merged** (rebase, 12 commits).
      All eight worlds redrawn; every one renders at exactly one art pixel and
      the "known backlog" guard now asserts an empty list. Root cause was not
      draughtsmanship: the hill bands were `preserveAspectRatio="none"` on a
      `w-full` SVG, i.e. *stretched* to ~45x10 per pixel, and MountainDecor
      drew one map at scale 5/6/7/8 in one frame. lofi retired for grocery
      (migration 019). Owner reviewed on localhost: "acceptable".
- [x] **11. Server-set rotating themes** — PR #38, 6 commits. Hourly on the
      :30, derived from the clock in `server/rotation.js` +
      `client/src/lib/rotation.ts`, order reshuffled every 8 slots. The open
      question below is **answered**: kept at one hour (the owner's spec) and
      fixed the daily repeat with the per-cycle shuffle instead of changing the
      interval. Home's picker is now `WorldNowCard`.
- [x] **7b-char. Characters + pets onto `PixelSprite`** — PR #39, 6 commits.
      Owner reviewed on localhost: pets, walk and sitting all approved.
      Both sprites are layered string maps now (`lib/characterMaps.ts`,
      `lib/petMaps.ts`) composited by `lib/pixelMap.ts`. The avatar blinks;
      pets went 10×11 → 9×7 (0.46× a person → 0.29×). `darken()` is gone —
      see below. Outlines were left one prop away and deliberately not turned
      on; item 4 turned them on, the owner didn't like them, and they came back
      off. `PixelCharacter`/`PetCharacter` still accept the prop.
- [x] **2. Premium button on home is a no-op** — PR #40. Wired through, and
      premium is now *grantable at all*: `claim_premium` (migration 020) turns
      it on free in exchange for the OAuth-confirmed email. Feature list is
      down to what exists. Stripe seam is `client/src/lib/billing.ts`.
      **Migration 020 must be applied before the deploy**, or the button
      raises `function claim_premium does not exist`.
- [x] **4. Contact shadow** — PR #41. `PixelSprite` has had an outline pass
      and `Grounded` a contact shadow since #37; what was missing is that
      `GameWorld` draws the characters itself and passed neither, so the two
      things the scene is about were the only two hovering. Shadow extracted
      to `components/ContactShadow.tsx` so the scenery and the characters
      share one recipe.
      **Outlines were tried on the characters and taken back off** at the
      owner's call, 2026-08-15 — see below.
- [x] **12. Pets level up and grow** — PR #42. Derived from completed focus
      (`server/petLevel.js` + `client/src/lib/petLevel.ts`, 3h / 15h), same
      two-copy pin as the rotation. Growth is more cells at `ART_PX`: young
      7×5, grown 9×7 (today's art), full 11×9. Stage travels in the slot as
      `petStage`; a client-sent value is ignored. Per user, not per pet.
      Premium stays the pet gate. **Not verified in a browser.**
- [x] **10. Launch surface** — PR #43. `metadataBase` is `https://duodoro.live`,
      so the generated OG/Twitter image is an absolute URL; the extra period
      on the tagline is gone; the duo mark is charcoal/paper instead of
      Tailwind emerald; the install splash uses `#171411` instead of gray-900.
      Copy and colours live in `client/src/lib/site.ts`.
- [x] **8. Emoji purge** — PR #44. `PetPicker` draws `PetCharacter`; friend
      rows and session history use `WorldThumb` (`WorldThumbnail` in a chip);
      PremiumModal opens on a cat instead of 🐾. The emoji fields on
      `PET_OPTIONS` and `WORLDS` went with them. **Not verified in a browser.**
- [x] **9. Pixel-ify the chrome** — this PR. Timer is Pixelify (`font-display`),
      HUD card is a chunky square (`border-b-4`, no blur), icons use square
      caps, waiting slot is a person-sized square, close buttons are
      `CloseIcon`. Root `README.md` covers what the product is and that git
      starts 2026-02-26. **Not verified in a browser.**

## ⚠️ Corrections to this file

Three "defects" originally listed under item 7 were checked against the source
and are **not real**. They have been struck out below. Verify before fixing:

- **Eye centring** — claimed `anime`/`sleepy` centre on 7.5. They don't: the head
  spans columns 3–12, so the axis is 8, and all three styles sit on it. **Now
  enforced** rather than argued — `characterMaps.test.ts` asserts the eye
  midpoint is 8 and that rows 3–11 are shape-symmetric, for every style.
- **"long" hair identical to "bob"** — the *front* layer is identical, but the
  back layer draws side drapes for `long` only (`lib/characterMaps.ts`,
  `HAIR_BACK`). Same fringe, longer sides: reasonable design, not a bug. Also
  enforced now — `characterMaps.test.ts` asserts the two share a fringe and
  differ overall.
- **PALM crown misaligned** — the crown and the trunk's *top* are both centred on
  column 7. The trunk then leans right by design over rows 5–10, which is what
  palm trunks do. Comparing the crown to the trunk's base and calling the
  difference an error mistakes the curve for a defect.

Partially true: **MOON** has **2** always-empty trailing columns, not 3. Cosmetic
bounding-box looseness — `right-[8%]` is off by ~10px at `scale={5}`. Left alone
deliberately; trimming moves the moon and there's no way to check the result
without looking. MOON's *two different palettes* are two different worlds' moon
tints (warm yellow vs lavender) — intentional, not a duplication bug.

---

## 1. De-blur the pixel art  ·  ~30 lines, mechanical, one sitting

Non-integer rotation and sub-pixel positioning resample hard edges into grey
fringe. This is why sprites look blurry **despite** `shapeRendering: crispEdges`
— the renderer is fine, the transforms aren't.

- `client/src/app/globals.css:112-133` — remove the ±1° `rotate()` from the
  character keyframes and the fractional `scaleY(1.05 / 0.92 / 0.96)`. Replace
  squash-and-stretch with integer `translateY` steps.
- `client/src/components/GameWorld.tsx:87` — the ±10° controller swing. Use a
  1-pixel horizontal shuffle or `scaleX(-1)` instead.
- `client/src/hooks/useCharacterPosition.ts:31` — returns
  `calc(${focusProgress * 42}% + 8px)`, animated on `left`, so the sprite sits
  on a fractional pixel and shimmers for the whole focus phase. Move to
  `transform: translateX()` on rounded integer px.
- `client/src/components/GameWorld.tsx:216,249` — `bottom: "calc(19% - 4px)"`,
  also fractional.
- Delete the dead `.pixel-sprite` class (`globals.css:93-96`, zero usages) and
  the no-op `imageRendering: "pixelated"` on `<svg>` elements
  (`PixelCharacter.tsx:220`, `PetCharacter.tsx:179` — it only affects rasters).

**Highest visual-impact-per-line in the codebase.** Do this first.

---

## 2. Premium button on the home screen is a no-op  ·  SHIPPED — PR #40

- `client/src/components/HomeDashboard.tsx:212-219` —
  `onClick={() => setProfileMenuOpen(false)}`. Closes the menu, does nothing
  else. `HomeDashboard`'s props (`:23-40`) have no premium callback at all;
  `DuoTimer` never passes one.
- `client/src/components/SessionTopBar.tsx:43,152-159` — wires it correctly.
  So the in-session path works and the *home* path silently dies. Home is the
  primary monetization surface.
- `client/src/components/PremiumModal.tsx` — the feature list is still mostly
  fiction. "Unlock all world themes" was removed in PR #38 (the rotation left
  nothing to gate). Remaining: "Focus stats & session history" while
  `StatsPanel`/`StatsScreen` are open to all; "Friend session notifications"
  while the Notification API appears nowhere in the codebase; "Exclusive
  premium character skins" while there are none. Only pets are actually gated
  (`PetPicker.tsx:20,34`).

**Shipped in #40.** `onOpenPremium` threaded through, list trimmed to the one
true item, and the bigger thing the audit missed: premium was not merely
unsold, it was **ungrantable**. `is_premium` defaults false, migration 010
revoked the client's write, and nothing else ever set it — so it was false for
all 10 users and pets had never been reachable by anyone, premium or not.

The owner's call was to give it away for a confirmed email address until there
are enough users for Stripe. No confirmation email is sent: all 10 users signed
in with Google or Discord, so `email_confirmed_at` is already set, and our own
link would re-verify something already verified while needing an email provider
this project doesn't have. `claim_premium` reads the address from `auth.users`
inside a `SECURITY DEFINER` function, so the client can't assert it.

Worth being explicit: **this is not a paywall.** Any authenticated user can call
the RPC and get premium. That is the intent until Stripe lands — see
`client/src/lib/billing.ts` for what that will need.

---

## 3. One palette + one pixel unit  ·  SHIPPED (3a + 3b)

The original claim was **146 hardcoded hex literals** in `client/src` against
17 theme tokens, drawn from three different published design systems. All three
of those sources are now gone:

- ~~`PetCharacter.tsx:23-37` — the most-copied Coolors palette, verbatim~~ —
  **gone in PR #39.** Pet colours are one base per animal with `shade()`
  deriving the rest. Characters likewise.
- ~~`lib/uiSprites.ts:16,25` — a *different* Coolors set~~ — **gone in this PR.**
  The four UI palettes moved into `lib/palette.ts` with every other colour.
- ~~`WorldDecorations.tsx` — 77 of the 146~~ — **gone in this PR.** The prop
  palettes (planet, palm, umbrella, bookshelf, lamp, cup, machine, fridge,
  crate, checkout, aisle sign, batten) are curated constants in `palette.ts`;
  the ambient washes (`GLOW`), the café interior (`CAFE_ROOM`) and the water
  (`SEA`) are named groups there too. `Ridge`/`Skyline`/`Shelving` use `INK`
  for their hard blends instead of `"#000000"`.
- `client/src/app/globals.css:10-49` — the warm-paper/charcoal theme tokens.
  Unchanged and deliberately not art: these are UI chrome, not the scene.

**3a — DID NOT go to a Lospec ramp.** `palette.ts` generates its ramps from
one rule (hue rotates toward the ambient shadow as a colour darkens, toward the
light source as it lightens) rather than importing Sweetie-16 or Apollo. That
was a deliberate call: a ramp copied from memory is a ramp nobody verified, and
the generated ramps are already what the character and scenery art is built on.
Swapping to a published ramp later means replacing constants in that one file.
The individual props that are not a material family are curated by hand at the
bottom of the same file, described there.

What "one palette" means now, and is enforced:
- `lib/palette.ts` is the only file that names an art colour.
  `paletteGuard.test.ts` fails if any other non-test source file contains a
  hex, with a short allowlist for UI chrome, brand marks, and data that *is*
  the colour (`avatarData.ts`'s avatar choices and per-world skies;
  `StickyNote`'s note colours).
- A world's sky is `skyStops` + the index of the horizon stop in
  `avatarData.ts`; the CSS gradient and the `HORIZON` distance-blend colour are
  derived from that one list. They used to be written down separately in two
  files and could drift.
- `WorldDecorations.colors.test.tsx` snapshots every colour each world paints.
  This PR's consolidation is A/B proven colour-neutral against the previous
  commit because of it, and a later deliberate recolour has to update it.

*Caveat, still true:* existing users have literal hexes in
`profiles.avatar_config`, so changing `SKIN_COLORS`/`HAIR_COLORS`/
`OUTFIT_COLORS` leaves them permanently off-palette without a nearest-colour
snap on load or a one-time SQL update. This PR changed no avatar colour, so
nobody is off-palette yet; it only decides where a future recolour goes.

**3b — DONE in PR #36, but only half of what this said.** `lib/scene.ts` now
exports `GROUND` and `ART_PX`; characters and pets are on `ART_PX`; `GROUND`
was six literals across three files, not two.

**The density collapse is not mechanical and has moved to 7b.** A sprite's
apparent pixel size *is* its scale, so a 16-cell map at `ART_PX` is a 48px
mountain, not a small-pixelled 128px one. Collapsing the scenery onto one unit
either shrinks it by half to two-thirds, or means redrawing every map at more
cells. Cost table is at the top of `WorldDecorations.tsx`; the worst is
`MOUNTAIN` at 43×27 cells instead of 16×10. **Superseded in practice:** PR #37
paid this off by redrawing every scenery map at more cells; every decor sprite
now renders at `ART_PX` and `WorldDecorations.test.tsx` asserts one density per
world with an empty exemption list.

Also corrected while doing it: the `calc(19% - 4px)` was not "people stand 4px
into the dirt". `bottom` positions the wrapper, and the wrapper's bottom edge
was the *name tag* — so characters floated a label's height **above** the
horizon while trees stood on it. Fixed by taking the tag out of flow. This is
part of item 4's "everyone appears to hover"; the contact shadow, since done,
was the rest.

---

## 4. Contact shadow  ·  SHIPPED (outline reverted)

**Shipped:** every grounded sprite, characters and pets included, now has a
one-art-pixel contact shadow from the shared `ContactShadow` component. That
half of this item was the "everyone appears to hover" complaint and it is done.

**Reverted:** character outlines. They were turned on across all eight worlds
and the owner didn't like the look. Taken back off 2026-08-15; `keylineOn()`
went with them. The scenery keeps its own keylines — those shipped in #37 and
were reviewed and accepted then.

Worth being straight about where this came from: **the owner never asked for
outlines.** It was written into this file by an earlier audit and got built
because the file said to. That is the failure mode the corrections section at
the top exists for — except here the *diagnosis* was right and the
*prescription* was too broad.

**The problem the outline was for is real and is now unsolved.** Contrast of
the worst-case hair colour against the sky at head height, measured:

| world | sky at head | worst hair | contrast |
|---|---|---|---|
| space | `#130840` | Black `#1A1A1A` | **1.06** |
| city | `#16213e` | Black | **1.09** |
| library | `#5d4037` | Brown `#5C3317` | **1.16** |
| grocery | `#cdd4cc` | Blonde | 1.47 |
| beach | `#FFD166` | Blonde | 1.54 |
| cafe | `#e8d5b7` | Blonde | 1.55 |
| forest | `#AEE5D8` | Blonde | 1.59 |
| mountain | `#E0F0FF` | Blonde | 1.91 |

1.00 is invisible. On Space a black-haired avatar's head is at 1.06 against the
air behind it — not a matter of taste, the head is genuinely not there.

Options if it is worth fixing later, cheapest first:

- **Outline on the three dark worlds only.** The five light worlds sit at
  1.47–1.91, low but readable; the outline bought nothing there and cost the
  look everywhere. `keylineOn()` is in this branch's git history.
- **Lift the sky's bottom stop** on space/city/library so the air behind a head
  is lighter. Changes the mood of worlds the owner already approved.
- **Rim-light the head only** — one lighter row along the top of the hair.
  More drawing, no border.
- **Leave it.** Three of eight worlds, two of six hair colours. Real, narrow.

---

## 5. Mobile game screen  ·  SHIPPED — PR #31

- `client/src/components/DuoTimer.tsx:339` — game screen is `h-screen` +
  `overflow-hidden`. On iOS Safari `100vh` exceeds the visible viewport, so the
  bottom of the HUD — including **end session** and **leave session**
  (`SessionHUD.tsx:269-282`) — sits under the browser toolbar, and
  `overflow-hidden` means you cannot scroll to reach it.
- `client/src/app/layout.tsx:48` — `viewportFit: "cover"` is set but there is
  **not one** `env(safe-area-inset-*)` anywhere in `client/src`. Top bar runs
  under the notch, bottom under the home indicator.
- In landscape the HUD card is taller than the viewport and covers the scene
  entirely.
- `client/src/components/GameWorld.tsx` — zero responsive breakpoints, sprites
  at fixed CSS px, so characters are the same 48px on a 360px phone as on a 27"
  monitor. The responsive-sprite half wants item 3b done first.
- `client/src/components/HomeDashboard.tsx:297` — 8 worlds in `grid-cols-4`
  gives 48px-tall thumbnails on a phone.

`Button.tsx` and `AvatarCreator.tsx` already show the touch-target pattern
(`w-11 h-11 sm:w-7 sm:h-7`) — extend it to the HUD.

---

## 6. Silent failures read as data loss

- `client/src/lib/useStats.ts:118-120` — catches every RPC failure into
  `console.error` and leaves the snapshot `EMPTY`.
  `HomeDashboard.tsx:264-270` then renders "Total 0m / This Week 0m / Streak 0d"
  — pixel-identical to a brand-new account. A returning user with a 40-day
  streak and one failed request sees their whole history apparently erased, with
  no error anywhere. `fetchStats(true)` already supports forcing, so a retry is
  cheap.
- `client/src/hooks/useAuth.ts:201-209` — `saveAvatar` never checks the update
  result, yet still calls `setMyAvatar`, caches to localStorage and advances to
  home. A failed write looks like success until you open another device.
- `client/src/components/DuoTimer.tsx:245-248` — the `display_name` update
  ignores `error` entirely. Contrast `:225-241`, which handles `claim_username`
  errors properly — the pattern is known, just not applied.
- `client/public/sw.js:1-16` — a deliberate no-op passthrough with no app-shell
  cache. An **installed** PWA with no network shows the browser's offline error
  page rather than a Duodoro screen. Cache a minimal shell; never cache socket
  or RPC responses.

Related convention already in CLAUDE.md as of #29: check `error` on reads, not
just writes. This item is the rest of that sweep.

---

## 7. Redraw the scale hierarchy + characters onto `PixelSprite`

The genuine art labour. Deliberately last so it lands on a finished system.

**Scale (judgment):** 3b did not enforce one density on the scenery — it could
not, see above — so 7b now owns both the redraw *and* the collapse. Depth has
to come from sprite *dimensions in art pixels*, not px-per-pixel. Character is
16×24 at `ART_PX` = 48×72px, therefore today:

- a pine tree (`PINE` 12×14 @ scale 4, `WorldDecorations.tsx:463`) is 56px —
  **shorter than a person**, with 33% bigger pixels
- a skyscraper (`BUILDING_TALL` 9×16 @ scale 3, `:597`) is 48px — two-thirds a
  person's height
- a mountain (`MOUNTAIN` 16×10 @ scale 8, `:635`) is 80px — **11% taller than a
  human**
- ~~pets are 20px with pixels ⅔ the character's~~ — **density fixed in PR #36**,
  ~~but they are now 30×33, i.e. a cat 0.46× a person's height~~ — **size fixed
  in PR #39**: redrawn at 9×7, so 27×21 px, 0.29× a person. `size` stayed at
  `ART_PX`

A 16-px-tall person needs a ~28px tree, ~60px tower, ~40px mountain range, plus
explicit far/mid/near variants differing by *value*, not scale.

**Characters (judgment):** `PixelCharacter.tsx` (338 lines) and
`PetCharacter.tsx` (187 lines) are ~90 literal `<rect x= y=>` elements with
inline coordinates — they do **not** use `PixelSprite`. So the two sprites users
look at most can't be palette-swapped, outlined, blinked or given a second idle
frame without editing numbers by hand. Rewrite as layered string maps (`base`,
`hair-back`, `hair-front`, `eyes-open`, `eyes-shut`, `outfit`).

Latent bugs to fix while redrawing:

- ~~`PetCharacter.tsx` cat/rabbit clipped foot~~ — **fixed in PR #33.** Both drew
  a leg at row 10 inside a 10-row viewBox, so each walked on one leg, alternating
  which. All four pets now share an 11-row grid.
- ~~eye centring~~ — **not a real defect.** See corrections at the top.
- ~~`long` hair identical to `bob`~~ — **not a real defect.** See corrections.
- ~~`darken(skinColor, 0.08)` is a naive RGB multiply~~ — **fixed in PR #39.**
  Confirmed: it shifted the deepest skin by 0.016 lightness against 0.071 for
  the palest. `shade()` in `palette.ts` drops lightness by a fixed amount while
  holding chroma; `flush()` derives blush from the skin. Two earlier
  implementations each fixed half of it — blending toward a fixed dark tone
  leaves near-black hair *lighter* than its shadow, and holding HSL saturation
  turns pale skin pink. Both are regression tests now.
- ~~`CUP_PALETTE` H identical to C~~ — **fixed in PR #33**, handle now uses the
  saucer shade.
- ~~`PALM` crown misaligned~~ — **not a real defect.** See corrections.
- `MOON` — 2 always-empty trailing columns. Cosmetic; see corrections.

~~Then add a blink frame every 4–6s and a 2-frame idle.~~ **Blink shipped in
PR #39** (4–6.5s, jittered, 130ms, off under `prefers-reduced-motion`). The
2-frame idle did *not*: `pixel-idle` still carries the whole motion, and a
second body frame on top of it looked busy in the static dump. Worth trying
once someone has watched the current version move.

`PixelCharacter` and `PetCharacter` still accept an `outline` prop and nothing
passes one. That is now deliberate rather than pending — see item 4: it was
turned on across all eight worlds, reviewed, and reverted. The prop stays
because the dark-world legibility problem it was for is real and unfixed, and
a per-world outline is the cheapest way back.

---

## 8. Emoji purge  ·  SHIPPED — this PR

`lib/uiSprites.ts:3` says sprites exist for "anywhere an emoji would break the
pixel-art look" and `Icons.tsx:1` says the set "replaces emoji in UI chrome" —
yet those replacements were unused:

- ~~`PetPicker.tsx` 🐱🐶🐉🐰/🔒~~ — `PetCharacter` at grown, `LockIcon` when
  gated.
- ~~`FriendsPanel` / `FriendsOnlineSection` world emoji~~ — `WorldThumb`, a
  sized `WorldThumbnail`. Same swap in `StatsPanel` / `StatsScreen`, which
  had a three-world emoji table and fell back to 🌍 for grocery/library/cafe.
- ~~`PremiumModal` 🐾~~ — a cat. The old feature-list emoji died in #40 with
  the fiction; this was the last one.

The `emoji` field on `WORLDS` and `PET_OPTIONS` had no remaining callers and
came off. Close buttons still used ✕; that moved to item 9.

**Not verified in a browser.**

---

## 9. Pixel-ify the chrome  ·  SHIPPED — this PR

~~The timer — the largest element in the product — was Geist Mono
(`SessionHUD.tsx`) while Pixelify Sans was already loaded.~~ `hud-timer` is
`font-display`. The HUD card dropped `rounded-2xl backdrop-blur shadow-xl`
for a square `border-2 border-b-4`. Status dots and `Button` sizes lost their
pills. Icons use `strokeLinecap: "square"` / `miter` instead of Feather
rounds. The waiting slot is a person-sized square (`CHAR_W × CHAR_H` at
`ART_PX`), not a dashed circle with "?". Close controls use `CloseIcon`.

A root `README.md` now describes the current product (rotating worlds, email
premium, growing pets) and that git starts on 26 February 2026. The
create-next-app stub in `client/README.md` is a pointer to it.

**Not verified in a browser.**

---

## 10. Launch surface  ·  SHIPPED — PR #43

- ~~no `openGraph.images` and no `metadataBase` → every shared link renders a
  blank card~~ — `metadataBase` is `https://duodoro.live`; `app/opengraph-image.tsx`
  (and `twitter-image.tsx` re-exporting it) is the card. Next fills
  `og:image` from the file convention.
- ~~`app/layout.tsx:40` — typo: `"Focus together, anywhere.."`~~ — one period,
  and the string lives in `lib/site.ts` so layout, the OG alt text, and the
  manifest cannot drift.
- ~~`public/icon.svg` is a placeholder: two white circles on emerald `#10b981`~~
  — same duo mark (two people), now charcoal `#171411` and paper `#f3ede1`.
  `apple-touch-icon.svg` matches, without a rounded rect so iOS does not
  double-round.
- ~~`manifest.webmanifest` sets `theme_color: "#111827"`~~ — `app/manifest.ts`
  reads `DARK_BG` from `lib/site.ts`, same value as the dark viewport
  `themeColor`. The static JSON in `public/` is gone so there is not a second
  copy to forget.

**Not verified:** crawlers (iMessage, Slack, Twitter) have not been shown a
deployed card. The unit tests pin the copy, the origin, and the colours;
whether the PNG *looks* right needs an owner's eye on `/opengraph-image`.

---

## 11. Server-set rotating themes  ·  SHIPPED — PR #38

The owner's call, 2026-08-12: model the theme the way PEAK models its mountain
— one world, chosen by the server, the same for everybody, rotating on a clock.
Home loses its world picker entirely; you press **Focus** and the theme is
whatever the world is currently on.

**Rotation:** every hour, on the **:30**. Not on the hour — the offset is the
point, so the change doesn't land at the same moment as everyone's o'clock
pomodoro boundary.

**Derive it, don't store it.** The active world must be a pure function of wall
clock, so every server instance, every client and every late joiner agree
without coordination and without a round trip:

    index = floor((Date.now() - THIRTY_MIN) / ONE_HOUR) % VALID_WORLDS.length

No DB row, no timer, no broadcast needed to *know* the theme. Nothing to drift,
nothing to resync after a restart — which matters because all session state is
already in memory and dies with the process.

**A session keeps the theme it started with.** Rotation applies to *new*
sessions only. Swapping the scene under two people 20 minutes into a focus
block is a worse experience than a slightly stale theme, and it would also make
`sessions.world_id` ambiguous for the history rows.

Changes this needs:

- `server/index.js:463,492` — `create_session` currently takes `world` from the
  client and validates it against `VALID_WORLDS`. It should stop accepting the
  field and assign the derived one. The validation disappears with the input.
- `client/src/components/HomeDashboard.tsx:297-315` — the 8-world `grid-cols-4`
  picker goes. Replaced by one Focus button; showing "next theme in MM:SS"
  is free, since the client can derive it with the same function.
- Put the derivation in one shared place. It cannot be imported across the two
  packages (`client/` and `server/` are independent npm packages with their own
  lockfiles) so it will be duplicated — keep both copies next to a comment
  naming the other, and cover both with the same table of timestamps.
- `sessions.world_id` and `sessions_world_check` (migration 008) are unaffected;
  the value is still one of the eight. `profiles.current_world_id` likewise.
- Item 2's `PremiumModal` copy must lose "unlock all world themes" — with
  server-set themes there is no per-user world choice left to gate.

~~**Open question for the owner:** eight worlds at one hour each is an
eight-hour cycle, so someone who always focuses at 9am sees the same world
every day.~~ **Answered in #38.** Kept the hour and the :30 as specified, and
shuffled the *order* per cycle instead of changing the interval. A cycle is
still all eight worlds, so the "see everything in eight hours" property holds,
but which eight-hour permutation you get depends on the cycle number — so 9am
moves. A fix-up stops a cycle opening on the world the last one closed with.
Verified uniform across positions over 80k cycles (±2% of 1/8) with zero
boundary repeats.

**What actually shipped, beyond the design above:**

- The shuffle uses an integer hash (`Math.imul` + xor-shift), *not* the
  `Math.sin` seeding in `lib/terrain.ts`. ECMA-262 doesn't require
  transcendentals to be bit-identical across engines; a 1-ULP difference moves
  a rock in the scenery but would put the client and server in different
  worlds.
- `send_invite` also stopped trusting a client-sent `worldId` — the server
  reads it off the session. It was relaying an attacker-controlled world label
  into a full-screen popup on someone else's machine.
- `VALID_WORLDS` is gone from `server/index.js`; `ROTATION_WORLDS` is the one
  list.
- `server/createSession.test.js` is the package's first handler-level test —
  boots the real server on an ephemeral port over a real socket. `PORT=0` works
  now because the boot log prints the *bound* port.

**Not verified:** nothing here has been looked at in a browser. Worth checking
by eye — the countdown ticking on home, and that a session left open across a
:30 keeps its own world rather than swapping under you.

---

## 12. Pets level up and grow  ·  SHIPPED — PR #42

The owner's call after previewing #39: pets earn levels and get **bigger** as
they level. A companion that visibly changes because of hours you actually put
in is the first thing in the product that rewards returning, and it lands on a
pet system that is now cheap to extend.

**Growth is redrawn maps, not a scale multiplier.** This is the whole design
constraint and it is not negotiable — it is the same lesson as the density
collapse in 3b/7b. A sprite's apparent pixel size *is* its scale, so rendering
the 9×7 cat at `size={4}` is not a bigger cat, it is the same cat with bigger
pixels next to a person whose pixels didn't change. Growth means a map with
*more cells* at the same `ART_PX`. Budget three sizes:

| stage | cells | px at ART_PX | vs. a person |
|---|---|---|---|
| young | 7×5 | 21×15 | 0.21× |
| grown (today's art) | 9×7 | 27×21 | 0.29× |
| full | 11×9 | 33×27 | 0.38× |

Three maps per pet × four pets = twelve, plus two walk frames each. That is the
real cost of this feature and it is mostly drawing. Stop at 0.38×: a companion
taller than half its owner stops reading as a pet.

**Derive the level, don't store it.** Same instinct as the rotation (item 11)
and for the same reason — a stored counter is a thing to migrate, resync and
reconcile, and it can disagree with the history it is supposed to summarise.
Total focus minutes already exist in `sessions`/`session_participants`, and
`lib/useStats.ts` already reads them. `level = f(totalFocusMinutes)` needs no
new column, cannot drift, and is automatically right for existing users on the
day it ships — everyone's back catalogue counts.

**What actually shipped, settling the open questions:**

- **Per user, not per pet type.** One number, the `sum(actual_focus)` that
  already exists. Switching cat → dog keeps the size.
- **Partner sees the same animal.** `petStage` travels in the slot;
  `buildSyncPayload` / `player_joined` / `pet_changed` carry it.
  `focusSeconds` stays off the wire. A client-sent stage is ignored, same
  shape as `world`.
- **Thresholds:** young → grown at **3 hours** (10800 s), grown → full at
  **15 hours** (54000 s). First change is inside a week of two 25-minute
  sessions a day. Both packages pin the same table of seconds.
- **Premium stays the pet gate.** Levelling is not a second lock.
- A completed focus credits the in-memory total so a pet can grow in the
  room it earned it, rather than on the next join.
- Grown maps in `lib/petMaps.ts` are the #39 art, unchanged. Young and full
  are the same silhouettes with less or more room. `size` stays `ART_PX`.
- A missing `petStage` (older server) renders as grown, so a client-first
  deploy does not shrink every pet to young.

**Follow-up, shipped after #42:** the focus total is one RPC
(`total_focus_seconds`, migration 021, service_role only) instead of a
PostgREST select of one row per completed session summed in
`server/focusTotal.js`. The old read grew with a user's history, ran on every
create and join, and was silently truncated by the project's API "Max rows"
setting — at the 1000-row default that is ~400 hours, far past the 15-hour
`full` threshold, so it could not have changed anyone's stage. This is
efficiency and hygiene, not a bug that was biting.

**Not verified:** nothing here has been looked at in a browser. The young
and full silhouettes need an owner's eye — geometry tests catch clipping and
grid size, not whether a 5-row cat still reads as a cat.

---

## 13. Mobile sprite scaling  ·  SHIPPED — this PR

The scene is a full-bleed background, so a 16x24 character was 48x72 CSS px on
a 360px phone and 48x72 on a 27" monitor. `artPxFor(width, height)` picks
between `ART_PX` (3) and `ART_PX_COMPACT` (2) off the measured scene box, and
`ScenePixel` publishes it so the whole frame moves together — characters, pets,
contact shadows, terrain bands and all eleven decor components.

- **Two stops, both whole numbers.** `ART_PX * 0.75` would put every sprite on
  a fractional pixel, which is the blur this art cannot survive.
- **Thresholds are the ones already in the codebase**: 640 (Tailwind `sm`) and
  520 (the `max-height` query in `globals.css`). The height clause is what makes
  landscape work.
- **An unmeasured box answers desktop.** 0 is what the first frame, jsdom and a
  server render all report.
- `HeroScene` and `AvatarCreator` are deliberately left out: their boxes are
  cards, not viewports, so a 224px-tall card would read as a phone on every
  screen.

**Open decision — the break prop's density.** `BreakOverlay` has drawn at a
hardcoded `scale={4}` against a scene at 3 since long before this PR, and
nothing caught it because `GameWorld`'s density tests only ever looked at the
character and pet maps. This PR did *not* fix it, because dropping it to the
scene's pixel is a 25% shrink of an approved desktop visual and that is the
owner's call, not a side effect of a mobile change. It now tracks the scene one
step above it (`useArtPx() + 1`), so it is at least consistent across screens.
Two real options: drop it to `artPx`, or redraw the prop maps with more cells so
it keeps its size at one density. **Never** fix it by scaling the small map up.

**Not verified:** nothing here has been looked at in a browser. The compact
scene in particular needs an owner's eye on a real phone — the tests prove one
density and whole numbers, not that a 32x48 character still reads.

---

## Also worth knowing

- **Free assets:** palettes yes, sprites no. A Lospec ramp is zero bytes, no
  licence risk (CC0 needs no attribution), and hands you the hardest thing to do
  without training. CC0 sprite tilesets are cheap and tiny too, but the avatar
  recolours at runtime from user-chosen hex, which a flat PNG can't do without
  canvas tinting — and dropping an asset artist's characters next to hand-coded
  scenery trades "inconsistent within one style" for "two styles".
- **There are no image assets at all.** `client/public/` holds six SVGs, five of
  which are untouched Next.js starter files (`file.svg`, `globe.svg`,
  `next.svg`, `vercel.svg`, `window.svg`). Every pixel is generated at runtime.
  Nothing mangled the art — there was never an art *system*.
- **Accessibility:** 12 `aria-*` attributes total across ~85 buttons, with
  icon-only controls unlabelled.
- **Test coverage:** `useAuth.ts` is 234 lines gating every screen transition
  and has no tests.
- **Unverified in the browser:** everything from PRs #26–#30. #35/#36 were
  checked by hand on localhost 2026-08-12 — characters no longer float, walk
  reads clean; pets and the jump/float/controller keyframes were *not* looked
  at (pets are premium-locked, the rest need a two-account session). Still
  worth checking: tick a partner's shared goal and confirm the "✓ by" byline
  sticks; mute mid-jingle then reload; background a session tab 90s and
  confirm you're still in it.
