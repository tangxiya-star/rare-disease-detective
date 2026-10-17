# Case fixtures

Ten case specifications per the PRD (§3). Source cases (already collected by Holly) live in `sources/`; the structured fixtures below are converted from them. Each case lives in `cases/<nn>_<slug>/`:

- `case.json` — agent-visible input: history, timeline, physician-reviewed movement findings, exam, labs, imaging reports, meds, family history
- `annotations.json` — clinician-reviewed movement annotations (hero case)

**Reference diagnoses and held-out evidence are NOT stored here.** They go in `cases/reference/` (gitignored) and are only exposed through the test harness.

Synthetic or appropriately licensed de-identified cases only. No PHI.
