# Database migration options

Last reviewed: 2026-09-09

## Current situation

The site currently depends on four Supabase services, not only a database:

- PostgreSQL tables and security-definer RPC functions
- anonymous authentication plus host/actor session authorization
- Realtime channels for board updates and online presence
- Storage for uploaded voice samples and practice recordings

Supabase currently says low-activity Free projects may pause after seven days. A few database requests on several days in the week are usually enough to avoid a pause. A paused project must be resumed in the Supabase dashboard; a public-site button cannot safely hold the management credentials required to resume it. The current documentation gives a one-year restore window after pausing, superseding the older 90-day announcement.

The new master-only **Wake and verify now** button makes a real authenticated database request and confirms the response. Normal site use and the new presence heartbeats also create real database activity. The button is a useful check, but it is not a guarantee against Supabase's activity assessment and cannot resume an already-paused project.

## Best alternatives

| Option | Idle behavior | Compatibility with this site | Work to migrate | Recommendation |
| --- | --- | --- | --- | --- |
| Cloudflare Workers + D1 + R2 | Scales to zero; no weekly manual wake-up | Replaces PostgreSQL RPCs, Auth, Realtime, and Storage | Medium-to-high | Best long-term free managed option for this very small group |
| Neon Postgres + Worker API + R2 | Compute sleeps after inactivity and wakes on demand | Keeps PostgreSQL data, but still needs an API/auth/realtime/storage layer | Medium | Best if keeping PostgreSQL matters most |
| Self-hosted Supabase | No provider pause; uptime is controlled by us | Closest match to the existing code | Low app rewrite, high operations | Best fully open-source route if a maintained server is available |
| PocketBase on a small server | Controlled by the server host | Includes auth, realtime, files, and a database, but uses SQLite | Medium | Attractive open-source lightweight option, with the same server-maintenance requirement |
| A second Supabase Free project | Same seven-day low-activity policy | Nearly identical | Low | Temporary only; it repeats the original problem |

## Recommended migration target

For this site's scale, use **Cloudflare Workers + D1 + R2** if the priority is staying free with almost no maintenance:

- D1 stores the board, accounts, sessions, and seven-day activity history.
- A Worker replaces the current PostgreSQL RPC functions and keeps passwords/host authorization server-side.
- R2 stores uploaded voice clips and recordings.
- The first version can poll the board revision every few seconds. A Durable Object/WebSocket can be added later only if instant realtime updates remain important.
- The existing GitHub Pages front end can remain where it is and call the Worker over HTTPS.

The main cost is a one-time backend rewrite because D1 uses SQLite semantics rather than PostgreSQL/PLpgSQL. At this group's traffic, the documented free allowances are far above expected use.

Choose **Neon + a Worker API + R2** instead if preserving PostgreSQL is more important than minimizing moving parts. Neon can import a PostgreSQL dump and wakes its compute on demand, but the browser must not connect to it with database credentials; the Worker still has to replace Supabase's RPC/auth boundary. Realtime updates also need polling or another service.

## Low-risk preparation before migrating

1. Keep all remote calls behind `supabase-sync.js`; it is already a useful adapter boundary.
2. Make a regular logical database backup and separately export the `voice-clips` Storage bucket.
3. Keep the host's JSON board export as an additional recovery copy. It does not include recoverable plaintext passwords, so plan either a secure password-hash migration or a one-time password reset.
4. Before switching providers, run both backends briefly, copy data and audio, verify host/actor logins, then change the public configuration in one release.
5. Keep Supabase intact until the replacement passes board sync, simultaneous edits, presence, uploads, and restore testing.

## Primary references

- Supabase project pausing: https://supabase.com/docs/guides/platform/free-project-pausing
- Supabase self-hosting: https://supabase.com/docs/guides/self-hosting
- Supabase backup and restore: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Neon pricing: https://neon.com/pricing
- PocketBase: https://pocketbase.io/
