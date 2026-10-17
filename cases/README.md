# Case fixtures

Ten case specifications per the PRD (§3). Each case lives in `cases/<nn>_<slug>/`:

- `case.json` — agent-visible input: history, timeline, physician-reviewed movement findings, exam, labs, imaging reports, meds, family history
- `annotations.json` — clinician-reviewed movement annotations (hero case)

**Reference diagnoses and held-out evidence are NOT stored here.** They go in `cases/reference/` (gitignored) and are only exposed through the test harness.

Synthetic or appropriately licensed de-identified cases only. No PHI.

**Sealing:** before the first scored run, record a sha256 hash of each file in `cases/reference/` in `cases/REFERENCE_HASHES.txt` and commit that file. Reference files are revealed at the demo so anyone can check they match.

```bash
shasum -a 256 cases/reference/*.json > cases/REFERENCE_HASHES.txt
```
