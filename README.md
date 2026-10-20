<p align="center">
  <img src="assets/icon.svg" width="96" height="96" alt="Pulse for Supernova icon" />
</p>

<h1 align="center">Pulse for Supernova</h1>

<p align="center">
  A Figma widget that shows the live health of a design system component from
  <a href="https://supernova.io">Supernova</a> right next to it on the canvas.
</p>

<p align="center">
  <a href="https://github.com/Flexowitsch/pulse-for-supernova/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Flexowitsch/pulse-for-supernova/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
</p>

```
┌────────────────────────────────────────────────┐
│  Button                             [Healthy]  │  component + status pill
│                                                │
│   ┌────────┐  ┌────────┐  ┌────────┐           │
│   │   ✓    │  │   ✓    │  │   –    │           │  three readiness tiles
│   │ DESIGN │  │  CODE  │  │  DOCS  │           │
│   └────────┘  └────────┘  └────────┘           │
│                                                │
│   ⓘ  New here? Open the documentation …        │
│   ┌──────────────────────────────────────┐     │
│   │  Open documentation in Supernova  ↗  │     │  deep link to the published page
│   └──────────────────────────────────────┘     │
│  Synced 3m ago · Acme DS             Sync ↻    │
└────────────────────────────────────────────────┘
```

Designers shouldn't have to leave Figma to find out whether a component is
production-ready, has code, and is documented. Pulse reads those answers from
Supernova and puts them on the canvas, next to the component they describe.

- **Works with any Supernova design system.** Paste your API token, pick a
  design system, map three properties. Nothing is hard-coded.
- **Read-only.** The widget never writes to Supernova.
- **No backend.** Every request goes straight from Figma to `api.supernova.io`
  with your own token.
- **Built for teams.** The status lives in the Figma file, so everyone sees it,
  including colleagues who never connect a token.

## Contents

- [How it works](#how-it-works)
- [Install](#install)
- [Set up a widget](#set-up-a-widget)
- [Prepare your design system in Supernova](#prepare-your-design-system-in-supernova)
- [Sync behaviour](#sync-behaviour)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Further documentation](#further-documentation)

## How it works

Each tile is driven by one **component property** in Supernova. You choose which
property during setup, and Pulse pre-selects the obvious matches.

| Tile | Typical property | Turns green when |
| --- | --- | --- |
| **DESIGN** | `Status` (select) | the value reads as healthy: *Healthy, Ready, Stable, Production, Released, Done, Approved* |
| **CODE** | `Repository` (URL or text) | any value is set |
| **DOCS** | `Documentation link` (link to a page) | a documentation page is linked |

The tiles are independent. A component can be **Healthy** with no code yet: the
DESIGN tile turns green and the CODE tile stays grey.

### The status pill

The pill always shows your own label. Pulse only picks the colour, checking in
this order:

| Colour | Label contains |
| --- | --- |
| Red | *deprecated, danger, sunset, removed, broken, blocked* |
| Yellow | *known issues, warning, beta, experimental, in progress, review, draft, WIP* |
| Grey | a negation such as *not ready* or *unready* |
| Green | *healthy, ready, stable, production, released, done, approved* |
| Grey | anything else, or no status ("No status") |

Select properties store option IDs (`status-healthy`); Pulse resolves them to the
option's name before it matches.

### The documentation link

**Open documentation in Supernova** always opens the component's page on your
**published** docs site, never the editor:

1. Pulse reads the component's documentation link and finds that item in the
   documentation structure. A linked tab group opens its first tab.
2. It builds the URL from the page's **short ID**
   (`…/latest/components/alert/guideline-AbCd1234`). Supernova's docs site
   resolves pages by that ID alone, and the ID never changes between versions.
3. The docs domain comes from the design system's own docs slug, or from the
   URL you confirmed in setup. See
   [Architecture → documentation links](docs/ARCHITECTURE.md#documentation-links)
   for why the API's own docs URL isn't trusted on its own.

The link is resolved again on every click, so it can't go stale. If the design
system has no published docs site, the button is hidden.

## Install

Pulse isn't on the Figma Community yet. You need the **Figma desktop app**; the
web app can't import widgets from a manifest.

### Download (no build needed)

1. Download `pulse-for-supernova-vX.Y.Z.zip` from the
   [latest release](https://github.com/Flexowitsch/pulse-for-supernova/releases/latest)
   and unzip it.
2. In Figma: `Cmd/Ctrl + K` → **Import widget from manifest…** → pick
   `pulse-for-supernova/manifest.json`.
3. Place it from **Widgets → Development → Pulse for Supernova**.

To update, download the new release, import its `manifest.json`, then remove
the widget from the canvas and add it again so Figma loads the new build.

### Build from source

You need **Node.js 18+**.

```bash
git clone https://github.com/Flexowitsch/pulse-for-supernova.git
cd pulse-for-supernova
npm install
npm run build
```

Then import **`dist/manifest.json`** as above. The source manifest lives in
`package.json` under `plugma.manifest`; the build generates the Figma-ready
copy.

## Set up a widget

1. Drop **Pulse for Supernova** on the canvas and click **Connect to Supernova**.
2. **Token:** paste a Supernova personal access token (create one in your
   Supernova profile settings). Read access is enough.
3. **Design system:** pick one from every workspace your token can read. If
   yours isn't listed, enter its ID from the Studio URL
   (`app.supernova.io/<workspace>/<ID>-<name>/…`).
4. **Map the tiles:** confirm which property drives DESIGN, CODE and DOCS, and
   check the **Published docs site** that Pulse detected.
5. **Component:** pick one and save.

Pulse remembers your token and your last design system, so every widget after
the first only asks for the component.

**Widget menu** (select the widget): Sync · Hard refresh · Change component ·
Change design system · Update token.

## Prepare your design system in Supernova

Pulse shows what Supernova knows; it doesn't invent anything. To get a fully
green card:

1. **Component properties:** in Supernova, open **Components** and make sure
   your components have a *Status* (select), a *Repository* (URL) and a
   *Documentation link* (link to a documentation page) property. Any names
   work; you map them in setup.
2. **Fill them in** per component: set the status, paste the repository or
   Storybook URL, and pick the documentation page.
3. **Publish the documentation.** The button links to the published site, so a
   page that has never been published has nothing to open yet.

## Sync behaviour

- **Manual:** *Sync* in the footer or the widget menu.
- **Daily:** data synced before the most recent 18:00 (local time) refreshes
  silently the next time the file opens, once per widget per session. A file
  with a hundred widgets therefore doesn't flood Supernova with requests.
- **Failure-safe:** once a widget has data, a failed sync never overwrites it.
  An expired token or a network error shows up only as a notification for
  whoever clicked Sync; everyone else keeps seeing the last good status.
- **Always the working version:** every sync reads from the design system's
  shared draft, so a new draft never leaves widgets behind.

## Privacy and security

- Your token is stored with `figma.clientStorage`: local to your machine and
  Figma account. It is **never written into the Figma file**, so collaborators
  each connect their own token.
- The widget only talks to `api.supernova.io` (declared in the manifest's
  `networkAccess`) and only sends `GET` requests.
- What *is* stored in the file, visible to everyone with access: the design
  system ID and name, the property mapping, the docs site URL, and the last
  synced card (component name, status, tile states, docs link).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `SyntaxError: expecting '('` or *widget missing call to figma.widget.register* | You imported a source manifest. Remove the widget under *Manage plugins and widgets in development* and import `dist/manifest.json`. |
| "Token expired" | Widget menu → **Update token**, paste a fresh token. |
| A design system is missing from the list | Enter its ID in the setup's *Not listed?* field. |
| *Open documentation* lands on a login screen | The docs domain is wrong. Widget menu → **Change design system**, correct **Published docs site**. |
| A tile stays grey although the value is set | The tile is mapped to a different property. Widget menu → **Change design system** and check the mapping. |
| `HTTP 502` from `…/versions` in the console | Supernova's gateway timing out on large design systems. Pulse doesn't depend on that call; a retry runs once. |

For anything else, right-click the widget → **Open Devtools** and filter the
console by `[Pulse]`: every lookup step is logged. Or run the
[diagnose script](#diagnose-without-figma) against your account.
More in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

## Development

```bash
npm run dev        # watch build into dist/; reload the widget in Figma to pick it up
npm test           # Supernova client against a mocked API (node:test)
npm run typecheck  # strict TypeScript for the widget and the setup UI
npm run build      # production build into dist/
```

### Diagnose without Figma

`npm run diagnose` runs the widget's own Supernova code against your account and
prints every step of a sync: design systems, property mapping, the card, and a
live check of the documentation link.

```bash
# copy your Supernova token to the clipboard first (macOS), or set SUPERNOVA_TOKEN
npm run diagnose -- "Button" "My Design System"
```

The token is read from the clipboard or the environment and never printed.

### Project layout

```
src/
├── main/
│   ├── main.tsx        widget: canvas UI, synced state, menu, sync orchestration
│   └── supernova.ts    Supernova REST client: discovery, mapping, status, docs links
└── ui/
    └── App.tsx         setup iframe (React): token → design system → mapping → component
scripts/diagnose.ts     run a sync outside Figma
test/                   node:test suite against a mocked Supernova API
```

## Further documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): state model, message protocol,
  endpoints, and the reasoning behind version and link resolution
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md): symptoms, causes, fixes
- [CONTRIBUTING.md](CONTRIBUTING.md): how to work on Pulse
- [CHANGELOG.md](CHANGELOG.md)

## Background

Pulse was created as part of my work at [EGYM](https://www.egym.com), where it
started as an internal widget for a design system team that documents its
components in Supernova. There it sits on over a hundred component pages.

This repository is an open rewrite with nothing tied to that design system: it
works with any Supernova account. It may move to an EGYM organisation on GitHub
later.

## License

[MIT](LICENSE) © Felix Pfahlert. Feedback and pull requests welcome. Find me on
[LinkedIn](https://www.linkedin.com/in/felix-pfahlert-1a7843b4/).

*Not affiliated with Supernova. "Supernova" is a trademark of its owner.*
