# Danganronpa Voice Cast

A shared board for our Danganronpa voice-cast playthrough. It tracks who plays which
character, chapter progress, predictions, session scheduling and more. It is a static
site (plain HTML, CSS and JavaScript, no build step) hosted on GitHub Pages, with
[Supabase](https://supabase.com) as the shared database.

This repository is public. Keep everything in it spoiler-safe (see "Rules" below).

## How it fits together

- **Site:** GitHub Pages serves the files in the repository root. Pushing to `main`
  publishes the site.
- **Database:** Supabase stores the shared board, schedule and activity. The site talks
  to it through `supabase-sync.js`. Connection details are in `supabase-config.js`
  (the publishable key there is meant to be public).
- **Discord:** a webhook posts and updates the schedule card, reposts it 10 hours before a
  session, and pings yes-voters 30 minutes before. It runs inside Supabase, so no PC needs to be on. See the Discord docs below.
- **Host tools:** the host opens the host page and logs in with the host password. Host
  only controls (the Admin Tools tab and the edit buttons) appear after that.

## Where things are

| File | What it does |
| --- | --- |
| `index.html` | The whole app: markup, inline script, themes and patch notes. Most changes happen here. |
| `finale.css`, `island-skin.css`, `slayhem-and-layout.css` | Themes and layout. Rules are scoped by `html[data-ui-theme]` and `body[data-world]`. |
| `session-planner*.js`, `session-planner.css` | The shared schedule tab. |
| `supabase-sync.js` | Every call to the database (board, links, Discord switches, activity). |
| `monopad-data.js`, `dr2-monopad-art.js`, `assets/monopad/` | Character profiles and art for Monopad. |
| `voice-clips-v4.js` | The voice clip library. |
| `endgame-data.js`, `unconfirmed-student.js` | Story-gated data that only appears at the right chapter. |
| `*.sql` | Database migrations. Run them in the Supabase SQL Editor, in the order in each doc. |
| `tests/` | Automated tests. |
| `11037/` | Redirect to the host page. |
| `app.js`, `standalone*.html`, `design-preview.html` | Older standalone and prototype versions. The main site does not use them. |

Further docs: `SHARED_SCHEDULING.md` (schedule), `DISCORD_SCHEDULING.md` (Discord card
and reminder), `DISCORD_VOTING.md` (paused voting bot), `BACKLOG.md` (deferred work),
`AGENTS.md` (release rules).

## Running it locally

Serve the folder with any static server and open it in a browser, for example:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080/`. On `localhost` the site can read a saved board
snapshot (`live-public-board.json`, not committed) so you can test without the database.

## Tests

Most tests run with plain Node:

```powershell
node tests\series-progression.test.js
```

Tests ending in `.integration.js` run a real PostgreSQL in memory (PGlite) with the
network mocked, so nothing is sent to Discord or Supabase. Install PGlite somewhere,
then point `NODE_PATH` at its `node_modules` before running:

```powershell
$env:NODE_PATH = 'C:\path\to\node_modules'
node tests\discord-reminder.integration.js
```

`voice-pool-safety.test.js` is known to fail on a stale version list.

## Common changes

- **Front-page quotes:** host Admin Tools, "Edit front-page quotes" (saved per game and
  chapter). The defaults are in `defaultFrontQuotes()` in `index.html`.
- **Default theme for visitors:** host Admin Tools, "Default theme". Personal choices
  always win. Theme styling lives in `finale.css`.
- **Discord card and reminder on or off:** host Admin Tools, "Schedule card and reminder".
- **A character's Discord link (for pings):** open the voice actor profile as host.
- **Colours and layout:** the CSS files above. Wide screens, tablets and phones (portrait
  and landscape) all need checking after a layout change.

## Rules

- **No spoilers in public files.** Patch notes, docs, commit messages and comments must
  describe story changes in neutral terms. Story-gated text must stay behind its chapter
  check.
- **Never commit secrets.** Webhook URLs and tokens belong in Supabase Vault, not in git.
- **Patch notes:** every user-visible change gets a spoiler-safe note in the in-app
  Patch notes, newest first.
- **Build markers change together:** `build.json`, `APP_BUILD` in `index.html`, the
  redirect in `11037/index.html`, and the `?v=` numbers on the CSS and JS files.
- **One branch per feature** (`feature/<name>`), merged with its patch note. Ask before
  pushing, because pushing `main` publishes the site.

## Credits

Character names and artwork belong to Spike Chunsoft. Voice clip and some artwork
links point to the Danganronpa Wiki.
