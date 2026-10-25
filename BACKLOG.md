# Current deferred work

Updated 25 October 2026. This list supersedes older deferred-work notes.

- Discord voting activation: paused at the host's request on 25 October until
  they are back at their PC (at least two days). Code is committed as `16a424f`;
  the endpoint and private mappings are deployed. The Vault token is saved and
  verified. Installation permissions were prepared but not saved/authorized.
  Resume server installation and card verification only when the host returns.
  Keep the existing pinned webhook card running. Enlarge Yasuhiro's avatar after
  the voting feature is finished.
- DR2-only Monopad virtual pet: future feature, inspired by a Tamagotchi.
  Add a dedicated sub-tab, with progress saved independently for each actor.
  Do not add it to the first game's board. Not part of the current visual update.

- Automatic Discord Scheduled Events: on hold. If requested later, create an
  event when a session is within 48 hours (immediately for shorter notice), keep
  its time and participant description synchronized, and retain its event ID.
  This needs a Discord app with event permissions; the message webhook alone
  cannot manage events.
- Supabase subscription: consider later if needed. Keep the existing Supabase
  setup; changing database providers is not an active task.
- Older backend migration drafts: verify live database support for manual
  guessing locks and later-game routes before deciding what remains to deploy.

Email notifications are removed from the backlog at the host's request. Do not
implement them unless requested again.

Shared scheduling, automatic session selection, direct voting links, and the
single automatically updated Discord schedule message are already implemented.
