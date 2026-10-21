# Session planner — 21 October 2026

The shared scheduling implementation is documented in `SHARED_SCHEDULING.md`.
The following notes describe the earlier device-only preview and visual release.
The new shared migration supersedes that connection limitation when installed;
email remains deferred. The stopping-point shortcut has been removed, and the
host break controls are now labelled Pause session / Resume session.

Today's session is seeded for 21 October 2026, 19:45 Europe/Copenhagen
(17:45 UTC). Calendar entry always uses Copenhagen civil time; display uses
the viewer's locale and timezone. Summer/winter transitions are tested.

The planner supports host calendar scheduling, multiple future dates, weekly
availability and 15-minute offsets, manual actor assignment, touch dragging,
Tuesday exclusion, plan-ahead, session ending, breaks and duration statistics.
The first five minutes show DANGANRONPA NOW. A session expires ten hours after
its start unless the host ends it sooner. Historical durations exclude breaks.

This is intentionally a local feature preview. Schedule data is stored under
`danganronpa-session-planner-v1` in localStorage and updates across tabs on the
same origin. It is not yet shared across players' devices. The preview has no
outgoing email service. Qualifying attendance records appear in the host
notification list; delivery to nl@hldata.dk remains pending. Automatic 48-hour
selection is evaluated every 15 seconds while a local host page is open;
reliable unattended scheduling requires a server job in the later database work.

The local board imports the public board snapshot at revision 650 once and
backs up the previous local board under `preview-before-snapshot`. Existing
role IDs, ownership, predictions and deaths are preserved. The ignored snapshot
must not be published. The Chapter 5 checkpoint records the garden, disassembled
Monokuma, bomb and walk to the headmaster's room, without events after arrival.
The obsolete seeded Chapter 3 recap is removed from this preview only.

The Danganronpa Dark theme replaces generic copy with casting-file labels,
the full Mukuro quote and Exactly five chickens. Continuous chain strips span
the locked-game banner. Narrator is marked as an extra role and excluded from
client-side capacity checks. DR2/2×2 preview access is localhost-only and does
not mark any game completed.

The frontend release is prepared for GitHub Pages. The hosted page displays today's
session time; interactive planning remains local-only. No database migrations
were performed. Before enabling shared planning,
implement authenticated shared planning, actor-owned votes, host-only session
controls, email delivery, server-side Narrator capacity exemption, and explicit
grants on any newly created Supabase tables. Existing draft migration files
from the previous work have not been applied.

Validation: all ten Node test suites, desktop calendar and route selection,
390px mobile calendar, visible session date/time, Memorial count of ten,
and preserved MD victim/blackened guesses.

Visual reference: the official Steam DR1 title-screen screenshot at
https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/413410/ss_3111fac0ca3749fd394ac7b4a6b1fd2fbeb1f0a3.1920x1080.jpg
informed the italic title and cyan accents; the current requested palette is
dark charcoal with pink highlights. Trigger Happy Havoc, Chapter 5, remains
the current game. No new third-party
background asset has been bundled.
