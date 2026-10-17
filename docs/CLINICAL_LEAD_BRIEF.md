# Clinical Lead Brief — Dr. Wiki Milczyńska

**Rare Disease Detective · Recursive Agents Hackathon · October 17, 2026**

This is your working document for the day. It pulls out everything the engineering side needs from you, in the order it's needed, with the exact file formats. The full product spec is in [PRD.md](PRD.md); you don't need to read it all.

**The one thing to know about the system:** it is not a diagnosis generator. A Lead Agent reads the case, decides what it is uncertain about, and spawns child agents to investigate specific questions. A Verifier then accepts or rejects each claim based on evidence. Your job is to make sure the cases are clinically real, the agents are asking the right questions, and the verifier is rejecting the right things.

**The case list is already decided.** The ten slots and what each one tests are fixed in [PRD §3](PRD.md#3-clinical-scope--10-case-dataset). You don't need to choose cases. **Synthetic first drafts of all ten cases and their reference answers are already written** (see [cases/README.md](../cases/README.md)). Your job is to **review and correct them**, not write from scratch. Edit the JSON directly, or leave notes in each reference file's `clinician_review_notes` field and Holly will apply them.

---

## 1. What you own

| Deliverable | Needed by (PT) | Blocks |
|---|---|---|
| **A. Review hero case JSON** (Case 01, guitarist DRD) | **10:30 AM** | First real investigation runs on this. |
| **B. Review hero reference answer** (`cases/reference/01_guitarist_drd.json`) | 11:00 AM | Verifier calibration, evaluation |
| **C. Movement-disorder reasoning rules** | 11:30 AM | Lead Agent prompt |
| **D. Verifier acceptance checklist** | 12:30 PM | Verifier prompt |
| **E. Review of first investigation traces** | 1–3 PM | Prompt corrections before UI work |
| **F. Review three validation cases** (02, 04, 08) | 5 PM | P1 demo cases |
| **G. Skim remaining six drafts** (03, 05, 06, 07, 09, 10) | 7 PM | Ten-fixture target; stubs are fine |
| **H. Review hero movement annotations + video source** | 5 PM | Motion Viewer |
| **I. Clinical sign-off on demo report + safety language** | 9 PM | Submission |

Priority order if time runs short: **A → B → D → C → E → H → F → I → G.** Item A is the only hard blocker. Everything else can be rough and iterated.

---

## 2. Deliverable A: Hero case JSON

**Case 01 — Guitarist with dopa-responsive dystonia.**

File: `cases/01_guitarist_drd/case.json` (draft written). Check it against the points below and correct anything that isn't clinically right. Specific questions are in `clinician_review_notes` in the reference file.

What the agents will see. **Do not include the diagnosis, the levodopa response, or any finding that gives it away.** Those go in the reference file (Deliverable B).

Required sections:

- **demographics**: age, sex, handedness, occupation (musician matters here)
- **chief_complaint**: in the patient's words or close to it
- **history_of_present_illness**: onset, progression, what makes it better/worse, diurnal pattern if present. Diurnal fluctuation is the classic DRD clue. **Decide deliberately whether to include it or leave it as something the agent should ask about.** For the hero demo, I suggest including a subtle mention (e.g. "worse by evening rehearsals") rather than stating "diurnal fluctuation" outright, so the agent has to recognize it.
- **symptom_timeline**: array of dated or relative-time events
- **movement_findings**: physician-reviewed observations of the hand/arm movement. These are what the Motion Viewer will show alongside the video. Be specific: which fingers, which task, sustained vs. intermittent, task-specific or not, tremor vs. dystonic posturing, overflow, sensory trick.
- **neurological_exam**: tone, reflexes, gait, bradykinesia screen, cerebellar signs, cognition. Normal findings are informative and should be listed.
- **labs**: what was done and results. Include normals.
- **imaging**: MRI brain report text (should be normal or nonspecific for DRD). DAT-SPECT report if the case includes one (normal DAT-SPECT is a key DRD vs. young-onset PD discriminator; decide whether it's given or something the agent should request).
- **medications**: current and prior, with response if known. **Do not include levodopa trial here** unless you want the case to be post-trial.
- **family_history**: relevant or explicitly negative
- **prior_workup_and_opinions**: what other clinicians considered, if any

Clinical realism matters more than completeness. If a real patient wouldn't have had a DAT scan yet, leave it out and let the agent ask for it.

**Source:** Synthetic, or adapted from a published de-identified case report whose license permits reuse. Put the citation in `provenance`, or mark it synthetic. No real patient data of any kind.

---

## 3. Deliverable B: Reference answer (held out)

File: `cases/reference/01_guitarist_drd.json` (draft written). It's in the repo so you can review it; the code never passes it to agents. Contents:

- **reference_diagnosis**: the answer, with confidence (confirmed / probable / working)
- **acceptable_top5**: other diagnoses that would be reasonable in a Top 5 for this presentation (e.g. young-onset PD, focal task-specific dystonia / musician's dystonia, Wilson disease, psychogenic/functional). We score "reference in Top 5" so this list defines what counts as a miss.
- **competing_hypotheses**: for each, one line on why it's plausible and one line on what rules it out or down. This is what the Verifier compares agent reasoning against.
- **key_evidence_gaps**: the 3–6 things a good clinician would want to know that are NOT in the case JSON. Example: "Has a levodopa trial been done?", "Is there diurnal fluctuation?", "DAT-SPECT result?", "GCH1 genetic testing?", "CSF neurotransmitter metabolites?". The agent should be asking for these. If it doesn't, that's a prompt problem.
- **held_out_evidence**: the actual answers to those gaps. The test harness can release these to the agent one at a time to simulate "ordering" an investigation.
- **discriminating_investigations**: what a physician should do next, ranked. The Clinical Report is scored on whether it suggests these.
- **red_flags_for_wrong_reasoning**: things that, if an agent says them, the Verifier should reject. Example: "Diagnosing DRD from MRI alone", "Treating normal MRI as evidence against DRD", "Confusing task-specific dystonia with DRD without considering diurnal pattern or levodopa response."

---

## 4. Deliverable C: Movement-disorder reasoning rules

File: `docs/clinical/reasoning_rules.md`. Plain prose or bullets. Goes into the Lead Agent system prompt.

What we need is how a movement-disorder specialist actually thinks, written so a model can follow it. Roughly 20–40 lines. Suggested structure:

1. **Phenomenology first.** Classify the movement (dystonia / tremor / chorea / myoclonus / ataxia / tics / parkinsonism / functional) before any etiology. What features define each.
2. **Pattern features that narrow the differential.** Age of onset, distribution (focal / segmental / generalized), task-specificity, diurnal variation, episodic vs. continuous, triggers (movement-induced, exercise, fasting, stress), response to sleep, sensory tricks.
3. **When to suspect a rare treatable cause.** The "don't miss" list: DRD, Wilson, GLUT1, EA1/EA2, PKD. For each, the 1–2 features that should trigger consideration and the confirmatory test.
4. **Anchoring traps.** Functional movement disorder is a positive diagnosis with its own signs, not a diagnosis of exclusion. Rare-disease enthusiasm shouldn't override a common explanation. Normal imaging doesn't exclude most of these.
5. **Investigation hierarchy.** What is cheap/fast/safe to do first (history clarification, exam features, levodopa trial) vs. expensive/slow (genetics, CSF). The agent should prefer discriminating and feasible next steps.

Write this the way you'd teach a resident. Holly will adapt the wording for the prompt.

---

## 5. Deliverable D: Verifier acceptance checklist

File: `docs/clinical/verifier_checklist.md`. Goes into the Verifier system prompt.

The Verifier reads each child agent's findings and returns one of **ACCEPT / REVISE / INSUFFICIENT**. It needs rules for each. Suggested content:

**ACCEPT only if all of:**
- The claim cites a specific case finding or a retrieved literature passage (not "it is known that…")
- The cited source actually supports the claim (the verifier sees the passage text)
- The claim doesn't contradict a case finding
- Confidence language matches evidence strength (no "confirms" on a single case report)

**REVISE if:**
- Right direction but overclaimed, or cites a source that's tangential
- Ignores a contradicting finding that's in the case
- Proposes a next step that's unsafe, unavailable, or not discriminating

**INSUFFICIENT if:**
- No source, or source doesn't exist / can't be retrieved
- Diagnosis asserted from a single nonspecific feature
- Hallucinated case facts (states something not in the case JSON)

Plus the **clinical red lines** from Deliverable B generalized across cases: things that should always be rejected regardless of case (e.g. recommending treatment, stating a diagnosis as established, dismissing functional disorder without positive-sign reasoning).

5–15 rules. Be concrete. The verifier is a 120B model; it can follow nuance, but it can't read your mind.

---

## 6. Deliverable E: Reviewing investigation traces (1–3 PM)

Holly will hand you raw agent output: the tree of what the Lead decided to investigate, what each child found, and what the Verifier said. Review for:

- **Did the Lead ask the right questions?** If it went straight to "it's DRD" without investigating alternatives, the prompt needs tightening. If it spawned 12 children on irrelevant branches, scope needs tightening.
- **Did any child say something clinically wrong?** Flag it with the node ID. We'll check whether the verifier caught it.
- **Did the verifier reject correctly?** False accepts are worse than false rejects for the demo.
- **Is the literature real and relevant?** Spot-check 3–5 citations.
- **Is the safety language right?** Report should read as "for physician review," never as a diagnosis.

Give feedback as a short list: node ID → what's wrong → what it should have done. Holly will adjust prompts and rerun.

---

## 7. Deliverables F and G: Validation cases and stubs

The slots are fixed by the PRD. Same JSON format as the hero case, same reference-file split.

**Recommended three for full review (F):**

| Case | Why this one |
|---|---|
| **02 Classic pediatric DRD** | Shows the system handles the textbook version; good contrast with the atypical adult hero |
| **04 Episodic Ataxia Type 2** | Episodic symptoms force the agent to reason about triggers and interictal exam; EA1 vs. EA2 is a real discrimination problem |
| **08 Functional Movement Disorder** | The anti-anchoring test. Must include positive functional signs (distractibility, entrainment, variability, suggestibility). If the system calls this DRD, we have a problem and want to know |

**Stubs (G):** For 03, 05, 06, 07, 09, 10, a case JSON with the core sections filled at the level of a good exam vignette is enough. Reference file with just `reference_diagnosis` and `acceptable_top5`. Case 10 (synthetic contradictory) needs one deliberate internal contradiction added if the source doesn't already have one, e.g. history says symptoms are worse in the morning but the timeline says evening. The agent should notice and flag it rather than pick one silently.

---

## 8. Deliverable H: Hero case movement annotations

File: `cases/01_guitarist_drd/annotations.json`. Template in `cases/_template/annotations.json`.

For the movement video, a list of timestamped observations:

```json
{ "t_start": 4.2, "t_end": 9.8, "label": "Dystonic flexion of digits 3–4 during chord formation", "finding_id": "mf_02" }
```

`finding_id` links to an entry in `case.json` → `movement_findings`, so clicking the annotation in the viewer highlights the related evidence. 4–8 annotations is plenty.

**Video reuse:** confirm the clip's license allows us to show it in a demo. If it doesn't, we show the annotations against a still or a placeholder and say so.

---

## 9. Deliverable I: Sign-off (7–9 PM)

Read the final Clinical Report the system produces for Case 01. Check:

- Differential is reasonable and reference diagnosis is in the top 5
- Every supporting claim has a source you'd accept
- Unresolved questions are the right ones
- Suggested next investigations are feasible and discriminating
- Nothing reads as a diagnosis or treatment instruction
- Safety disclaimer is present and correct

Then be ready for Q&A. Likely judge questions: "How do you know the agent isn't hallucinating?", "What happens when the literature is wrong?", "Would you use this?" Your honest answer to the last one is more valuable than a polished one.

---

## 10. Ground rules

- **No PHI, ever.** Synthetic or properly licensed de-identified cases only. If in doubt, make it synthetic.
- **Reference answers never go in `case.json`.** Only in `cases/reference/`, which git ignores.
- **Normal findings are data.** Include them.
- **Don't make cases easy.** The demo is more convincing when the agent has to work for it.
- **Rough and early beats polished and late.** Send the hero case at 10:30 even if sections are thin; we iterate.

## 11. Working with the repo

You have write access. Clone:

```bash
git clone https://github.com/tangxiya-star/rare-disease-detective.git
```

Edit files, then:

```bash
git add cases/ docs/clinical/
git commit -m "Add hero case"
git push
```

If git is friction, just send the JSON files to Holly directly and she'll commit them. The repo is private, and `cases/reference/` is committed so you can review it. Don't paste reference answers into public channels.
