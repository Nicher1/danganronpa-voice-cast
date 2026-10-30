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
