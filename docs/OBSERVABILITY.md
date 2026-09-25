# Realtime observability

The Render realtime process writes one JSON object per application log line.
This is intentionally vendor-neutral: Render can retain and forward stdout and
stderr without the application taking a dependency on a monitoring SDK.

## Privacy boundary

Application logs must not contain raw account IDs, socket IDs, session IDs,
display names, email addresses, bearer tokens, authorization headers, or event
payloads. `server/observability.js` recursively removes fields with those names.
Use `correlationRef()` when events need to be connected across a room, socket,
or account; it emits a stable 12-character SHA-256 reference instead of the
source identifier. Error records include type, database/API code, and HTTP
status, but never `error.message`, which may contain private database detail.

Do not call `console.log`, `console.warn`, or `console.error` directly in server
code. Add a named event through the shared logger and use fixed, low-cardinality
values for outcomes and reasons.

## Probes

- `GET /health` is process liveness only. It does not contact Supabase and
  returns `200 {"ok":true}` whenever Express can answer.
- `GET /ready` is traffic readiness. In production it calls the service-role-only
  `total_focus_seconds` function for the zero UUID, without reading any user's
  history. This catches a reachable database configured with an anon key. The
  probe is cached for five seconds and bounded to two seconds.
  It returns 200 with `database: "ready"`, or 503 with
  `database: "unavailable"`. It never returns the upstream error.
- Without Supabase configuration, local/test mode returns 200 with
  `mode: "development"` and `database: "disabled"`.

Render's health check should continue using `/health` so a transient database
incident does not create a restart loop. Deployment verification and an uptime
monitor should check `/ready` as well.

## Signals

The most important events are:

| Event | Meaning |
| --- | --- |
| `supabase_rpc_attempt` | One `record_focus_session` or `total_focus_seconds` attempt, including outcome, duration, attempt number, and retry intent |
| `focus_record_completed` | The completed round was inserted or confirmed idempotent |
| `focus_record_failed` | All persistence attempts failed |
| `database_readiness_probe` | The cached readiness probe refreshed successfully or failed |
| `authentication_not_started` | A public client connected before it had a token; informational, not an auth failure |
| `authentication_rejected` / `authentication_failed` | A supplied credential was invalid or the verification dependency failed |
| `protocol_payload_rejected` | A malformed inbound Socket.IO payload was refused |
| `protocol_handler_failed` | A contained socket handler threw or rejected |
| `presence_write_failed` | A profile presence update failed instead of being silently discarded |
| `runtime_snapshot` | Once-per-minute counters, gauges, RPC duration aggregates, and process uptime |

Runtime snapshots include connected sockets, active sessions, pending focus
recordings, connections/disconnections, authentication outcomes, session
starts/closes/reconnects, rejected joins, protocol failures, presence failures, focus-record
success/failure, and RPC attempts/retries/outcomes. Durations contain count,
total milliseconds, and maximum milliseconds for the life of that process.
They reset on deploy or restart; `process_starts_total` and `uptime_seconds`
make that boundary explicit.

## Alerts and response

Configure the log destination to alert immediately on either:

- `event = focus_record_failed`; or
- `event = database_readiness_probe` and `outcome = failure` for two
  consecutive probe refreshes.

Also investigate a sustained rise in `protocol_handler_failures_total`,
`presence_write_failures_total`, or `session_join_rejections_total`, and RPC
latency whose maximum remains materially above its normal baseline.

For a focus-record alert:

1. Use `room_ref` to group the failure with preceding RPC attempts. Do not ask
   for or reconstruct the raw room or account ID from logs.
2. Check `outcome`, `error_code`, `error_status`, `attempt`, and `retrying` on
   `supabase_rpc_attempt`.
3. Check `/ready`. If unavailable, inspect Supabase status and project health.
4. After recovery, complete one designated two-account focus and confirm one
   row—not zero or two—was recorded for that round.

The repository provides alertable events and the response contract. The actual
notification destination (for example, the owner's email or incident service)
must be configured in the connected log platform; no destination or credential
is committed here.
