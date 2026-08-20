# Insightyyy — Documentation

Last updated: **2026-08-15** · App version 0.1.0 · Test suite: **76 passing**

Insightyyy is a local-first PWA that bridges physical handwritten notebooks with
digital source material. The user captures something digital, the app assigns a
prefixed sequential reference (`Q3-42`), the user handwrites that reference in a
notebook, and typing it back retrieves the source — forever. **Durability outranks
every other concern**: a handwritten pointer can never be updated, so the app must
never lose, renumber, or silently re-point a reference.

## Reading order for a new maintainer

| Doc | What it gives you | Read when |
| --- | --- | --- |
| [PRD_v2.1.md](PRD_v2.1.md) | The product spec — the contract every line of code answers to. Its §1 durability constraint and §0 decisions (D1/D2) explain *why* the code is shaped the way it is. | First, at least §0–§1 and §6 |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | Section-by-section status of the PRD: what is built, how each phase's verify gate was proven, deviations, and features added after v1. | Second — tells you where reality stands vs. the spec |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The codebase map: data model, module responsibilities, the five critical flows (capture, retrieval, export/import, PDF, service worker), invariants, and the hard-won gotchas. | Before touching code |
| [HANDOVER.md](HANDOVER.md) | Operations: setup, scripts, testing conventions, deployment to shared hosting, the update ritual, open decisions, and future work. | Before shipping anything |

## The one rule

If a change could cause a reference ID to be lost, reused, renumbered, or silently
resolved to the wrong content, it is wrong — even if every test passes. Re-read PRD §1
and the "Non-negotiable invariants" list in IMPLEMENTATION_STATUS.md before merging
anything that touches capture, delete/purge, import, or the ID parser.
