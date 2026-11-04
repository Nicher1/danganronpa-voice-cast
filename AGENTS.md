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
- The Discord reminder (`discord-reminder-migration.sql`) is installed. It is off by default and
  is switched on from Admin Tools on the host page. Only linked yes-voters are pinged.
- Run the PGlite tests with `NODE_PATH` pointing at a folder that has `@electric-sql/pglite`.

Known issues and parked work
- `tests\voice-pool-safety.test.js` fails on a stale version list, unrelated to recent work.
- Parked: Class Trial theme (`feature/class-trial-theme`, owner prefers the current theme),
  actor badges, Usami pet, DR2 gift guide (needs a spoiler review), anime tracker.
- The gift guide covers the first game only. Data comes from the Danganronpa Wiki (CC BY-SA).