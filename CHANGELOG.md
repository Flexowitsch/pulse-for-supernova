# Changelog

## Unreleased

- **Download install:** every release ships a ready-to-import zip
  (`manifest.json`, `main.js`, `ui.html`), built by a release workflow on each
  `v*` tag. No Node.js needed to install.

## 1.1.0 — 2026-10-20

- **Show/Hide button** on the token field. The token stays masked by default.
- README: background on where Pulse comes from.

## 1.0.0 — 2026-10-16

First public release: an open rewrite of an internal widget, with nothing tied to
one design system.

- **Setup for any Supernova account:** token → design system (across all
  workspaces, or by ID) → property mapping with suggestions → component.
- **Status pill** in the team's own wording, coloured by meaning; **DESIGN**,
  **CODE** and **DOCS** tiles driven by mapped component properties.
- **Documentation button** that always opens the published page: built from the
  page's short ID, first tab of a linked tab group, current docs domain from the
  design system's docs slug or the URL confirmed in setup, resolved on every
  click.
- **Working version from `sharedDraftId`**, so the versions list (HTTP 502 on
  large design systems) is never needed on the normal path; 502 to 504 are
  retried once.
- **Failure-safe shared state** and a once-per-session daily refresh.
- `npm test` (mocked API), `npm run diagnose` (real account, outside Figma), CI.
