# Contributing

Thanks for helping! Issues and pull requests are welcome.

## Setup

```bash
npm install
npm run dev        # watch build into dist/
```

Import `dist/manifest.json` in the Figma desktop app (`Cmd/Ctrl + K` → *Import
widget from manifest…*). After a rebuild, remove the widget from the canvas and
add it again.

## Before you open a pull request

```bash
npm run typecheck
npm test
npm run build
```

CI runs the same three commands.

## Guidelines

- **Read-only.** Pulse never writes to Supernova. Changes that need write access
  belong in a separate tool.
- **Mind the sandbox.** Code in `src/main/` runs in Figma's widget sandbox: no
  `URL`, no DOM, no CORS-free requests. The main tsconfig excludes the DOM lib so
  `npm run typecheck` catches it.
- **Never let a failure overwrite shared state.** Synced state is visible to
  everyone with access to the file; see
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#rule-a-failed-sync-never-overwrites-shared-data).
- **Tolerate API drift.** Supernova responses have changed shape before. Read
  fields defensively and add a test for every shape you support.
- **Test against the mock.** `test/supernova.test.mjs` mocks the REST API.
  Extend it with the response that caused your bug.
- **Bump `BUILD_VERSION`** in `src/main/main.tsx` for every release; it's shown in
  the widget footer.
