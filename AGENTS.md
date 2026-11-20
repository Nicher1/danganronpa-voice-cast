# Release notes

For every major user-visible feature, behavior change, fix or removal, update the
in-app Patch notes in `index.html` as part of the same release. Backfill any recent
major release that is missing. Preserve the older release history, put newest
versions first, and use concise descriptions of what users can do or what changed.

Distinguish live features from local previews, pending backend work and deferred
features. Do not present implementation or deployment plans as already available.

Keep patch notes spoiler-safe: describe story-related changes in neutral terms
without identifying deaths, identities, case outcomes or future revelations. Use
the existing `data-reveal-game` visibility rules for notes about locked games.
Do not place explicit story spoilers in a collapsed release or its heading.

When publishing, update the build markers together and verify the deployed notes.


## Project context

Static HTML/CSS/JS site on GitHub Pages with Supabase as the shared database.
See `README.md` for the file map and how to run the tests.

Workflow
- One branch per feature (`feature/<name>`), each with a spoiler-safe patch note.
- Never push, merge or deploy without the owner's approval. Pushing `main` publishes the site.
- Check wide screens, normal screens and phones in portrait and landscape.
- Keep user-facing text free of long dashes. The owner wants to learn how to tweak things, so explain changes briefly.

Spoilers
- The owner's first-game progress is the END OF CHAPTER 5. Do not use, quote or hint at anything later in the site, docs or chat.
- Quotes must be real lines from `https://lparchive.org/Danganronpa-Trigger-Happy-Havoc/`, not invented wording.

Supabase
- Project ref `srdyjehnvsmscmeuhcvh`. Database work goes through the Management API
  (`POST https://api.supabase.com/v1/projects/<ref>/database/query`) using the scoped token in the
  user environment variable `SUPABASE_ACCESS_TOKEN`. Never print, commit or paste it.
- Player (non-host) saves are merged on the server by `cast_merge_player_save`. Only the
  player's own actor, their claims and releases, practice recordings and predictions are
  copied from what they send. A new field that players may edit must be added there too,
  or the server silently drops it.
- The Discord card update (`discord-card-repost-migration.sql`) is installed after
  `discord-reminder-migration.sql`. The card posts automatically within 10 hours;
  Admin Tools can move it manually and toggle the 30-minute ping independently.
  Only linked yes-voters are pinged. The card moves immediately before the ping.
- Login hardening (`login-hardening-migration.sql`) needs the matching `supabase-sync.js`
  published first, because wrong passwords now return false instead of raising. Logins lock
  for 15 minutes after 10 failed attempts. Unlock early with
  `delete from public.cast_login_failures where target = 'host';` (or `'actor:<id>'`).
- Island Pet (island-pet-migration.sql, tab only in the 2x2 routes) is one shared pet per board.
  Players change it only through cast_pet_action; the server owns cooldowns, daily coin caps,
  prices and chapter unlocks. pet-minigame.js mirrors those rules for the preview sandbox, and
  	ests/island-pet.integration.js checks the two agree. The host's secret switch only renames the pet to Usami and adds a glow; there is no Usami art.
- Run the PGlite tests with `NODE_PATH` pointing at a folder that has `@electric-sql/pglite`.

Known issues and parked work
- Parked: Class Trial theme (`feature/class-trial-theme`, owner prefers the current theme),
  actor badges, DR2 gift guide (needs a spoiler review), anime tracker.
- The gift guide covers the first game only. Data comes from the Danganronpa Wiki (CC BY-SA).