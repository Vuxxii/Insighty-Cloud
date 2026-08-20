# Implementation Status vs. PRD v2.1

Status date: **2026-08-15**. Built 2026-08-12; refined through 2026-08-15.
Every PRD §6 phase is **complete with its Verify gate proven**, except Phase 1.5
(migration), which the PRD itself blocks on open decision D2.

## Decisions (PRD §0)

| Decision | Status |
| --- | --- |
| **D1 — ref_id reuse** | ✅ Resolved as **monotonic** (per PRD): numbers are never reused; purge leaves a tombstone; `current_seq` never decreases. Enforced by the unique `[project_id, ref_id]` index and the capture transaction. |
| **D2 — relationship to legacy Insight Journal** | ⏳ **Still open.** Phase 1.5 not built. Attach point + verification plan documented in [`src/migration/STUB.md`](../src/migration/STUB.md). Nothing in the schema precludes D2(a). |

## Non-negotiable invariants (build contract) — all held

1. **Monotonic ref_ids** — purge tombstones (`insights.ts: purgeInsight`), import preserves IDs, `current_seq` only grows. Tested.
2. **Atomic ID assignment** — seq-increment + insert in ONE readwrite transaction (`insights.ts: captureInsight`). Abort-mid-transaction test proves no ID burned/duplicated.
3. **No silent write failures** — every write path goes through `guardWrite` (`src/ui/errorBus.ts`), which surfaces a blocking "NOT saved — do not transcribe" dialog and still rejects. Quota ≥95% blocks captures pre-write.
4. **Images are Blobs at rest** — base64 exists only at the export/PDF boundary. No `localStorage` for data (only the active-project UI preference).
5. **Import-as-new preserves every ref_id + prefix** — prefix collision throws instead of renumbering. Merge mode renumbers only behind an explicit acknowledgment of the PRD's warning.
6. **No `innerHTML` of user content** — React escaping everywhere; the print DOM uses `textContent` only; only `http(s):` linkifies, with `rel="noopener noreferrer"`.
7. **Unknown block types render a visible placeholder** — in feed and print; unknown types also survive import untouched.

## PRD section status

| PRD § | Feature | Status | Notes |
| --- | --- | --- | --- |
| 2 | SPA/PWA, IndexedDB, portability | ✅ | React 18 + TS + Vite; Dexie.js |
| 2.1 | Image pipeline | ✅ | WebP 0.85 default; JPEG 0.82 for large JPEG sources (>300 KB heuristic); PNG fallback; support detected once at startup; EXIF via `createImageBitmap(…, from-image)`; HEIC decoded where the browser can, else explicit error and **no ref assigned**; 2000px max dimension |
| 2.2 | Durability & quota | ✅ | `persist()` on first project; Protected/At-risk chip; iOS-specific eviction copy; warn ≥80%, block ≥95%; stale-backup banner at 7 days |
| 2.3 | PWA scope | ✅ | Manifest (+`share_target`), app-shell-only SW stamped per build with the exact asset list; full offline loop verified with the server killed |
| 2.4 | Frictionless backup | ✅ | FS Access API remembered folder (Chromium), auto-backup every 25 captures or first capture of a new day, keeps last 5 matching files, download fallback elsewhere |
| 3.A.0 | Project prefixes | ✅ | 1–6 chars, unique among non-archived (checked in-transaction — IDB has no partial indexes), initials suggested, rename shows the permanence warning |
| 3.A | Capture flow | ✅ | Single-transaction ID assignment; large prefixed success display; Quick Edit = 5 min or next capture, bumps `updated_at`, never touches ref_id |
| 3.A.1 | Arabic/RTL | ✅ | First-strong-char detection stored per insight; manual override; locale-aware source sorting; print honours stored direction |
| 3.A.2 | Mobile capture | ✅ | `share_target` (Android), camera input, no autofocus on mobile, capture pane stacked on top in narrow mode |
| 3.B | Command Bar | ✅ | Full routing incl. cross-project prefixed queries (case-insensitive, switches context, archived projects resolve); **every edge-case table row has a dedicated unit test**; ranges resolve via `IDBKeyRange` on `[project_id+ref_id]`, clamped to `current_seq` — proven no per-ID enumeration |
| 3.C | Export/Import/PDF | ✅ | JSON or zip >25 MB (SHA-256 per image, refuse-on-mismatch naming the file); schema_version validated; all-or-nothing transactions; 3 modes with the PRD's merge warning; PDF via `window.print()` on a chunked print DOM with embedded Noto Naskh Arabic |
| 3.D | Delete & archive | ✅ | Soft-delete + restore; purge = typed confirmation + tombstone; purged lookup says "permanently deleted"; archived projects hidden but resolvable |
| 3.E | Rendering safety | ✅ | See invariant 6; URL titles are user-typed only (never fetched) — stated in the UI |
| 3.F | Verify Library | ✅ | Missing-ref sweep 1..current_seq, blob decode check, totals + export age; read-only; chunked yields keep UI responsive |
| 4 | Schemas | ✅ | As specified, incl. `purged` tombstone flag and `ocr_text?` slot reserved on image blocks |
| 5 / 5.1 | Theme, layout, focus model | ✅ | Dark "Modern Analyst"; split/stack; document-level paste routing (image → Capture Zone regardless of focus — verified with search focused); `/`, `Esc`, `Ctrl+Enter`, `Ctrl+E`, `Ctrl+P`, `?` |
| 6 | Phase gates | ✅ | See below |
| 7 | Future opportunities | ⏳ | Not built (by design); `ocr_text?` slot reserved |

## Phase verify gates — how each was proven

| Phase | Gate | Proof |
| --- | --- | --- |
| 1 | Round-trip equality, zip checksums, EXIF upright, visible quota error | `tests/phase1_roundtrip.test.ts`, `phase1_quota_and_errors.test.ts`, `phase1_pipeline.test.ts`; EXIF verified at the unit level (orientation option asserted) + live browser check of the full pipeline (PNG→WebP, 2400×1200→2000×1000, real Blob) |
| 1.5 | — | **Skipped, blocked on D2** (per build contract) |
| 2 | Abort burns nothing; double-submit distinct IDs; direction fixtures | `tests/phase2_capture.test.ts` + live checks |
| 3 | Every §3.B table row; key-range-only resolution | `tests/phase3_parser.test.ts` (spies prove 1 `where()` call, 0 `get()` calls on a `5-99999999` query) |
| 4 | No mobile autofocus; paste-routes-with-search-focused | Verified live in the browser pane (mobile viewport + synthetic paste with search focused) |
| 5 | Purged-ID message; `current_seq` unchanged; corrupted-blob detection | `tests/phase5_delete_verify.test.ts` + full live UI walkthrough (delete → show-deleted → typed purge → retrieval message) |
| 6 | Full loop offline; stale-shell busting | Server killed, page reloaded: shell served from SW cache, capture + retrieval worked; rebuilt deploy replaced the old shell cache (verified by cache names) |

**Not verifiable from this machine:** print output in Firefox/Safari (page-break +
Arabic shaping) and a real-device Android share-target run. Both flagged in
HANDOVER.md as first-run field checks.

## Post-v1 additions (after the PRD, user-requested)

| Addition | Behaviour | Where |
| --- | --- | --- |
| `//` link command | A line `// <url> <optional title>` becomes a url block; scheme defaults to `https://`; line-anchored only (prose URLs untouched); live "🔗 detected" hint | `src/text/captureParse.ts` |
| `@` source command | `@word` anywhere sets the source tag **and pins it** for subsequent captures; last token wins; token stripped from text; emails immune (`\s@` boundary); trailing punctuation dropped; `@word`-only submit pins without burning a ref | `src/text/captureParse.ts`, `CaptureZone.tsx` |
| PDF fixes | Print container moved outside `.app` (was blanked by `display:none` ancestor → dark/empty PDFs); page forced white-on-print; images awaited via `img.decode()` before `window.print()` (were printing as gaps); images up to 85vh/page | `src/pdf/print.ts`, `styles.css`, `App.tsx` |
| PDF filename | `document.title` stamped `"<project> YYYY-MM-DD HH-mm"` during the dialog, restored after | `src/pdf/print.ts: printTitle` |
| Double-submit fix | Ctrl+Enter was handled twice (local + global) faster than React state could block → two captures per keystroke. Now one handler + a synchronous `submittingRef` guard | `CaptureZone.tsx`, `App.tsx` |
| Windows launcher | `Insightyyy.bat`: builds if needed, starts preview if port 4173 is free, opens the browser | project root |
| Shared-hosting deploy | `public/.htaccess` (manifest MIME + cache rules: hashed assets immutable, entry points no-cache) ships in every build; `Insightyyy-upload.zip` packaging flow | HANDOVER.md |
