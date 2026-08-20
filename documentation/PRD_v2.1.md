# Product Requirements Document (PRD): Insightyyy

**Version:** 2.1
**Status:** Draft — D1 resolved (monotonic). D2 remains open and blocks Phase 1.5 only; Phase 1 may begin.

**Changelog v2.0 → v2.1**
*   **D1 resolved:** monotonic `ref_id` (never reused). `released_ids` removed from schema. §3.D updated.
*   **New:** project reference prefixes for notebook-side disambiguation (§3.A.0).
*   **Import modes reworked:** "Import as new project" (ref_ids preserved) added as the device-hop path; Merge demoted and given a destructive-adjacent warning (§3.C).
*   **Image pipeline:** WebP default, JPEG only for photographic content; EXIF orientation and HEIC handling specified (§2.1).
*   **Durability:** Safari/iOS eviction risk named explicitly; frictionless backup (File System Access API + auto-backup cadence) added (§2.2, §2.4).
*   **Mobile capture:** PWA `share_target` and camera capture specified (§3.A.2).
*   **PDF mechanism committed:** browser print pipeline (`window.print()`), chunked DOM build (§3.C).
*   **Focus & keyboard model defined** (§5.1); autofocus disabled on mobile.
*   **Security:** render-time sanitization rules (§3.E).
*   **Search scope & scale expectations defined**; parser range-clamping rule added (§3.B).
*   **Verification strategy added per phase**; library integrity check ("Verify Library") added (§3.F, §6).
*   Smaller holes closed: default feed state, Quick Edit semantics, export file structure, D2(a) verification scope.

---

## 0. Decisions

**D1 — Reference ID reuse on delete. ✅ RESOLVED: (b) Monotonic.**
`ref_id` values are never reused. Deleted numbers stay permanently retired; the notebook sequence may contain gaps. Rationale: reuse would allow a handwritten pointer to silently resolve to the wrong content — a direct violation of the durability constraint in §1, and worse than data loss because it is *wrong data with no error*. The legacy tool's reuse behaviour is a migration concern (D2), not a precedent. §3.D and §4 reflect this decision; `released_ids` has been deleted.

**D2 — Relationship to the existing Insight Journal. ⏳ OPEN.**
*   **(a) Replacement:** Existing SQLite data migrates in, preserving `ref_id` and `source_tag` so old notebook pointers keep resolving. Requires Phase 1.5 (Migration). *Verification scope (see §6, Phase 1.5): the migration can verify that every `(ref_id, source_tag)` pair in the source database round-trips into the new store byte-accurately. It cannot verify against what is physically written in notebooks, since no manifest of handwritten entries exists. The acceptance criterion is therefore data-level round-trip equality, stated as such.*
*   **(b) Parallel tool:** Insightyyy starts a fresh numbering space (and a fresh project prefix, §3.A.0). Old notebooks continue to resolve against the old tool, which must be kept runnable indefinitely.

D2 blocks only Phase 1.5. All other phases may proceed.

## 1. Product Overview & Goals
*   **Product Name:** Insightyyy
*   **Brand Stamp:** "Hakami" (integrated subtly in the UI as a maker's mark).
*   **Objective:** A high-speed, local-first web application designed to bridge physical handwritten notes with digital source materials.
*   **Core Loop:** The user captures digital insights (images, URLs, text) -> The app generates a simple sequential Reference ID within the active project -> The user writes the **prefixed** ID (e.g., `Q3-42`, §3.A.0) in a physical notebook -> The user can instantly retrieve the digital source later by searching the ID.
*   **Primary durability constraint:** Physical notebook pointers are permanent and cannot be updated. Any silent loss *or silent re-pointing* of the digital library permanently orphans or corrupts handwritten references. Durability therefore outranks feature velocity in all trade-off decisions. Corollaries now encoded in this document: monotonic IDs (D1), ref-preserving import (§3.C), frictionless backup (§2.4), and explicit treatment of browser eviction (§2.2).

## 2. Technical Architecture & Stack
*   **Application Type:** Single Page Application (SPA), installable as a PWA (see §2.3).
*   **Frontend Framework:** React, Vue, or Vanilla JS (Agent's discretion for fastest implementation).
*   **Database/Storage:**
    *   **Primary:** `IndexedDB` (Critical: Do NOT use `localStorage` for primary data due to 5MB limits with images).
    *   **Data Portability:** JSON/ZIP Export/Import system for offline device-hopping (§3.C), plus low-friction local backup (§2.4).
    *   **Future-Proofing:** Architecture should allow for an optional Cloud Sync toggle later. See `updated_at` / `schema_version` fields in §4.

### 2.1 Image Handling
*   Client-side processing (HTML5 Canvas / `createImageBitmap`) before persistence. Target max dimension 2000px, configurable.
*   **Codec policy:**
    *   **Default: WebP.** The dominant capture type is screenshots of documents — text-heavy, flat-colour images where JPEG produces visible ringing artifacts and WebP is both sharper and smaller. Use WebP quality ~0.85; preserve transparency (never flatten to a background colour).
    *   **JPEG path only for photographic content.** Heuristic: if the source is already JPEG (camera photo) and large, re-encode as JPEG ~0.82; otherwise WebP.
    *   If `canvas.toBlob('image/webp')` is unsupported (older Safari), fall back to PNG for flat content and JPEG for photos. Detect support once at startup, not per capture.
*   **EXIF orientation must be honoured before re-encode.** Use `createImageBitmap(file, { imageOrientation: 'from-image' })`; canvas re-encode strips EXIF, so a phone photo persisted without applying orientation renders sideways forever. This is a hard requirement, not a nice-to-have.
*   **HEIC/HEIF pastes and shares (iOS):** detect by MIME/extension. If the browser can decode it (Safari can), transcode to WebP/JPEG via canvas. If it cannot, show an explicit "unsupported image format" error — never persist an undecodable blob behind a valid `ref_id`.
*   **Persist images as `Blob`, not base64 strings.** IndexedDB stores Blobs natively; base64 inflates payload ~33% and forces a decode on every render.
*   Base64 conversion happens only at the export/PDF boundary, never at rest.

### 2.2 Durability & Storage Quota
*   On first project creation, call `navigator.storage.persist()` to request persistent (non-evictable) storage.
*   Surface the result in the UI as a persistent status indicator: **Protected** (granted) / **At risk** (denied).
*   **Browser-specific eviction reality (must be reflected in the At-risk messaging):**
    *   Chromium: `persist()` is usually granted after engagement or PWA install; granted means non-evictable.
    *   Firefox: prompts the user; respect the answer.
    *   **Safari/iOS is the landmine:** Safari may evict *all* site data for non-installed web apps after ~7 days without interaction, and `persist()` guarantees little. On Safari/iOS, the At-risk state must additionally say: *"On iPhone/iPad, add Insightyyy to your Home Screen — Safari can delete this library after 7 days of disuse otherwise"* and link to the install flow (§2.3). For a product whose failure mode is permanently orphaned handwritten references, this warning is a durability feature, not UX copy.
*   Poll `navigator.storage.estimate()` on app load. Warn at 80% of quota; block new captures with an explicit error at 95% rather than failing silently mid-write.
*   Track `last_export_at` in app settings. If the newest insight is more than 7 days newer than the last export, show a non-blocking backup reminder banner (see §2.4 for making the export itself one click).
*   All write failures (`QuotaExceededError`, transaction abort) must surface a visible error. Never fail silently — the user may otherwise write a reference number into their notebook for an insight that was never saved.

### 2.4 Frictionless Backup (new)
Manual export alone leaves the library one stolen laptop away from the catastrophe §1 forbids. Two mitigations, both local-first:
*   **One-click re-export via the File System Access API (Chromium):** on first export, offer "Remember this backup location." Store the directory handle in IndexedDB; subsequent exports write `insightyyy_<slug>_<date>.json|zip` into that folder with a single click and no file picker. Where the API is unavailable (Firefox/Safari), fall back to a normal download.
*   **Auto-backup cadence:** setting (default **on**) — after every *N* captures (default 25) or on first capture of a new day, silently trigger the one-click export path if a remembered location exists; otherwise show the reminder banner. Auto-backups rotate: keep the last 5, delete older ones (only in the remembered directory, only files matching the app's own filename pattern).
*   Every successful export (manual or auto) updates `last_export_at`.
*   Cloud sync remains future scope; nothing here requires a network.

### 2.3 PWA Scope
*   Web app manifest: name, short name, icons (H·H monogram, 192/512px), `display: standalone`, theme colour matching the dark palette.
*   **Manifest `share_target` (new, see §3.A.2):** accept shared images/text/URLs so Android users can share a screenshot directly into Insightyyy.
*   Service worker caches the app shell only (HTML/JS/CSS). Data is already local in IndexedDB and must not be duplicated into the SW cache.
*   App must be fully functional with no network connection, including capture, retrieval, export, and PDF generation.
*   Cache-busting on shell updates; do not serve a stale shell against a newer schema version.
*   **On iOS, installation is a durability control (§2.2), and the app should actively promote it there.**

## 3. Core Features & Functional Specifications

### A.0 Project Reference Prefix (new)
Reference IDs reset to 1 per project, so a bare handwritten "42" is ambiguous across projects — a product defect discoverable only after notebooks fill up. Therefore:
*   Every project has a **short prefix** (1–6 chars, letters/digits, user-chosen at creation, e.g. `Q3`), unique among non-archived projects. Default suggestion: initials of the project name.
*   The success display after capture shows the **full prefixed ID** (`Q3-42`) — this is what the user transcribes.
*   The Command Bar accepts prefixed queries: `Q3-42` resolves project `Q3`, insight 42, *regardless of the currently active project*, and switches context accordingly. Bare numeric queries remain scoped to the active project.
*   Prefix is metadata only; `ref_id` in storage stays a plain integer. Renaming a prefix is allowed but shows a warning that previously transcribed prefixes will no longer match (same permanence logic as everything else in this document).

### A. The Capture Flow
*   **Project Selection:** Top-level dropdown to select or create a new active Project (name + prefix). Reference IDs reset to `1` for every new project.
*   **The Capture Zone:** A large input area supporting paste (`Ctrl+V`/`Cmd+V`) of images/text, drag-and-drop, and typing. See §5.1 for the global paste/focus model — paste of an image routes to the Capture Zone regardless of which element has focus.
*   **Sticky Source Input:**
    *   An input field below the capture zone for the "Source" (e.g., "Q3 Report").
    *   Includes a "Pin/Lock" toggle. When locked, the source persists for subsequent captures.
    *   Includes a dropdown history of previously used source tags in the current project for 1-click selection.
*   **Submission:** Triggered via `Ctrl+Enter` or a primary button.
    *   The sequence increment and the insight insert **must occur inside a single IndexedDB `readwrite` transaction** spanning both the `projects` and `insights` stores. A mid-write refresh must not burn or duplicate a reference number.
    *   The assigned **prefixed** `ref_id` is displayed prominently on success, large enough to transcribe at a glance.
*   **Quick Edit (semantics defined):** Upon submission, an "Edit" affordance appears on the captured item and remains available for **5 minutes or until the next capture, whichever comes first**. It allows replacing a mistakenly pasted image or fixing a typo. Quick Edit **updates `updated_at`** and is a normal edit (no separate undo stack); after the window closes, editing happens through the standard item edit flow. Quick Edit never changes `ref_id`.

### A.1 Arabic / RTL Support
*   Per-insight text direction: `auto` (default, first-strong-character detection), with manual LTR/RTL override on the capture zone.
*   Store the resolved direction on the insight (`direction` field, §4) so rendering is deterministic on retrieval and in PDF export.
*   UI chrome remains LTR; only insight content flips. Mixed Arabic/Latin content within one insight must render correctly via `dir="auto"` on the content container.
*   Source tags support Arabic text and must sort sensibly (locale-aware compare, not raw code point).
*   PDF export must embed an Arabic-capable font (see §C) — one reason the print pipeline is browser-native (§C), since browser text layout handles Arabic shaping and bidi correctly for free.

### A.2 Mobile Capture (new)
The person holding the physical notebook is often away from a desk; mobile is a first-class capture surface, not an afterthought.
*   **`share_target` (Android PWA):** manifest declares a share target accepting `image/*`, `text/plain`, and URLs. Sharing a screenshot from any app opens Insightyyy pre-loaded into the Capture Zone with the last-pinned source pre-filled; one tap assigns the ref_id.
*   **Camera capture:** the Capture Zone exposes a camera/file button (`<input type="file" accept="image/*" capture="environment">`) for photographing paper sources directly. EXIF orientation handling (§2.1) applies.
*   **iOS:** no `share_target` support; camera/file input and paste cover capture. The install prompt (§2.2/§2.3) is the priority on iOS for durability reasons.
*   Narrow-mode layout (§5) places the Capture Zone within thumb reach; the success ref_id display must be legible at arm's length for transcription.

### B. The Retrieval Flow (Command Bar)
*   **Input:** A prominent search bar. Focus behaviour per §5.1 (`/` to focus; **no autofocus on mobile** — forcing the keyboard open on load is hostile).
*   **Routing:**
    *   If the trimmed query matches a **prefixed ID pattern** (`^[A-Za-z0-9]{1,6}-[\d,\-\s]+$` where the prefix matches a known project), resolve against that project (§A.0).
    *   Else if it matches `^[\d,\-\s]+$`, treat it as an ID query scoped to the active project.
    *   Otherwise fall through to **text search** (scope defined below), case-insensitive, scoped to the active project.
*   **Text search scope & scale:** searches `source_tag`, text block `value`s, URL block `href` and `title`, and image block `alt` text (alt is the only searchable handle on an image until OCR exists — see §7). Implementation is a linear scan over the active project's insights; this is acceptable and expected up to several thousand insights per project. No full-text index is required in v1; if a project exceeds ~10k insights, revisit.
*   **Default feed state (defined):** before any query, the feed shows the active project's insights **newest-first**. Query results replace the feed; clearing the query restores the default state.
*   **ID Query Logic:**
    *   *Single ID:* `4` retrieves Insight #4.
    *   *Comma-Separated:* `1,3,6` retrieves Insights #1, #3, and #6.
    *   *Range:* `1-7` retrieves all insights from #1 through #7.
    *   *Mixed:* `1-4,9,12-14` is valid and resolves to the union of its parts.

**Parser edge cases (required behaviour):**

| Input | Behaviour |
| :--- | :--- |
| `7-1` (reverse range) | Normalise to `1-7`; do not error. |
| `1-100` with only 20 insights | Return what exists; show a subtle "IDs 21–100 not found" note. No error state. |
| `3` where #3 was deleted | Empty result with explicit "Insight #3 not found" — never a blank screen. |
| ` 1 , 3 ` (whitespace) | Trim and parse normally. |
| `1,,3` / trailing comma | Ignore empty segments. |
| `0` or negative | Empty result, no crash. |
| `1-` / `-5` (incomplete range) | Treat as incomplete input; do not run a query until valid. |
| Duplicate IDs (`1,1,3`) | De-duplicate. |
| **`5-99999999` (huge range)** | **Clamp the upper bound to the project's `current_seq` before resolving, and resolve ranges via IndexedDB key-range queries on the `[project_id, ref_id]` index — never by enumerating candidate IDs in a loop. A stray keystroke must not lock the tab.** |
| Result ordering | Always ascending by `ref_id`, regardless of query order. |

### C. Export, Import & PDF
*   **Backup:** 1-click "Export Project" and "Import Project" (plus the frictionless paths in §2.4).
    *   Export format: JSON, or `.zip` above 25MB — a `manifest.json` plus an `/images/` directory of binary files referenced by filename. The importer must accept both formats.
    *   **Export file structure (defined):** top level contains `{ schema_version, app_version, exported_at, project: {…}, insights: […] }`. In zip form, `manifest.json` carries the same plus, per image file, its byte size and **SHA-256 checksum**; the importer verifies checksums and refuses on mismatch with a clear message naming the corrupt file.
    *   Export filename: `insightyyy_<project-slug>_<YYYY-MM-DD>.json|zip`.
    *   Import must validate `schema_version` and refuse (with a clear message) rather than partially apply an incompatible file. Import is transactional: all-or-nothing.
    *   **Import modes (reworked):**
        1.  **Import as new project (default — the device-hop path):** creates a new project from the file, **preserving every `ref_id` and the project prefix exactly**. If the prefix collides with an existing non-archived project, prompt to archive/rename before proceeding — never renumber. This is the correct flow for moving a library between devices: notebook pointers keep resolving.
        2.  **Replace project (destructive):** overwrites an existing project's contents with the file's, requires typed confirmation of the project name.
        3.  **Merge into existing project (renumbering — use with care):** appends the file's insights as *new* refs continuing from the target project's `current_seq`. **Must display a prominent warning: "Imported insights will receive new reference numbers. Any notebook entries pointing at their original numbers will NO LONGER resolve."** Requires explicit acknowledgment. Only appropriate for deliberately consolidating projects.
    *   Every successful export updates `last_export_at` (§2.2).
*   **PDF Exporter (mechanism committed):** browser-native print pipeline, not a JS PDF library.
    *   Rationale: `window.print()` with a print stylesheet gets correct Arabic shaping, bidi, and font rendering from the browser's text engine for free; JS PDF libraries make Arabic genuinely painful. Accepted trade-offs: the user goes through the print dialog and the output filename is not guaranteed.
    *   *Flow:* build a dedicated print DOM (hidden route or iframe) → `window.print()` → user saves as PDF.
    *   *Layout per item:* **Heading:** prefixed Reference ID. **Subtitle:** Source Tag. **Body:** Captured image/text.
    *   *CSS:* `@media print` with `page-break-inside: avoid` on each item block.
    *   *Fonts:* Embed an Arabic-capable font (e.g. Noto Naskh Arabic or IBM Plex Sans Arabic) as base64 in the print stylesheet. System font fallback does not render Arabic reliably in print across browsers.
    *   *Direction:* Honour each insight's stored `direction` in the print layout.
    *   *Scale:* For projects above ~200 insights, **build the print DOM progressively in chunks** (e.g. 50 items per animation frame) with a progress indicator, then print once complete — "chunking" refers to DOM construction, not multiple print jobs.

### D. Delete & Archive
*   Insights are soft-deleted: set `deleted_at`, exclude from retrieval and PDF export by default.
*   A "Show deleted" toggle in the project view allows restore. Restore updates `updated_at`.
*   Hard-delete (purge) is a separate, explicit action with typed confirmation. **Purge removes content but the `ref_id` remains permanently retired (D1): `current_seq` never decreases and no future capture may take a purged number.** Retrieval of a purged ID shows "Insight #N was permanently deleted" — never a blank screen, and never someone else's content.
*   Projects can be archived (hidden from the main dropdown) without deletion. Archived projects remain resolvable via prefixed queries (§A.0/§B).

### E. Rendering Safety (new)
*   All user content (text blocks, source tags, URL titles) renders via text nodes / framework-escaped bindings — **never `innerHTML` of user-supplied strings**.
*   URL blocks render as links with `rel="noopener noreferrer"`; only `http(s):` schemes are linkified, anything else renders as plain text.
*   `url.title` is **manually entered by the user** (optional). The app never fetches remote pages to derive titles — doing so would break offline-first and hit CORS. State this in the capture UI placeholder.
*   Unknown content block types render as a visible placeholder, never dropped silently (unchanged from v2.0).

### F. Verify Library (new)
An on-demand integrity check for the product's target user (someone who, correctly, does not trust silent storage):
*   Confirms every `ref_id` from 1 to `current_seq` either exists or is an explicit tombstone (soft-deleted or purged marker) — any *missing* number is reported loudly, since it implies a lost insight behind a possibly-transcribed reference.
*   Re-reads every image Blob and verifies it decodes; reports undecodable blobs by ref_id.
*   Reports totals (insights, images, bytes) and last export age.
*   Runs off the main thread where possible; read-only; never "repairs" silently.

## 4. Data Schemas

**App-level: `meta`**

| Field | Type | Description |
| :--- | :--- | :--- |
| `schema_version` | Integer | Migration target. Bumped on any store change. |
| `last_export_at` | Datetime | Drives the backup-staleness reminder. |
| `storage_persisted` | Boolean | Result of the last `navigator.storage.persist()` call. |
| `backup_dir_handle` | FileSystemDirectoryHandle? | Remembered backup location (§2.4). Chromium only; null elsewhere. |
| `auto_backup` | `{ enabled: bool, every_n: int }` | §2.4. Default `{true, 25}`. |

**Table/Store: `projects`**

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | Unique project identifier. |
| `name` | String | User-defined project name. |
| `prefix` | String | 1–6 chars, unique among non-archived projects (§3.A.0). |
| `current_seq` | Integer | High-water mark of assigned Reference IDs (starts at 0). **Monotonic: never decreases, never reassigned (D1).** |
| `created_at` | Datetime | |
| `updated_at` | Datetime | Required for future cloud-sync conflict resolution. |
| `archived_at` | Datetime? | Null when active. |

*(`released_ids` removed — D1 resolved as monotonic.)*

**Table/Store: `insights`**

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID | Primary internal key. |
| `project_id` | UUID | Foreign key linking to the project. |
| `ref_id` | Integer | The simple sequential ID (1, 2, 3). Unique per project, forever. |
| `source_tag` | String | The document source name. |
| `content` | Array\<Block\> | Ordered list of typed blocks (see below). |
| `direction` | Enum | `ltr` \| `rtl` \| `auto`. Resolved at capture time. |
| `timestamp` | Datetime | Capture time. |
| `updated_at` | Datetime | Last modification (edit, restore). |
| `deleted_at` | Datetime? | Null when active. Soft-delete marker. |
| `purged` | Boolean | True when content was hard-deleted; row persists as a tombstone so the ref_id stays accounted for (§3.D, §3.F). |

**Content block union (`content` array elements)**

```
{ type: "text",  value: string }
{ type: "image", blob: Blob, mime: string, width: int, height: int, alt?: string }
{ type: "url",   href: string, title?: string }   // title is user-entered, never fetched (§3.E)
```

Renderers, the edit flow, and the PDF exporter all switch on `type`. Unknown block types must render as a visible placeholder, never be dropped silently.

**Indexes**
*   `insights`: compound **unique** index on `[project_id, ref_id]` — plainly unique with no "among non-deleted rows" qualifier, since IndexedDB has no partial indexes and monotonic IDs (D1) make the qualifier unnecessary: a ref_id is assigned exactly once, ever. Plus non-unique `[project_id, source_tag]` and `[project_id, deleted_at]`.
*   ID range queries resolve via `IDBKeyRange` on `[project_id, ref_id]` (§3.B, huge-range row).

## 5. UI/UX & Layout (Theme: "Modern Analyst")
*   **Aesthetic:** Sleek Dark Mode. Slate or deep charcoal backgrounds, clean geometric sans-serif typography, and a low-fatigue accent color (e.g., Electric Blue).
*   **Brand Integration:** The word **"Hakami"** should sit in the top corner as a refined, geometric watermark or brand stamp.
*   **Storage status indicator:** Small, persistent, near the brand stamp — Protected / At risk (§2.2), with Safari-specific install messaging when applicable. Non-intrusive but always visible.
*   **Responsive Layout:**
    *   *Wide Mode (Full/Half Screen Monitor):* Split-screen. Left side displays the retrieved Insights feed. Right side houses the sticky Capture Zone. Optimized for snapping to a large dual-screen workspace while minimizing UI bloat.
    *   *Narrow Mode (Sidebar / Mobile):* Single column stack. The Command Bar and Capture Zone pin to the top; the retrieval feed scrolls vertically below them. Capture affordances within thumb reach (§3.A.2).

### 5.1 Focus & Keyboard Model (new)
Two elements previously both claimed focus; the model is now explicit:
*   **Global paste handler (document-level):** a paste containing an image *always* routes to the Capture Zone, regardless of focus. A paste of plain text routes to whichever input has focus; if none, to the Capture Zone.
*   **Desktop default focus:** Capture Zone (capture is the primary loop). `/` focuses the Command Bar from anywhere (unless typing in an input); `Esc` clears the Command Bar and returns focus to the Capture Zone; `Ctrl+Enter` submits a capture.
*   **Mobile:** **no autofocus anywhere on load** — do not force the keyboard open. Focus follows taps only.
*   **Documented shortcut set** (surfaced via a `?` overlay): `/` search · `Esc` back to capture · `Ctrl+Enter` submit · `Ctrl+E` export project · `Ctrl+P` PDF view. The keyboard-first flow is a deliberate differentiator; keep it discoverable.

## 6. Agent Implementation Plan (Step-by-Step)

Every phase now carries a **Verify** clause. A spec this precise deserves matching verification; "it seems to work" is not an exit criterion for a durability-first product.

*   **Phase 1: Scaffolding, Storage & Portability.** Initialize the web app environment. Set up `IndexedDB` schemas (`meta`, `projects`, `insights`) using `idb` or `Dexie.js`, including `schema_version` and the migration runner. Implement the image pipeline (§2.1: WebP/JPEG policy, EXIF orientation, HEIC handling). Implement `navigator.storage.persist()`, quota monitoring, and the frictionless backup paths (§2.4). **Build Export/Import — all three modes — in this phase**; no subsequent phase should accumulate real data without a way to get it out.
    *   **Verify:** export → import-as-new-project → export produces byte-equivalent insight data (round-trip equality test, including checksums in zip mode). EXIF-rotated fixture images render upright after the pipeline. Simulated `QuotaExceededError` surfaces a visible error.
*   **Phase 1.5: Migration (only if D2(a) is chosen).** Read the existing SQLite Insight Journal export, map to the new schema preserving `ref_id` and `source_tag`, assign a prefix to the migrated project, and run as a one-off import path, not a permanent feature.
    *   **Verify:** every `(ref_id, source_tag)` pair in the source round-trips exactly (this is the achievable criterion — see D2 note in §0). Post-migration, run Verify Library (§3.F) and require zero missing refs.
*   **Phase 2: Capture Engine.** Capture Zone, sticky Source logic, global paste routing (§5.1), transactional sequential ID generator per project, prefixed-ID success display, Quick Edit semantics, RTL/direction handling, mobile capture inputs (§3.A.2 camera; `share_target` wiring lands with Phase 6's manifest).
    *   **Verify:** a test that aborts the transaction between seq-increment and insert confirms no ref_id is burned or duplicated. Concurrent double-submit produces two distinct sequential IDs. Direction resolution correct for Arabic, Latin, and mixed fixtures.
*   **Phase 3: Retrieval Logic.** Command Bar, ID parser, prefixed-query routing, text-search fallback with the defined scope (§3.B), default feed state.
    *   **Verify:** unit tests covering **every row of the §B edge-case table**, including the huge-range clamp (assert key-range query, no enumeration). Text search finds matches in alt text and URL titles.
*   **Phase 4: UI/UX & Dark Mode.** "Modern Analyst" theme, responsive grid, storage status indicator with Safari messaging, "Hakami" stamp, keyboard model and `?` shortcut overlay.
    *   **Verify:** no-autofocus-on-mobile confirmed; paste-routes-to-capture confirmed with search focused.
*   **Phase 5: Delete/Archive, PDF & Verify Library.** Soft-delete, restore, purge-with-tombstone, archived projects, the browser-print PDF pipeline (§C) with chunked DOM build and embedded Arabic font, and the Verify Library check (§3.F).
    *   **Verify:** purged ref_id retrieval shows the explicit message; `current_seq` unchanged after purge. Print output manually checked in Chromium + Firefox + Safari for page-break behaviour and Arabic rendering. Verify Library detects a deliberately corrupted fixture blob.
*   **Phase 6: PWA.** Manifest (including `share_target`), service worker (app shell only), install prompt (aggressive on iOS per §2.2), offline verification.
    *   **Verify:** full loop — capture, retrieve, export, PDF — completed with the network disabled. Android share-a-screenshot → capture flow works end to end. Stale-shell test: SW update against a bumped `schema_version` does not serve the old shell.

## 7. Future Opportunities (non-blocking)
*   **Background OCR (Tesseract.js, Arabic-capable):** lazily OCR image blocks off the main thread and store extracted text as a searchable sidecar field — the single highest-leverage future feature for a screenshot-heavy library, and fully local-first. Design note now: keep an `ocr_text?: string` slot in mind on the image block; do not build in v1.
*   **Cloud Sync toggle** (already anticipated via `updated_at` / `schema_version`).
*   **Notebook manifest:** an optional lightweight log of "IDs I actually transcribed," which would make future migrations verifiable against physical reality (closing the D2(a) verification gap for good).
