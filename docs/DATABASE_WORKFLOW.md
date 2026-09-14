# Database migration workflow

The committed migration directory is the schema source of truth. Supabase
production is a deployment target, not an editor. Every schema change starts
locally, survives a clean PostgreSQL 17 rebuild, passes the schema contract,
and reaches production through the CLI migration history.

## Tooling and local rebuild

Use Docker and Supabase CLI `2.116.0`, the version pinned in CI. The committed
`supabase/config.toml` uses ports `55320`–`55329` so it can coexist with another
default local Supabase project.

```sh
supabase start
supabase db reset --local --no-seed
supabase db lint --local --level warning --fail-on error
supabase test db
supabase stop --no-backup
```

The pgTAP contract checks structure. For behaviour — that a privileged function
does what its comment claims against real data — run the integration suite from
`server/` after `supabase start`:

```sh
cd server && npm run test:integration
```

It creates real confirmed users, drives migrations 020 and 022 through
PostgREST, and removes everything it created. It is excluded from `test:run`
because CI's server job has no Supabase.

`supabase/tests/schema_contract.sql` checks the application tables, important
columns and indexes, final RLS policy set, realtime publication, signup trigger,
and the execution boundary around privileged functions. It is deliberately a
contract: an intentional schema change updates both the migration and its test.

## Creating a migration

```sh
supabase migration new short_snake_case_name
```

Put only forward SQL in the generated timestamped file. Make it safe for the
actual data already in production: add nullable/backfillable structures before
enforcing constraints, pin every `SECURITY DEFINER` search path, revoke default
`PUBLIC` function execution when it is not intended, and make client writes
prove that a row was returned when RLS may filter the operation to zero rows.

Run the complete rebuild and contract above. Do not validate a new migration by
running only that file against an already-mutated local database.

## Deploying

Link/authenticate the CLI through local credentials or protected CI secrets;
never commit an access token or database password.

```sh
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
supabase migration list --linked
```

The dry run must name only the migrations intended for that release. Stop if a
local or remote version is unmatched. Do not bypass the mismatch with
`--include-all`; first inspect whether the SQL is missing or only the tracking
row is wrong. After a DDL deploy, run the Supabase security and performance
advisors and the relevant checks in `docs/RELEASE_CHECKLIST.md`.

Never run `supabase db reset --linked`: remote reset drops user-created objects.
Never make a production schema change in Table Editor or SQL Editor. An urgent
hotfix still gets a migration file and the same verification before deployment.

## Legacy history reconciliation

The first 22 files originally used `001_...` through `022_...`. Some were run
manually and ten were later recorded under timestamp versions. Their canonical
filenames now use those recorded versions where available and UTC commit times
for the previously untracked rows.

| Legacy | Canonical version | Production history before repair |
|---|---:|---|
| 001 | `20260226231035` | schema present, row missing |
| 002 | `20260301005324` | schema present, row missing |
| 003 | `20260301010944` | schema present, row missing |
| 004 | `20260302222304` | schema present, row missing |
| 005 | `20260313212753` | schema present, row missing |
| 006 | `20260315223924` | schema present, row missing |
| 007–015 | recorded timestamps in filenames | row already matched |
| 016 | `20260809045643` | schema present, row missing |
| 017 | `20260811155613` | schema present, row missing |
| 018 | `20260811155614` | schema present, row missing |
| 019 | `20260812220106` | schema present, row missing |
| 020 | `20260814194352` | schema present, row missing |
| 021 | `20260820002800` | schema present, row missing |
| 022 | `20260828021445` | row already matched |

History repair is metadata-only: it must happen only after the production
schema contract is inspected successfully. It does not execute migration SQL.
The exact repaired versions are recorded in `docs/PRODUCTION_SCHEMA.md`; their
rollback is to mark only those versions reverted, never to undo their schema.
