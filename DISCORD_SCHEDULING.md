# Discord schedule card

The shared schedule drives a single Discord webhook message. The database cron
checks once per minute, and edits that message only when its content changes.
Discord renders the absolute date/time in each reader's timezone and maintains
the relative timestamp. Attendance is eventual (normally within a minute), not
refetched when someone reads a message.

The card shows the active or next scheduled session. When no session is scheduled,
it shows the next planning week, excluding Tuesdays. Names come from the existing
public voice actor list; votes come from `cast_schedules`. Arrival offsets are
calculated against the actual session start, including any rescheduling. No new
Discord login or voting database is introduced.

Each voting link opens player mode at `#schedule`, optionally with a
`scheduleDate=YYYY-MM-DD` query parameter. This opens the second tab, Schedule,
and focuses the linked date. A previous collapsed
preference cannot hide the poll. The usual actor/password login is offered above
the days. The host can copy this link from the schedule header. Existing Discord
links work without changing or sending any Discord messages.

## Installation

1. Run `discord-schedule-migration.sql` as the database owner after the shared
   scheduling migration. It installs `http`, creates the private `cast_discord`
   schema, and schedules `cast-discord-schedule`. No message is sent until a
   connection is configured and enabled.
2. Save the Discord webhook URL in Supabase Vault under a unique name, for example
   `danganronpa_schedule_webhook`. Never put this URL in the website, Git, or a
   public configuration table.
3. Configure the connection using its Vault ID:

   ```sql
   insert into cast_discord.connections(slug,secret_id,enabled)
   select 'danganronpa-main',id,true
   from vault.secrets where name='danganronpa_schedule_webhook'
   on conflict(slug) do update set secret_id=excluded.secret_id,enabled=true;
   select cast_discord.sync('danganronpa-main');
   ```

The first successful call creates one message and stores its ID privately.
Subsequent calls PATCH it. The connection needs no service-role key and never
exposes the webhook to the browser. An advisory lock prevents overlapping syncs.
HTTP failures are recorded without the secret-bearing URL; rate limits back off.
An uncertain initial POST pauses the connection to avoid duplicate posts. Inspect
the channel and set the existing message ID before resuming. Deleting the message
or webhook pauses updates on Discord's 404 response; it does not spam replacements.

## Operations

```sql
-- Status (contains no webhook secret):
select slug,message_id,enabled,last_success_at,last_status,retry_after
from cast_discord.connections;
-- Pause:
update cast_discord.connections set enabled=false where slug='danganronpa-main';
```

This is a webhook-posted card. Pasting the voting URL as an ordinary message does
not make that URL's preview a live attendance card. Share or pin the webhook's
message in Discord for the automatically updated version.

## Validation

Run `tests/discord-schedule.integration.js` with the existing PGlite installation
on `NODE_PATH`. It uses real PostgreSQL with a mocked HTTP transport; it sends no
Discord messages. Coverage includes timezone conversion, rebased arrivals,
deleted actors, Markdown/mention handling, private-schema permissions,
deduplication, PATCH updates, rate limits, and uncertain first-post failures.

## Card repost and 30-minute reminder

Run discord-reminder-migration.sql after the schedule and actor-links migrations. It runs inside Supabase every minute, so your PC can be off.

- 10 hours before a session (or right away if the session is created later than that), a fresh schedule card is posted without pings and the old card is deleted, so the new card sits at the bottom. Webhooks cannot pin.
- 30 minutes before, a separate short message pings linked players who voted yes. Unlinked yes-voters are named without a ping. The card is not touched.
- Each step happens once per session. If Discord's answer is unknown it is not retried, to avoid a double post or ping.
- A rescheduled session can be handled again.
- Only listed users can be pinged, never @everyone or roles.


## Prepared update: one card and manual repost (6 November 2026)

Local preview, not deployed. After owner approval, run
`discord-card-repost-migration.sql` after `discord-reminder-migration.sql`, then
publish the frontend. The new UI detects the migration and keeps its controls
unavailable until it is installed.

- Admin Tools replaces the card switch with **Move card to bottom now**. Each
  completed click deletes the old card and posts a fresh one.
- Card posting within 10 hours is independent of the reminder switch. The minute
  job catches up when service resumes while the session is still in the future.
- With the 30-minute reminder enabled, the same job deletes the card, posts its
  replacement, then sends the separate ping immediately underneath. Only linked
  yes-voters are pinged; unlinked yes-voters are named without a mention.
- All card creation paths share a lock and delete known previous cards first.
  Failed deletions block creation. A rejected POST can retry. A timeout, missing
  message ID or server error pauses delivery, since Discord may have accepted it.
- Attendance continues to update the current card in place. A manual post within
  the 10-hour window fulfils the automatic post; a changed start time qualifies
  again. Finished and already-started sessions do not trigger reminders.

After an uncertain card POST, inspect Discord and reconcile `message_id` with the
existing card (or null only after confirming there is no card). Then clear
`card_uncertain`, `retry_after` and `last_payload` and enable the connection.
The reminder switch deliberately cannot clear this safety stop. Do not re-run an
older migration after this one, because it would restore the previous functions.

Validation: `tests/discord-card-repost.integration.js` uses real PostgreSQL and a
mock Discord transport that rejects duplicate live cards. No real messages are
sent. `tests/discord-card-repost.browser.cjs` checks the host panel and its actions
with a mock connection on wide, normal, portrait and landscape screens.
