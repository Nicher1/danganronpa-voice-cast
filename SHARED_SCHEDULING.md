# Shared session scheduling

Installed on project `srdyjehnvsmscmeuhcvh` on 21 October 2026. The shared
schedule and the once-per-minute cron job are active. Email remains deferred.

The planner uses `cast_schedules`, independently of `cast_boards`. It never saves
character assignments, guesses, biographies or other cast state. Localhost remains
a device-only preview; add `?shared=1` to test the real connection deliberately.

## Install on the existing Supabase project

1. Run `shared-scheduling-migration.sql` in the project's SQL editor. It adds the
   schedule table, request deduplication and authenticated action RPC. Existing
   schedules are preserved on reruns. The first installation seeds the requested
   21 October 2026, 19:45 Europe/Copenhagen session for `danganronpa-main` only.
2. Run `shared-scheduling-cron.sql`. The named job runs every minute and selects
   qualifying sessions without requiring an open browser. Reruns update that job.
3. Verify `cast_schedules` is included in the project's exposed public schema and
   Realtime publication. The migration adds the publication entry when available.
4. Publish the frontend. The host signs in using the existing host password;
   players use their existing actor login. No new accounts are needed.

The frontend reconnects automatically after installation and periodically fetches
the latest revision to recover missed Realtime events. Failed saves roll back and
show an error. No local planner snapshot is automatically uploaded to production.

## Access and concurrency

Explicit grants are included, including for projects with the new Data API grant
defaults. Public viewers can read schedules for initialized public boards. Clients
cannot insert/update/delete the table directly. The action RPC checks the existing
host/actor sessions: players can edit only their own availability; hosts can assign
availability and manage sessions. All mutations lock one schedule row. Fifteen-minute
adjustments are increments, so quick taps and simultaneous votes do not overwrite
one another. Unique request IDs make interrupted-response retries safe. Host edits
also check the session's original start time to reject stale changes.

## Timing and selection

Calendar input uses Copenhagen time, including DST. Nonexistent spring times are
rejected; ambiguous autumn times use the first occurrence. Other players see the
scheduled timestamp in their device timezone. Tuesday remains unavailable.

Session statistics stop at the earlier of a host end or ten hours after the start.
Pause session / Resume session records breaks separately from elapsed time. The
play-time figure excludes those breaks. It does not extend the ten-hour window.

The server selects the most-attended future option with at least three players,
including Nicher. Ties use the earlier date. It checks every minute, selecting once
the adjusted start is at most 48 hours away (up to one minute after the cutoff).
Offsets use a weighted mean with one extra baseline vote, rounded upward to a
15-minute step. Existing sessions in that week take precedence. Removing a session
disables automatic re-selection for that week; the host can still choose a date.
Attendance offsets are rebased when the start time changes, preserving players'
stated arrival times.

Weekly attendance records are shared, but **email delivery is deferred** at the
host's request. “Email not connected” is intentional. No outgoing mail is sent.

## Validation

Run the ordinary `tests/*.test.js` files with Node. The integration test uses real
PostgreSQL through `@electric-sql/pglite` 0.5.11 in an isolated in-memory database:

```powershell
npm install --prefix ../planner-test-tools --no-audit --no-fund @electric-sql/pglite@0.5.11
$env:NODE_PATH=(Resolve-Path ../planner-test-tools/node_modules).Path
node tests/shared-scheduling.integration.js
```

It exercises grants/RLS, cross-actor attacks, host-only actions, request replay,
independent votes, timezone boundaries, the 48-hour cutoff, pauses, session ending,
and preservation of cast state. Client tests cover quick taps, Realtime arriving
before the HTTP response, retry after a lost response, rollback and offline status.

Reference: [Supabase Cron](https://supabase.com/docs/guides/cron/install).
