# Danganronpa Dark — 21 October 2026

Frontend release 2026.10.21.1 keeps the existing Supabase board and reads its
latest state at startup and through realtime updates. No snapshot is uploaded,
no board is reset, and no database migration runs with this release.

The first game remains at its existing Chapter 5 progress. The release adds the
dark theme, exact five-chickens text, full Mukuro quote, continuous chain strips,
current Memorial portraits, Narrator capacity display/exemption and the safe
headmaster's-room checkpoint recap. The default presentation becomes dark;
explicit device theme choices remain respected.

The current public board was checked at revision 650 (21 October, 19:41 CEST).
Role IDs, ownership, locks and predictions are preserved. The preview snapshot
is ignored by Git; the hosted application continues reading newer player choices.

The hosted countdown starts at 19:45 Copenhagen time on 21 October. Interactive
calendar voting, breaks and statistics remain available in localhost preview.
Shared planning, mail delivery and unattended scheduling remain deferred.
See SESSION_PLANNER_NOTES.md for exact preview limitations.

DR2/2×2 preparation is available for future use. Previewing a route does not
mark a campaign complete. The active campaign is Trigger Happy Havoc.

Database migration drafts are excluded from this frontend release. Manual guess locks are currently client-side controls;
server enforcement of those new flags and new-route writes requires that later
update. Existing first-game predictions still use the existing server rules.
