# Phase 1.5 — Legacy Insight Journal migration (STUB, blocked on D2)

PRD v2.1 decision **D2 is open**: replacement (a) vs parallel tool (b). Per the build
contract, everything else is built and nothing here precludes D2(a).

## Where the one-off import path attaches when D2 resolves as (a)

1. **Input:** an export of the legacy SQLite Insight Journal (SQL dump or CSV of
   `(ref_id, source_tag, content, created_at)` rows).
2. **Mapping:** parse → build a `ParsedImport` (see `src/backup/importer.ts`) with
   every `ref_id` and `source_tag` preserved byte-exactly; assign the migrated
   project a prefix at import time (PRD §6 Phase 1.5).
3. **Write path:** reuse `importAsNewProject()` — it already preserves `ref_id`s,
   refuses prefix collisions, and is transactional all-or-nothing. No new storage
   code is needed; only the SQLite→ParsedImport parser is missing.
4. **Verification:** round-trip every `(ref_id, source_tag)` pair (export the migrated
   project and diff against the source rows), then run Verify Library
   (`src/verify/verifyLibrary.ts`) and require zero missing refs — the achievable
   criterion per the D2 note in PRD §0.
5. **Delivery:** a one-off dev-mode route or script, not a permanent feature.

Nothing in the current schema blocks this: `ref_id` is a plain integer, prefixes are
metadata-only (§3.A.0), and the unique `[project_id, ref_id]` index accepts arbitrary
preserved IDs (monotonic D1 semantics hold because `current_seq` is set to
`max(ref_id)` on import).
