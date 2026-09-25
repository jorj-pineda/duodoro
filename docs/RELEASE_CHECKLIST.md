# Duodoro release checklist

Use this for every production release, after CI passes and before calling the
release complete. The browser smoke suite covers stable public behavior; this
checklist covers authenticated, two-account, live-database, device, and visual
behavior that dummy CI credentials cannot prove.

Record evidence without copying private task text, access tokens, OAuth codes,
or real user data into issues or pull requests. A failed required check blocks
the release until it is fixed or explicitly rolled back.

## Release record

- Commit or PR:
- Preview URL:
- Production URL:
- Tester:
- UTC date:
- Browser/device versions:
- Supabase migrations applied through:
- Result: PASS / FAIL / BLOCKED
- Evidence links:
- Follow-up issues:

## 1. Automated gate

- [ ] GitHub `Server tests` passes.
- [ ] GitHub `Client tests & build` passes.
- [ ] GitHub `Browser release smoke` passes.
- [ ] The automated axe baseline reports no WCAG A/AA violations on landing,
      Terms, or Privacy in the tested light/dark appearances.
- [ ] The browser-smoke job confirms the app and realtime health endpoints,
      public landing content, Google and Discord entry points, canonical Open
      Graph/Twitter metadata, absence of browser errors/framework overlays,
      and no horizontal overflow in phone portrait or landscape.
- [ ] If browser smoke fails, inspect its uploaded screenshot, video, trace,
      and HTML report before retrying.

Local reproduction from a completed production build:

```sh
cd client
npx playwright install chromium
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-dummy-anon-key \
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001 \
npm run build
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-dummy-anon-key \
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001 \
npm run test:e2e
```

## 2. Deployment and schema

- [ ] Every migration required by the release is applied before dependent
      application code. Record the highest migration above.
- [ ] `https://duodoro.live` loads the intended commit.
- [ ] The Render root and `/health` endpoints return success; `/ready` returns
      200 with `dependencies.database = "ready"`.
- [ ] The paid Render Key Value instance uses Journal + Snapshot persistence and
      `noeviction`; its internal URL is set as `FOCUS_QUEUE_URL` on the realtime
      service before deployment. The URL is absent from Git and browser settings.
- [ ] Render logs show `server_started` and a `runtime_snapshot` as valid JSON,
      without raw account, socket, session, email, token, or payload values.
- [ ] The connected log platform alerts on `focus_record_failed` and repeated
      failed `database_readiness_probe` events, plus Key Value read/write
      failures and repeated replay failures; the destination is current.
- [ ] Both `https://duodoro.live` and `https://www.duodoro.live` receive a
      matching CORS allow-origin response from the realtime server.
- [ ] No new errors appear in Vercel, Render, or Supabase logs during smoke.

## 3. Authentication and account lifecycle

Use designated test accounts, not personal accounts with private data.

- [ ] Google sign-in returns to the production domain and reaches the expected
      first-run or home screen.
- [ ] Discord sign-in returns to the production domain and reaches the expected
      first-run or home screen.
- [ ] A first-run account claims a username and saves its avatar/display name.
- [ ] Refresh restores the signed-in profile and avatar.
- [ ] Sign-out returns to the landing page; signing back in restores the same
      account rather than creating a duplicate profile.
- [ ] Privacy & account loads the current marketing preference; turning it off
      persists `marketing_opt_in = false` without removing companion access.
- [ ] A designated disposable account can type the exact confirmation phrase,
      delete itself, return to the landing page, and cannot reconnect or sign
      back into the deleted Duodoro account. Confirm its profile, friendships,
      owned tasks, participant links, companion access grant, and matching
      waitlist row are gone without inspecting or recording another user's
      private data.

## 4. Two-account focus flow

Use account A in one browser profile and account B in another.

- [ ] A sends B a friend request; B accepts; both friend lists agree.
- [ ] A creates a room and invites B; B joins the intended room.
- [ ] A copies a waiting-room invite link; a signed-out B opens it, completes
      OAuth and first-run avatar setup if required, and automatically joins
      A's intended room without becoming friends first.
- [ ] Reopening that consumed link fails visibly; creating a second link
      invalidates the first; a link older than 15 minutes reports expiry.
- [ ] A third distinct test account is rejected from the two-seat room.
- [ ] Starting focus synchronizes mode, duration, world, and countdown.
- [ ] A normal focus completion advances both clients through celebration,
      break, returning, and the next focus round.
- [ ] Stopping focus early returns both clients to waiting.
- [ ] Leaving removes the correct player and clears their presence.
- [ ] Refresh during focus rejoins within the reconnect grace window.
- [ ] Background a phone tab for at least 90 seconds, return, and confirm timer
      and room state resynchronize.

## 5. Durable collaboration data

- [ ] A completed focus appears once—not zero or twice—in both participants'
      history/stats.
- [ ] That completion emits a successful `record_focus_session`
      `supabase_rpc_attempt` and one `focus_record_completed` event sharing the
      same opaque `room_ref` used by the session lifecycle logs.
- [ ] An early stop appears with the expected incomplete duration and does not
      increase completed-focus pet progress.
- [ ] A creates a shared goal; B completes it; both clients show B's persisted
      completion byline after refresh.
- [ ] Temporarily interrupting a read shows an unavailable/retry state rather
      than an empty-history or empty-friends claim.

## 6. Companion access and pet progression

- [ ] With a designated test account, run the companion-access claim against
      production and verify both `premium_grants` and `profiles.is_premium`.
- [ ] Reload and confirm companion access remains enabled.
- [ ] Select and change a pet; both participants see the same pet and stage.
- [ ] Using controlled focus history, inspect young, grown, and full maps for
      every pet at whole-pixel density with no clipping.
- [ ] Remove or clearly label any controlled test rows after verification.

### 6a. Local automated coverage (not a substitute for the above)

`server/privilegedWrites.integration.test.js` exercises migrations 020 and 022
against a real PostgreSQL, real `auth.users` rows, and the shipping server
modules — the round trip that schema inspection cannot prove. It runs the
`claim_premium` grant (grant row **and** `profiles.is_premium`), idempotent
re-claim, rejection of a direct client write to `premium_grants`,
`record_focus_session` for two participants, retry idempotency,
conflicting-key rejection, completed-only pet totals, and the round appearing
once in `get_focus_stats`.

```sh
supabase start
cd server && npm run test:integration
```

It is excluded from `npm run test:run` (which CI runs without a Supabase) and
cleans up every user and session it creates. **Passing this does not tick the
boxes above:** it runs locally with synthetic data, not against production with
a real OAuth account, and it does not prove the browser, the invite flow, the
pet renders, or anything a second human sees. The production round trip stays a
required manual check.

## 7. Phone and visual checks

Run on a real phone in portrait and landscape; browser emulation alone does not
prove safe areas, browser chrome, touch reachability, or background-tab behavior.

- [ ] Landing, avatar, home, waiting, focus, break, stats, friends, tasks, and
      companion-access screens have no clipped or unreachable controls.
- [ ] Close/back/leave/stop controls remain reachable around notches and home
      indicators.
- [ ] Character, pet, terrain, timer, and break-prop pixels remain crisp.
- [ ] Young/grown/full pets read as the intended animal beside a character.
- [ ] Theme toggle and sound mute persist after reload.
- [ ] Complete the landing → home → waiting → focus path with only a keyboard;
      focus remains visible, overlays contain focus, Escape closes them, and
      focus returns to the opening control.
- [ ] With a screen reader, verify icon controls have useful names and that
      connection failures, invite results, session errors, and phase changes
      are announced once without continuously reading the timer.
- [ ] With reduced motion enabled at the OS/browser level, decorative loops and
      interface transitions no longer move while all controls remain usable.

## 8. Launch surface

- [ ] Fetch the deployed Open Graph image directly and visually inspect it.
- [ ] Fetch the production URL with a real link-preview debugger or messaging
      client and confirm title, description, image, and canonical URL.
- [ ] Manifest, icon, install splash, and light/dark theme colors match the
      current Duodoro identity.
- [ ] Terms and Privacy links resolve and match the data practices in the
      current release.

## Release decision

- **PASS:** every required box is checked and no unresolved blocker exists.
- **FAIL:** a required behavior is wrong; fix or roll back before release.
- **BLOCKED:** credentials, provider access, device access, or production
  visibility is unavailable. A blocked check is not a pass and must name its
  owner and follow-up date in the release record.
