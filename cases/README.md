# Case fixtures

Ten cases, one per slot in [PRD §3](../docs/PRD.md#3-clinical-scope--10-case-dataset). **Case 01 is adapted from a published, openly licensed case report; the other nine are synthetic. All ten are drafts written on 2026-10-17 and need Dr. Wiki Milczyńska's review before use.**

## Layout

```
cases/
  01_guitarist_drd/
    case.json          agent-visible input
    annotations.json   movement-video annotations (hero case only)
    movement.mov       agent-visible clip (local only, gitignored)
  02_pediatric_drd/case.json
  ...
  reference/
    01_guitarist_drd.json   HELD OUT: answer, competing hypotheses, gaps, held-out results, red flags
    ...
    media/                  HELD OUT media (e.g. case 01 post-levodopa clip)
  _alt/01_guitarist_drd_synthetic/   scored version of slot 01 (synthetic, with clinical review)
  manifest.json             which files are loaded for scored runs vs. the demo
  _template/                blank templates
```

## Scored vs. demo

Two run types, listed in [`manifest.json`](manifest.json):

- **Scored runs** (evaluation, baseline comparison) use ten synthetic cases. Slot 01 is the synthetic guitarist in `_alt/01_guitarist_drd_synthetic/`.
- **The demo** uses the published guitarist case in `01_guitarist_drd/`, with the real clinical video. It is **not scored**: the model may have memorised the 2021 article, and retrieval could find it and read the diagnosis from its title. Block the DOIs in `manifest.json` → `retrieval_blocklist` during the demo run.

Folder names do not decide what is loaded; the manifest does.

## Held-out rule (enforced in code, not by git)

The repo is private and both team members need to read the references, so `reference/` is committed. Agents must never see it:

- The case loader reads **only** `case.json` and passes nothing else to any model.
- Folder names contain diagnoses. Agents only ever see the opaque `case_id` inside `case.json` (e.g. `case_01`).
- Held-out results in `reference/*.json` → `held_out_evidence` are released by the test harness one at a time, only when an agent requests the matching investigation.

## Review status

| # | Case | Purpose | Draft depth | Wiki review |
|---|---|---|---|---|
| 01 | Guitarist, adult-onset DRD (adapted from Hasegawa et al. 2021) | **Hero demo, not scored** | Full + annotations | ☐ |
| 01s | Guitarist, adult-onset DRD (synthetic, `_alt/`) | **Scored slot 01** | Full | partly (reference reviewed in #1) |
| 02 | Classic pediatric DRD | Typical phenotype | Full | ☐ |
| 03 | Atypical DRD (parkinsonism phenotype) | Missing classical clues | Full | ☐ |
| 04 | Episodic ataxia type 2 | Episodic symptoms | Full | ☐ |
| 05 | Episodic ataxia type 1 | Competing hypothesis vs. PKD | Full | ☐ |
| 06 | Paroxysmal kinesigenic dyskinesia | Trigger-based reasoning | Full | ☐ |
| 07 | GLUT1 deficiency | Metabolic link | Full | ☐ |
| 08 | Functional movement disorder | Anti-anchoring (DRD bait) | Full | ☐ |
| 09 | Idiopathic writer's cramp | "No rare disease found" outcome | Full | ☐ |
| 10 | Contradictory records (underlying Wilson) | Verification + replanning | Full | ☐ |

Deliberate traps are documented in each reference file under `red_flags_for_wrong_reasoning`. Cases 08 and 10 intentionally mention DRD in agent-visible text as anchoring bait.

## Not yet done

- **Hero video:** local only (`*.mov` is gitignored; S1 11.2 s, S2 8.6 s). Each teammate downloads it once. Source: Hasegawa T (2021), Dryad [doi:10.5061/dryad.pzgmsbckd](https://doi.org/10.5061/dryad.pzgmsbckd), CC0; Dryad blocks scripted downloads, so fetch in a browser. `Suppl_Video_S1.mov` → `cases/01_guitarist_drd/movement.mov` (agent-visible). `Suppl_Video_S2.mov` → `cases/reference/media/01_S2_post_levodopa.mov` (held out, released with the levodopa trial). Annotation timestamps set from frame review; Wiki to confirm labels. Credit the authors on screen.
- **Case 01 and scoring:** published cases may be memorised, and retrieval can find the source article. Open decision: keep case 01 demo-only (not scored) and/or block its DOI from retrieval.
- **Citations:** case 01 cites its source in its reference file (not in `case.json`, since the title names the diagnosis); the synthetic drafts cite no papers. Literature comes from the agents' retrieval at runtime, not from the case files.

## Freezing references before scoring

References are committed, so git history is the seal. Before the first scored run, tag the commit:

```bash
git tag refs-frozen && git push origin refs-frozen
```

Any later edit to `reference/` shows up in `git diff refs-frozen -- cases/reference/`. If a reference must change after that, note why and re-run every case.

Synthetic only. No PHI.
