# Architecture

React 18 + TypeScript + Vite SPA/PWA. Dexie.js over IndexedDB. No server, no network
at runtime. State is one React context provider; storage logic is plain TypeScript
modules that take an injectable database handle (which is what makes the test suite
possible).

## Directory map

```
src/
  db/            Storage layer (all durability-critical code lives here)
    types.ts       Schema types, SCHEMA_VERSION, prefix regex
    db.ts          Dexie subclass + version() migration runner; meta accessors
    projects.ts    Create/rename/archive; prefix uniqueness; prefix→project lookup
    insights.ts    captureInsight (THE atomic transaction), edit, soft-delete,
                   purge (tombstone), key-range fetches, source-tag history
  images/
    pipeline.ts    decode(EXIF-aware) → downscale(≤2000px) → encode per codec policy
  text/
    direction.ts   First-strong-character LTR/RTL resolution (stored, not recomputed)
    captureParse.ts  Inline commands: `// url title` → link, `@word` → pinned source
  search/
    parser.ts      ID-query grammar (§3.B table), routing, range normalise/clamp/merge
    resolve.ts     IDBKeyRange resolution (never per-ID loops); linear text search
  backup/
    format.ts      Export file shape, slug/filename, sha256, base64 helpers
    exporter.ts    JSON / zip (checksummed) export; download trigger
    importer.ts    Parse+validate BEFORE any write; 3 modes, each one transaction
    autoBackup.ts  FS Access remembered dir, rotation (last 5), cadence logic
  storage/
    durability.ts  persist()/persisted(), quota estimate (warn 80 / block 95), iOS copy
  verify/
    verifyLibrary.ts  §3.F integrity check (missing refs, undecodable blobs, totals)
  pdf/
    print.ts       Chunked print-DOM build, image-decode wait, title stamp, cleanup
  pwa/
    shareIntake.ts Drains share_target payloads the SW stashed into a cache
  state/
    app.tsx        THE context provider: projects/feed/query/quota state + all actions
  ui/
    errorBus.ts    guardWrite + blocking/non-blocking error surfacing (invariant 3)
  components/      TopBar, CommandBar, CaptureZone, Feed, InsightCard, EditDialog,
                   PurgeDialog, ProjectDialog, ImportDialog, VerifyDialog, Overlays,
                   StorageStatus, SuccessRef
  sw.template.js   Service worker source; build stamps __BUILD_ID__/__PRECACHE__
  App.tsx          Layout, global keyboard + paste routing, print orchestration
  main.tsx         Bootstrap: codec detection, SW registration (prod only)
public/            manifest.webmanifest, icons, .htaccess (copied into dist/)
scripts/gen-icons.mjs  Dependency-free PNG icon generator (H·H monogram)
tests/             7 files, 76 tests; fake-indexeddb; node environment (see Gotchas)
```

## Data model (see PRD §4 for field-by-field)

Three stores. `meta` is a single row (settings, `last_export_at`, backup dir handle,
auto-backup cadence counters). `projects` carries `prefix` and `current_seq` — the
high-water mark that IS the ID generator. `insights` rows have `content: Block[]`
(text / image-with-Blob / url union — unknown types must round-trip), a stored
`direction`, `deleted_at` (soft delete) and `purged` (tombstone).

Indexes: **unique** `[project_id+ref_id]` (no partial-index qualifier needed because
IDs are monotonic), plus `[project_id+source_tag]`, `[project_id+deleted_at]`,
`project_id`. Schema changes = bump `SCHEMA_VERSION` in `types.ts` **and** add a new
`version()` block in `db.ts` — Dexie's version chain is the migration runner.

## The five critical flows

**Capture** (`CaptureZone.submit` → `state/app.capture` → `insights.captureInsight`):
quota pre-check (blocks ≥95%) → parse inline commands → resolve direction from the
final text → `guardWrite(` one readwrite transaction over `projects`+`insights`:
read project, `ref = current_seq+1`, put project, add insight `)` → Quick-Edit window
armed → auto-backup cadence tick → feed refresh. If ANYTHING throws inside the
transaction, both writes roll back — no burned numbers, and the user sees a blocking
"NOT saved" dialog.

**Retrieval** (`CommandBar` → `search/parser.routeQuery` → `search/resolve`):
prefixed match against known prefixes wins (switches active project, works for
archived), else bare-ID syntax scoped to the active project, else text search.
ID queries: normalise (reverse ranges, dedupe, merge overlaps) → clamp to
`current_seq` → ONE `.between()` per merged range. Results classify per ref:
found / soft-deleted / purged / missing — the UI renders an explicit message for each
class; a blank screen is a spec violation.

**Export/Import** (`backup/`): export builds `{schema_version, app_version,
exported_at, project, insights}`; zip form adds `/images/` + per-file bytes and
SHA-256 in the manifest. Import **fully parses and verifies before any write**
(checksums, schema_version, duplicate/invalid ref_ids, missing files) — this ordering
is load-bearing: awaiting non-IDB promises inside a Dexie transaction kills the
transaction, and refuse-before-write is the §3.C contract. Then one all-or-nothing
transaction per mode: new-project (IDs+prefix preserved; collision throws),
replace (destructive), merge (renumbers, returns the from→to mapping).

**PDF** (`pdf/print.ts` + `@media print` in `styles.css`): build a hidden print DOM
in ~50-item chunks (progress UI), **await `img.decode()` on every image**, stamp
`document.title` with `"<project> YYYY-MM-DD HH-mm"` (that becomes the suggested PDF
filename), `window.print()`, restore/cleanup on `afterprint`. The print container is
a **sibling** of `.app` because print CSS hides `.app` entirely. Arabic works because
the browser's text engine does shaping/bidi; Noto Naskh Arabic is inlined base64 via
the `?inline` Vite import.

**Service worker** (`sw.template.js` + the inline Vite plugin in `vite.config.ts`):
the plugin stamps a build id and the exact emitted asset list at build time — the
shell cache is therefore per-deploy and self-busting; `skipWaiting`+`claim` on
activate; fetch serves precache-first with a navigation fallback to `index.html` and
**caches nothing else at runtime** (user data must never be duplicated into SW
caches). It also implements the `share_target` POST: stash files/text into the
`insightyyy-share-intake` cache, redirect to `/`, where `pwa/shareIntake.ts` drains
them into the Capture Zone.

## Gotchas (each of these was a real bug — do not relearn them)

- **SW cache matching needs `ignoreVary: true`.** `<script crossorigin>` requests
  carry an `Origin` header the precache request lacked; a `Vary` response header then
  forces a miss → white screen offline.
- **`requestAnimationFrame` never fires in hidden tabs.** The print chunker races rAF
  against a 40 ms timeout; without it, printing from a background window hangs.
- **`isMobile` must be reactive state.** A window that mounts hidden/narrow (width 0)
  would otherwise lock the app into mobile behaviour (no autofocus, no focus-return)
  forever.
- **Submit needs a synchronous re-entrancy guard** (`submittingRef`). React state
  (`busy`) cannot stop a second call in the same tick; one Ctrl+Enter once produced
  two captures = two burned refs. Ctrl+Enter is handled ONLY by the app-level
  handler; never add a local one back.
- **JSZip must be fed ArrayBuffers, not Blobs** — its Blob detection fails outside
  real browsers (Node/tests).
- **Tests run in `node` env, not jsdom** — jsdom's Blob breaks fake-indexeddb's
  structured clone; Node's native Blob works. DOM-needing tests stub what they need.
- **sw.template.js token stamping uses `replaceAll`**, and the template comment must
  never contain the literal tokens (`.replace` once hit the comment first and shipped
  an unstamped worker).
- **Print images must be decode-awaited** — the print snapshot renders still-loading
  blob images as blank gaps.
- **The print root must not sit inside `.app`** — `display:none` on an ancestor
  blanks every page regardless of the child's own display.
- **Prefix uniqueness is code-enforced** (inside the same transaction), not a unique
  index — it only applies among non-archived projects and IDB has no partial indexes.
  Un-archiving re-checks the namespace.
