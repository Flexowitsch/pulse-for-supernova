# Troubleshooting

Start here: right-click the widget → **Open Devtools** → filter the console by
`[Pulse]`. Every sync logs the design system record, the docs site it chose and
why, the page it found, and the URL it opens.

To reproduce a problem outside Figma, run the same code against your account:

```bash
# copy your Supernova token to the clipboard first (macOS), or set SUPERNOVA_TOKEN
npm run diagnose -- "<component name>" "<design system name>"
```

## Loading the widget

**`SyntaxError: expecting '('` and *widget missing call to figma.widget.register***
Figma loaded TypeScript sources instead of the build. Remove the widget under
`Cmd/Ctrl + K` → *Manage plugins and widgets in development*, run
`npm run build`, and import `dist/manifest.json`. Then delete widget instances
that were placed from the old import.

**My changes don't show up**
Figma keeps the loaded code until the widget is reloaded. Rebuild, then remove
the widget from the canvas and add it again.

## Connecting

**"This token was rejected"**
The token is expired, revoked or mistyped. Create a new one in your Supernova
profile settings.

**My design system isn't listed**
The token can't list that workspace, or the account isn't a member. Enter the
design system ID in *Not listed?*; it's the number before the name in the
Studio URL: `app.supernova.io/<workspace>/<ID>-<name>/…`.

**`Couldn't load properties`** or **`HTTP 502`**
Supernova's gateway timed out. Pulse retries once; try again a minute later. If
it keeps failing, look for `[Pulse] design system record has no sharedDraftId`
in the console: then Pulse had to fall back to listing all versions, which is
the slow call.

## The card

**"Token expired" on a colleague's screen**
Nothing is broken: their own token is missing or expired. They keep seeing the
last synced status; clicking **Sync** asks them to connect their own token.

**A tile stays grey although the value is set in Supernova**
Check the mapping: widget menu → **Edit tile mapping**.
Then **Sync**.

**The status pill is grey for a status that means "fine"**
Pulse recognises *healthy, ready, stable, production, released, done* and
*approved*. Other labels are shown as-is in grey. Rename the option in
Supernova, or open an issue with the label you use.

## The documentation button

**It lands on a Supernova login screen**
The docs domain is wrong, usually the legacy subdomain the API reports
(`<workspace>-<random>.supernova-docs.io`). Widget menu → **Change design
system** → set **Published docs site** to the address your docs actually use,
e.g. `https://acme.supernova-docs.io`. The console line `[Pulse] docs: site`
shows which domain was chosen and from where.

**It lands on "page not found"**
The linked page has never been published. Publish it in Supernova; the link
works without a re-sync because it's resolved on every click.

**There is no button**
No documentation page is linked for the component, or the design system has no
published docs site.
