# Insightyyy

A local-first PWA that bridges physical handwritten notebooks with digital source
material. Capture a screenshot, URL, or text; the app assigns a sequential, **prefixed
reference ID** (e.g. `Q3-42`); you write that ID in your notebook; typing it back into
the Command Bar instantly retrieves the source.

Built to PRD v2.1. **Durability outranks everything**: reference IDs are monotonic and
never reused (D1), ID assignment is transactional, write failures are always surfaced,
and import-as-new-project preserves IDs exactly so notebook pointers keep resolving
across devices.

> **Taking over this project?** Start at [documentation/README.md](documentation/README.md) —
> it contains the PRD, a section-by-section implementation status, the architecture
> map with known gotchas, and the operations/deployment handover.

## Stack

- React 18 + TypeScript + Vite
- Dexie.js over IndexedDB (images stored as `Blob`s, never base64 at rest)
- Vitest + fake-indexeddb (56 tests, including every PRD §3.B parser edge case)
- No server, no network dependency at runtime; installable PWA

## Setup

```bash
npm install
npm run dev        # dev server on http://localhost:5173
npm test           # full test suite
npm run build      # production build to dist/ (also stamps sw.js)
npm run preview    # serve the production build
```

Icons are pre-generated; regenerate with `node scripts/gen-icons.mjs`.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus the Command Bar |
| `Esc` | Clear the Command Bar, return focus to the Capture Zone |
| `Ctrl+Enter` | Submit the capture |
| `Ctrl+E` | Export the active project |
| `Ctrl+P` | PDF view (browser print pipeline) |
| `?` | Shortcut overlay |

Pasting an **image** anywhere always routes to the Capture Zone, regardless of focus.
Mobile never autofocuses on load.

In the Capture Zone, a line starting with `//` is captured as a **link block** without
touching the mouse: `// https://example.com Q3 methodology doc` (everything after the
URL becomes the optional, searchable title; a missing scheme defaults to `https://`).
Only line-anchored `//` triggers this — URLs inside normal prose stay plain text.

`@word` anywhere in a capture sets the **source tag** and pins it, so subsequent
captures reuse it — the keyboard equivalent of typing a source and clicking the pin.
Unpin with the 📌 toggle or by clearing the source field. The token is stripped from
the saved text; the last `@word` wins if several appear; emails (`a@b.com`) are never
treated as tokens. A capture that is only `@word` just sets the source without saving
an insight.

## Command Bar queries

- `42` — insight #42 in the active project
- `1,3,6` / `1-7` / `1-4,9,12-14` — unions of IDs and ranges (reverse ranges are
  normalised; huge upper bounds are clamped to the project's high-water mark)
- `Q3-42` — insight 42 of the project with prefix `Q3`, from anywhere (switches
  context; archived projects still resolve)
- anything else — case-insensitive text search over source tags, text, URL
  href/titles, and image alt text

## The backup model

Local-first means the library lives in this browser's IndexedDB. Three layers keep it
safe:

1. **Persistent storage** is requested on first project creation; the top-bar
   indicator shows **Protected** / **At risk**. On iPhone/iPad, install to the Home
   Screen — Safari can evict non-installed web-app data after ~7 days of disuse.
2. **Export/Import** (project menu, `Ctrl+E`): JSON, or zip (`manifest.json` +
   `/images/` with SHA-256 checksums) above 25 MB. Import modes:
   - **Import as new project** (default, the device-hop path) — preserves every
     ref_id and the prefix exactly; refuses prefix collisions rather than renumber.
   - **Replace project** — destructive, typed-confirmation.
   - **Merge** — appends with NEW numbers; old notebook pointers to those insights
     stop resolving, and the dialog makes you acknowledge that.
3. **Frictionless auto-backup**: "Remember a backup folder" (Chromium File System
   Access API) makes every export one silent write; with it set, the app auto-exports
   after every 25 captures or the first capture of a new day, rotating the last 5
   backup files. A banner reminds you when captures are >7 days newer than the last
   export.

**Verify Library** (project menu) audits that every number from 1 to the high-water
mark is present or explicitly tombstoned, that every image blob still decodes, and
reports totals and export age. Read-only; never repairs silently.

## Deletion semantics

Soft-delete hides an insight (restorable via "Show deleted"). Purge is typed-confirm
and leaves a **tombstone**: the content is gone but the number stays retired forever —
looking it up says "permanently deleted", and no future capture can ever take that
number.

## PDF export

`Ctrl+P` builds a dedicated print DOM (chunked, ~50 items per frame, with progress) and
opens the browser print dialog — the browser's text engine provides correct Arabic
shaping and bidi. Noto Naskh Arabic is embedded as base64 in the print stylesheet, so
it works offline. Each item prints as: prefixed reference ID, source tag, content;
page breaks avoid splitting items.

## PWA / offline

The service worker precaches the app shell only (HTML/JS/CSS/icons — never your data,
which is already local in IndexedDB) and is stamped per build, so a new deploy always
replaces the old shell. The full loop — capture, retrieve, export, PDF — works with no
network. On Android, the app is a share target: share a screenshot from any app
straight into the Capture Zone.

## Migration from the legacy Insight Journal

Blocked on PRD decision D2 — see [src/migration/STUB.md](src/migration/STUB.md) for
exactly where the one-off import path attaches and how it will be verified.
