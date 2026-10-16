# Architecture

Pulse is a Figma widget with a small React setup UI. It has no backend: the
widget talks to Supernova's REST API directly, with the viewer's own token.

```
┌──────────────── Figma ─────────────────┐
│                                        │
│  Widget (main thread)   src/main/      │        ┌────────────────────┐
│  ├─ main.tsx   canvas card, menu,      │ fetch  │ api.supernova.io   │
│  │             synced state, sync      │───────▶│ (GET only)         │
│  └─ supernova.ts  REST client          │        └────────────────────┘
│        ▲                               │
│        │ postMessage                   │
│        ▼                               │
│  Setup iframe           src/ui/        │
│  └─ App.tsx   token → design system →  │
│               mapping → component      │
└────────────────────────────────────────┘
```

## State

| Where | Scope | Holds |
| --- | --- | --- |
| `useSyncedState('source')` | the Figma file, shared | design system ID and name, property mapping, confirmed docs site URL |
| `useSyncedState('data')` | the Figma file, shared | last synced card: component, status, tile states, docs link, timestamp |
| `useSyncedState('mode')`, `('errMsg')` | the Figma file, shared | UI state shown only while there is no data |
| `figma.clientStorage` `pulse.supernovaToken` | one user on one machine | the Supernova API token |
| `figma.clientStorage` `pulse.lastSource` | one user on one machine | the last design system configured, so the next widget skips straight to the component |

### Rule: a failed sync never overwrites shared data

Synced state is shared with everyone who opens the file; the token is per user.
If a failure wrote into the document, one person's expired token or flaky
network would blank the card for the whole team. So once a widget has data:

- `loading`, `error` and `unauthorized` are never written to the document;
- failures are reported only to the person who triggered the sync
  (`figma.notify`);
- the card keeps rendering from `data`, and `mode` only decides what to show
  when there is no data at all.

### Rule: the daily refresh runs once per widget per session

Data synced before the most recent 18:00 local time is refreshed silently when
the file opens. A widget's `useEffect` runs on every render, and a file can hold
a hundred widgets, so the refresh is guarded by a module-scope `Set` of widget
IDs. It resets when Figma reloads the widget code and never enters the document.

## Setup UI protocol

The iframe only renders. All network calls run in the main thread; the two
sides talk through `postMessage`.

| UI → widget | Widget → UI | Purpose |
| --- | --- | --- |
| `request-token` | `token` | read the stored token |
| `validate-token` | `token-result` | `users/me`, returns the user's name |
| `list-design-systems` | `design-systems-result` | every design system in every workspace |
| `list-properties` | `properties-result` | component property definitions, a suggested mapping, the detected docs site |
| `list-components` | `components-result` | components of the chosen design system |
| `submit` | (closes) | stores token and source, then syncs the widget |
| `close` | (closes) | cancel |

Every `*-result` carries `{ ok: true, … }` or
`{ ok: false, reason: 'unauthorized' | 'notfound' | 'network', message }`.

## Supernova endpoints

All `GET`, under `https://api.supernova.io/api`, with `Authorization: Bearer <token>`
and a cache-busting `_=<timestamp>` parameter: Figma's `fetch` caches GET
responses by URL, so without it, changes made in Supernova wouldn't show.

| Purpose | Endpoint |
| --- | --- |
| Current user | `users/me` |
| Workspaces | `users/{userId}/workspaces` |
| Design systems of a workspace | `workspaces/{workspaceId}/design-systems` |
| Design system record (shared draft, docs slug) | `design-systems/{dsId}` |
| Versions (fallback only) | `design-systems/{dsId}/versions` |
| Property definitions | `design-systems/{dsId}/versions/{vId}/element-properties/definitions` |
| Property values | `…/element-properties/values` |
| Components | `…/design-system-components` |
| Docs site URL | `…/documentation/url` |
| Documentation structure | `…/documentation/structure` |

Responses are unwrapped from `{ result: … }`. Supernova answers **404** ("does
not exist or operation is forbidden") when a token lacks access, so 401, 403 and
404 are all treated as `unauthorized`. 502 to 504 are retried once after 800 ms.

## Version resolution

Every read targets the design system's **working version**: the shared draft
named on the design system record (`sharedDraftId`). One small request.

Listing all versions (`…/versions`) is only the fallback. On large design
systems that endpoint is slow enough to time out at Supernova's gateway
(HTTP 502), so nothing on the normal path depends on it.

## Property values

Supernova has returned property values in two shapes; Pulse reads both:

| Field | Older shape | Newer shape |
| --- | --- | --- |
| component | `targetElementId` | `targetElementPersistentId` |
| definition | `definitionId` | `definitionPersistentId` |
| value | `value` | `stringValue` / `referenceValue` / `numberValue` / `booleanValue` |

A mapped property stores both its `id` and its `persistentId`, and a value
matches on either. Select values are option IDs and are resolved to option names
before the status is classified.

## Documentation links

The DOCS tile is green when the component's documentation link is set. The
button opens the linked page on the **published** docs site:

1. **Find the page.** Look the linked ID up in the working version's
   documentation structure. A tab group is a container, not a page, so a linked
   group opens its first tab (recursively).
2. **Build the URL from the short ID.** The docs site resolves a page by its
   `shortPersistentId` alone; the slugs in front of it are cosmetic, and short
   IDs are stable across versions. So the URL can be built from the draft
   structure without looking up published versions:
   `https://<site>/latest/<group-slugs>/<page-slug>-<shortId>`. A root-level
   page uses the doubled form `…/<page-slug>-<shortId>-<shortId>`.
3. **Choose the site,** in this order:
   1. the docs site URL confirmed in setup (`source.docsUrl`);
   2. `https://<docUserSlug>.supernova-docs.io`, from the design system record;
   3. the design system's `docViewUrl`;
   4. the answer of `…/documentation/url`.

   The API's own docs URL comes last on purpose: it can still return the
   **legacy** subdomain built from the workspace handle
   (`acme-a1b2c3d4.supernova-docs.io`). Once a team has set its own docs slug,
   that legacy domain only leads to a login screen.
4. **Resolve on click.** Each widget stores the link from its last sync, but the
   button resolves it again when clicked, so an old link can never be opened.
   Offline or without a token, the stored link is used only if it points at a
   docs site.

A bare origin gets `/latest` appended. Without any docs site, the button is
hidden.

## Status classification

`normalizeStatus` in `src/main/supernova.ts` maps any label to one of four
variants (see the README table). Only a healthy-like label marks the component
design-ready. The pill always shows the team's own label, humanised
(`status-known-issues` → "Known issues").

## Sandbox constraints

The widget's main thread is not a browser: there is no `URL`, no DOM, and no
CORS-free network access. Code under `src/main/` must stay within the Figma
plugin typings; `src/main/tsconfig.json` deliberately excludes the DOM lib so
the typechecker catches violations.
