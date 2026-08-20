# Handover & Operations

## Prerequisites

Node.js ≥ 20 (built and tested on Node 25) and npm. Windows is the current dev
machine but nothing is platform-specific except `Insightyyy.bat`.

## Everyday commands

```bash
npm install        # once per machine
npm run dev        # dev server, http://localhost:5173 (NO service worker in dev)
npm test           # 76 tests, ~2s — run before and after every change
npm run build      # typecheck + production bundle to dist/ + stamped sw.js
npm run preview    # serve dist/ at http://localhost:4173 (SW active here)
node scripts/gen-icons.mjs   # regenerate PWA icons (only if the mark changes)
```

`Insightyyy.bat` (project root) is the user's launcher: builds if `dist/` is missing,
starts the preview server if port 4173 is free, opens the browser.

> **Recommended first act as maintainer:** `git init` and commit. The project has no
> version control history — it was built in one AI-assisted session; the docs in this
> folder are the record of intent.

## Testing conventions

- `tests/` mirrors the PRD phases (`phase1_*` … `phase5_*`, `phase3_parser` carries
  the full §3.B edge-case table — **one `describe` per table row**, keep it that way).
- Vitest runs in **node** environment with `fake-indexeddb` (see ARCHITECTURE.md
  gotchas for why not jsdom). Every storage function takes an optional
  `InsightyyyDB` parameter; tests construct isolated throwaway databases
  (`freshDbName()` in `tests/setup.ts`) — never share DB state between tests.
- Anything touching capture, purge, import, or the parser needs a test that fails if
  a ref_id could be burned, reused, or renumbered. That is the review bar.

## Deployment (currently: Namecheap shared hosting)

The app is 100% static — any host that serves files over **HTTPS** works (HTTPS is
mandatory: service workers refuse plain http, and the SW is what provides offline +
installability).

1. `npm run build`
2. Zip the **contents** of `dist/` (`Compress-Archive -Path dist\* …`) — the build
   includes `.htaccess` (manifest MIME type + cache policy: hashed assets immutable,
   `index.html`/`sw.js`/manifest no-cache; that no-cache rule is what lets deployed
   updates actually reach installed apps).
3. cPanel → File Manager → extract into `public_html` (or a subdomain's root).
4. Ensure AutoSSL is active; visit `https://…`; install to Home Screen on phones
   (on iOS this is also the durability control against Safari's 7-day eviction).

**Constraints:** must live at a domain/subdomain **root** — absolute paths (`/assets`,
`/sw.js`, manifest `start_url: "/"`) break in a subfolder. To support a subfolder,
set Vite `base`, prefix the SW precache list and manifest URLs accordingly.

**Update ritual (localhost and hosted):** deploy the new files, then load the app and
**reload twice** — first reload installs the new SW (`skipWaiting`), second serves the
new shell. Users' data is untouched by updates (IndexedDB is separate from SW caches).

**Data model of "hosted":** the server only hosts code. Each browser/device has its
own library. Moving a library between devices = Export → **Import as new project**
(preserves every ref_id + prefix — this is the designed device-hop path). There is no
sync; cloud sync is future scope (the schema's `updated_at`/`schema_version` fields
anticipate it).

## Open decisions & first field checks

- **D2 (PRD §0) is open** — replacement vs. parallel tool for the legacy SQLite
  Insight Journal. Phase 1.5 is unbuilt; start from [`src/migration/STUB.md`](../src/migration/STUB.md).
  Do not build features that would preclude D2(a) (none currently do).
- **Untested in the field** (tooling couldn't reach them): print output in
  Firefox/Safari (page breaks + Arabic shaping), Android share-a-screenshot → capture,
  real-iPhone install flow. Check each once on real devices; everything else in
  IMPLEMENTATION_STATUS.md was proven by test or live browser verification.

## Future work (PRD §7 — deliberately not built)

1. **Background OCR** (Tesseract.js, Arabic-capable) — highest-leverage next feature
   for a screenshot-heavy library. The image block already reserves `ocr_text?`;
   OCR should write that sidecar field and text search (`search/resolve.ts`) gains
   one extra `includes()` — the design seam already exists.
2. **Cloud sync toggle** — schema-anticipated, nothing built.
3. **Notebook manifest** — optional log of transcribed IDs; would close D2(a)'s
   physical-verification gap for good.

## Support playbook

| Symptom | Likely cause → fix |
| --- | --- |
| "At risk" storage chip | Browser denied persistence. Chromium: install the PWA / keep using it, then re-check. iOS: MUST add to Home Screen (7-day eviction). Export a backup either way. |
| Update doesn't appear | Old SW still controlling — reload twice; confirm the host isn't caching `sw.js` (the shipped `.htaccess` prevents this on Apache). |
| Capture fails with "NOT saved" | Working as designed: the write failed (usually quota). Export, free space, retry. The shown ref was NOT assigned — do not transcribe it. |
| PDF missing images / dark pages | Fixed 2026-08-15 (decode-wait + print-root placement). If it regresses, re-read the print gotchas in ARCHITECTURE.md. |
| A number resolves to "not found" unexpectedly | Run Verify Library (project menu). Missing refs = storage loss → restore from the newest export. Purged refs are correct behaviour, not loss. |
| Import refuses a file | The message names the reason (checksum, schema_version, prefix collision). Never work around by renumbering — that is the one forbidden move. |
