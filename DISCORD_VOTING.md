# Discord attendance buttons

## Current deployment (25 October 2026)

The signature-verified `discord-voting` Edge Function and private database migrations are deployed. Discord accepted the interactions endpoint. Eight initial actor mappings are saved privately (Tiger is named Tigereye on the board). The token is saved in Vault and its bot identity is verified. The bot card is **not activated**: server installation and final card verification are paused until the owner returns to their PC. Installation permissions were prepared but not saved or authorized. Resume only at the owner's request. The existing pinned webhook card remains active.

## User flow

- While planning, the shared message offers dated day buttons for the same planning week as the website. Tuesdays remain unavailable, matching the website.
- A day opens a private panel. Can attend, Cannot play that day, −15 min, +15 min and On time affect only the selected date and the clicking user's linked voice actor.
- Day buttons in that private panel switch its selected date without changing any vote. Attendance and arrival remain separate for each date. Arrival buttons also mark the actor available; Cannot play that day cancels availability for that date.
- Private button presses edit the same private message. Confirmed-session cards offer the attendance controls directly for that session.
- The selected date and local timestamp are shown in the confirmation. Button date labels follow the Danish calendar; Discord timestamps follow each reader's timezone.
- Old panels expire after 30 minutes; rescheduled or finished dates reject outdated controls. Reopen the current card to continue.
- The shared card refreshes after a vote and once per minute. Website and Discord use the same schedule state.

## Host management

Open a saved actor's profile in host mode and use the separate Save Discord ID button. IDs are text, not JavaScript numbers. Leave the field blank to unlink. A new actor must be saved before linking Discord. Duplicate IDs and concurrent edits are rejected. The private mapping is never part of the public board export.

## Setup and activation

1. Run `discord-actor-links-migration.sql` and `discord-voting-migration.sql` after the existing shared schedule and webhook migrations. They create inactive bot support and do not replace the current card.
2. Deploy `supabase/functions/discord-voting`. `node scripts/bundle-discord-function.cjs` produces a single-file dashboard upload outside the repository. Disable Supabase JWT verification **only for this function**; it verifies raw-body Discord Ed25519 signatures, request freshness, and application ID before handling input. Public app ID/key defaults are in `index.ts`; optional environment overrides are `DISCORD_APPLICATION_ID` and `DISCORD_PUBLIC_KEY`.
3. Set Discord's Interactions Endpoint URL to `https://srdyjehnvsmscmeuhcvh.supabase.co/functions/v1/discord-voting` (already accepted for app `1563530017814614138`).
4. The owner generates the bot token and saves it directly in Supabase Vault as `danganronpa_bot_token`. Never put it in source, browser code, chat, command arguments or SQL snippets.
5. Install the app in the intended server with View Channels, Send Messages and Embed Links. No administrator or privileged gateway intents are needed. Channel overrides must allow the schedule channel. Pinning can be done by the host.
6. Insert the private `cast_discord.apps` row using the Vault secret UUID, application ID, guild ID and channel ID, initially disabled. Verify the token belongs to the intended app using a server-side request that returns only the bot identity.
7. Enable and call `cast_discord.sync_bot`. If initial creation is uncertain, the integration disables itself to prevent duplicate posts; inspect Discord before retrying.
8. Verify the new card and a real user click. Then disable the old webhook connection, pin the bot card, and remove the old card only with the owner's explicit deletion approval. Keep the bot's stored message ID for all later schedules.
9. Change the in-app release note from setup pending to live after activation is verified, and update all build markers together.

## Security and verification

Only the Edge Function's service role can call attendance and refresh RPCs. All private tables have RLS and revoked client access. The database rechecks application, server, channel, current message, linked actor, panel ownership and current date/time choice. Duplicate interaction IDs replay the saved response without applying a second increment. Credentials and interaction tokens are excluded from the stored request.

Tests: `tests/discord-voting.integration.js` runs real PostgreSQL functions using PGlite, including identity isolation, switching days, cancellation, offset baselines, retries, expired controls and migration reruns. `tests/discord-voting-handler.test.mjs` exercises real Ed25519 signatures, immediate acknowledgement, private-message updates and credential isolation.
