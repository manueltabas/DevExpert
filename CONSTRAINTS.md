# Constraints

- Serve and test the app over HTTP. Do not rely on opening `index.html` through
  a `file://` URL because browser storage and module behavior are origin-bound.
- Keep `./init.sh` as a non-blocking verification gate. It may print the local
  server command after checks pass, but it must not start a long-running server.
- Keep the MVP static and browser-local: no accounts, application backend,
  database service, analytics service, or remote synchronization unless a later
  approved feature changes the product direction.
- The local static server must serve only explicit public app files and assets.
  Repository documents, harness metadata, dotfiles, Git internals, and malformed
  URL paths must not be exposed through HTTP.
- Do not implement future game behavior inside placeholder shell controls.
  Roster creation, scoring, ranking, undo, persistence, finishing, podium, and
  replay each need their own feature evidence.
