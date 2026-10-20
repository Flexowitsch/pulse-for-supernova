# Changelog

## 1.3.0 — 2026-10-20

- **Code button:** when the CODE property holds a link (Storybook, GitHub,
  GitLab or any URL), the card shows a button to it, named after where it
  leads. With a documentation page it's a secondary (outline) button below
  *Open documentation in Supernova*; without one it becomes the primary button
  and the documentation button is hidden.
- Setup: the **Published docs site** field is marked *Optional*.

## 1.2.0 — 2026-10-20

- **Edit tile mapping** in the widget menu: change which property drives the
  DESIGN, CODE and DOCS tiles (and the docs site) without redoing setup or
  picking the component again.
- **Update token** removed from the menu. Without a valid token, **Sync** opens
  the token dialog instead.
- **Install without building:** the ready-to-import build is committed in
  `dist/`, so `git clone` installs and `git pull` updates. CI fails if `dist/`
  is out of date. Every release also ships the same three files as a zip.

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
