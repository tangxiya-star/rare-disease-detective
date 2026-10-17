# Case fixtures

Ten cases, one per slot in [PRD §3](../docs/PRD.md#3-clinical-scope--10-case-dataset). **All ten are synthetic first drafts written on 2026-10-17 and need Dr. Wiki Milczyńska's review before use.**

## Layout

```
cases/
  01_guitarist_drd/
    case.json          agent-visible input
    annotations.json   movement-video annotations (hero case only)
  02_pediatric_drd/case.json
  ...
  reference/
    01_guitarist_drd.json   HELD OUT: answer, competing hypotheses, gaps, held-out results, red flags
    ...
  _template/                blank templates
```

## Held-out rule (enforced in code, not by git)

The repo is private and both team members need to read the references, so `reference/` is committed. Agents must never see it:

- The case loader reads **only** `case.json` and passes nothing else to any model.
- Folder names contain diagnoses. Agents only ever see the opaque `case_id` inside `case.json` (e.g. `case_01`).
- Held-out results in `reference/*.json` → `held_out_evidence` are released by the test harness one at a time, only when an agent requests the matching investigation.

## Review status

| # | Case | Purpose | Draft depth | Wiki review |
|---|---|---|---|---|
| 01 | Guitarist, adult-onset DRD | **Hero demo** | Full + annotations | ☐ |
| 02 | Classic pediatric DRD | Typical phenotype | Full | ☐ |
| 03 | Atypical DRD (parkinsonism phenotype) | Missing classical clues | Moderate | ☐ |
| 04 | Episodic ataxia type 2 | Episodic symptoms | Full | ☐ |
| 05 | Episodic ataxia type 1 | Competing hypothesis vs. PKD | Moderate | ☐ |
| 06 | Paroxysmal kinesigenic dyskinesia | Trigger-based reasoning | Moderate | ☐ |
| 07 | GLUT1 deficiency | Metabolic link | Moderate | ☐ |
| 08 | Functional movement disorder | Anti-anchoring (DRD bait) | Full | ☐ |
| 09 | Idiopathic writer's cramp | "No rare disease found" outcome | Moderate | ☐ |
| 10 | Contradictory records (underlying Wilson) | Verification + replanning | Full | ☐ |

Deliberate traps are documented in each reference file under `red_flags_for_wrong_reasoning`. Cases 08 and 10 intentionally mention DRD in agent-visible text as anchoring bait.

## Not yet done

- **Hero video:** no clip sourced. `annotations.json` has planned shots with placeholder timestamps. Any reenactment must be disclosed as one in the demo.
- **Citations:** drafts are synthetic and cite no papers. Literature comes from the agents' retrieval at runtime, not from the case files.

## Freezing references before scoring

References are committed, so git history is the seal. Before the first scored run, tag the commit:

```bash
git tag refs-frozen && git push origin refs-frozen
```

Any later edit to `reference/` shows up in `git diff refs-frozen -- cases/reference/`. If a reference must change after that, note why and re-run every case.

Synthetic only. No PHI.
