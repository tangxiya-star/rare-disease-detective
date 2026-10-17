# Rare Disease Detective — PRD v4.1

**Recursive Agents Hackathon · Cerebral Valley × Crusoe · October 17, 2026**

## 0. Hackathon fit (read first, updated 12:50 PT)

**Deadline: submissions are due at 5:00 PM PT, not 10 PM.** First-round judging is 5:00 to 6:45 PM (about 3 min live demo plus 1 to 2 min Q&A). Final round 7:00 to 8:00 PM for the top six.

**Track: "Done Means Done."** The organisers ask for an agent team that writes its own definition of done, checks its work with tests or independent verifier agents, catches itself drifting or looping, and decides whether to continue, re-plan, stop, or (rarely) ping a human. That is our product. **The clinical cases are the test bed, not the product.**

| Track asks for | We provide |
|---|---|
| Agents write their own definition of done | **New P0:** the lead turns the one-line goal into a done-checklist at run start; code checks it before the report (§6) |
| Checks via tests or independent verifiers | Code-level grounding (C1 to C4) plus the verifier agent with rule ids |
| Catches drifting or looping | Duplicate-task validator, node budget, **new** loop guard (§6) |
| Continue, re-plan, stop, or ping a human | Replanning on REVISE; INSUFFICIENT recorded as unresolved; **new** "needs clinician input" stop (case 10's contradictory records) |
| Walk away | Unattended evaluation runs across cases and arms (§7) |

**Rules that bind us**
- **Repository must be public** at submission. Make it public before 4:30 PM. Reference answers become visible; that is acceptable, since agents never load them.
- **1-minute demo video** is required in the submission form, showing only what we built today.
- **New work only, clearly identified.** Case 01 and its videos come from Hasegawa et al. 2021 (CC BY 4.0 / CC0): credit them on screen and in the README. Everything else was written today.
- **Banned: "any project using AI to generate and give medical advice." Cleared with the organisers (17 Oct):** the rule targets ungrounded "AI doctor" projects from non-clinical teams; ours is led by a doctor and is fine. **Condition: present it as human-in-the-loop.** The agents investigate and verify; the clinician decides. It gives no advice to patients and no diagnosis or treatment decision, and every output is "for physician review". Say this in the first 20 seconds of every demo and show the "needs clinician input" stop.
- **Banned: a dashboard as the main feature.** The agent tree is the product; the scorecard is one slide.

**Judging weights (round one):** Technicality 40%, Creativity 25%, Live demo 20%, Future potential 15%. Lead with the hard engineering.

**Prize to target:** Best Use of Nemotron (Super plans and verifies, Nano investigates).

## One-liner

An agent team that knows when it is done: given a one-line goal, it writes its own definition of done, recursively investigates, verifies every claim in code and with an independent verifier, and stops, re-plans, or asks a human instead of confidently reporting success. Test bed: hard rare neurological movement-disorder cases, for physician review.

| | |
|---|---|
| **Target User** | Physicians / Neurologists |
| **Build Time** | 13 hours |
| **Product & Engineering** | Holly |
| **Clinical Lead** | Dr. Wiki Milczyńska |

---

## 1. Problem Statement

Rare neurological movement disorders are often difficult to identify because symptoms overlap with more common conditions, presentations vary, and critical clues may be scattered across clinical histories, movement observations, imaging, laboratory results, and literature.

Existing AI systems can suggest differential diagnoses. However, generating a diagnosis list is not the same as independently investigating competing hypotheses, identifying contradictions, verifying evidence, and determining what to investigate next.

**Our solution:** A physician-facing autonomous investigation workspace where agents dynamically delegate research, recursively explore unanswered clinical questions, challenge their conclusions, and recover from failures.

The system supports clinical investigation. It does not replace physician judgment or establish a diagnosis.

## 2. Sponsor Integration

| Sponsor | Technology | Implementation |
|---|---|---|
| Crusoe | Managed Inference | All runtime LLM inference |
| NVIDIA | Nemotron 3 Super 120B | Lead Agent, replanning, verification |
| NVIDIA | Nemotron 3 Nano 30B | Dynamically spawned investigation agents |
| You.com | Search API | Medical literature research, if access confirmed |

**Inference endpoint:** `https://api.inference.crusoecloud.com/v1`

**Models:**
- Lead / Verifier: `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B`
- Child agents: `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`

The OpenAI Python SDK is used solely as an API client pointed at Crusoe. No Claude or OpenAI-hosted models at application runtime.

If You.com access is unavailable, use Europe PMC / PubMed or a prevalidated literature corpus.

## 3. Clinical Scope & 10-Case Dataset

**Scope:** Rare and atypical neurological movement disorders, including important non-rare differential diagnoses.

**Input:** Clinical history, symptom timeline, physician-reviewed movement findings, neurological examination, labs, MRI/SPECT reports, medication and family history.

**Output:** Prioritized differential for clinician review, supporting/contradicting evidence, traceable literature, unresolved questions, and potentially discriminating investigations.

| # | Case | Primary test |
|---|---|---|
| 01 | Guitarist — Dopa-Responsive Dystonia | Hero demo, hand motion, MRI/SPECT. Demo uses a published case with its clinical video (not scored); scoring uses a synthetic version. See `cases/manifest.json`. |
| 02 | Classic Pediatric DRD | Typical phenotype |
| 03 | Atypical DRD | Missing classical clues |
| 04 | Episodic Ataxia Type 2 | Episodic motor symptoms |
| 05 | Episodic Ataxia Type 1 | Competing hypothesis |
| 06 | Paroxysmal Kinesigenic Dyskinesia | Trigger-based investigation |
| 07 | GLUT1 Deficiency | Metabolic-neurological connection |
| 08 | Functional Movement Disorder | Avoid rare-disease anchoring |
| 09 | Nonspecific Focal Dystonia | Unresolved outcome |
| 10 | Synthetic Contradictory Case | Verification and replanning |

**Data policy:** These are ten case specifications, not ten verified records. Use appropriately licensed public de-identified cases or Wiki-reviewed synthetic cases. Reference diagnoses and held-out evidence must remain inaccessible to agents until permitted by the test harness.

**Target:** Ten standardized fixtures, four clinically reviewed cases, one fully polished hero demo. Ten cases are not enough to establish clinical diagnostic accuracy.

## 4. Frontend & Visual Experience

**Stack:** React, TypeScript, Vite, Tailwind CSS, React Flow, WebSocket, MediaPipe Hand Landmarker.

Three core visual modules:

- **Motion Viewer** — Clinical movement video with optional hand landmarks.
- **Recursive Agent Tree** — Real-time spawning, investigation, verification, and recovery.
- **Clinical Evidence Graph** — Connections between findings, hypotheses, and sources.

### UI Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ RARE DISEASE DETECTIVE      CASE 01       ● Investigating       │
├──────────────────────┬────────────────────────┬──────────────────┤
│ PATIENT & MOTION     │ RECURSIVE AGENT CANVAS │ EVIDENCE         │
│                      │                        │ INSPECTOR        │
│ ┌──────────────────┐ │  Runtime-generated     │                  │
│ │ Movement Video   │ │  investigation tree    │ Hypothesis       │
│ │ + Hand Landmarks │ │                        │                  │
│ └──────────────────┘ │  ● Working             │ Supporting       │
│                      │  ↻ Retrying            │ Contradicting    │
│ Symptoms / Timeline  │  ✓ Verified            │ Missing Evidence │
│ Neurological Exam    │                        │ Source Links     │
│ MRI / SPECT Viewer   │  Zoom / Pan / Select   │ Verifier Decision│
├──────────────────────┴────────────────────────┴──────────────────┤
│ TABS:  Evidence Graph  |  Agent Events  |  Clinical Report       │
└──────────────────────────────────────────────────────────────────┘
```

### Motion Viewer Requirements

- Display the hero case's original clinical movement video, subject to its reuse permissions.
- Provide play, pause, scrub, and synchronized timestamps.
- Optionally overlay MediaPipe's 21 hand landmarks, subject to tracking quality.
- Link physician-reviewed movement observations to evidence nodes.
- Support comparison of existing documented movement clips, if available.

**Safety boundary:** MediaPipe extracts motion coordinates; it does not establish a neurological diagnosis. Clinical interpretations come from case records and Wiki's review.

**MVP fallback:** Original movement video with clinician-reviewed annotations, without automated landmark tracking.

## 5. Backend Architecture

**Stack:** Python 3.11+, FastAPI, Asyncio, OpenAI SDK configured for Crusoe, Pydantic, SQLite, HTTPX, WebSocket.

```
React Frontend
  Case selection · Motion · Agent Tree
        │
        ▼
FastAPI + Python Orchestrator
  Task scheduling · Spawn validation · Retry · Completion
        │
   ┌────┴────────────────┐
   ▼                     ▼
Nemotron Super       Nemotron Nano
Plan / Verify        Investigate / Research
   │                     │
   ▼                     ▼
SQLite               Literature Search
Nodes · Evidence     You.com / Europe PMC
Checkpoints
```

**Core division of responsibility:**
- **LLM:** Decides whether additional investigation is required, what to investigate, and whether to delegate.
- **Python:** Validates decisions, creates executable tasks, enforces clinical scope and resource limits.
- **SQLite:** Persists state, evidence, parent-child relationships, and checkpoints.
- **WebSocket:** Streams committed execution events to the UI.

### Minimum Node Schema

```json
{
  "id": "node_12",
  "parent_id": "node_04",
  "depth": 2,
  "role": "investigator",
  "objective": "Investigate an evidence gap",
  "status": "running",
  "hypothesis": null,
  "evidence_ids": [],
  "source_ids": [],
  "verification": "pending",
  "retry_count": 0,
  "checkpoint": "research_started"
}
```

Every node also belongs to a run and retains durable timestamps, execution attempts, and a current artifact reference.

## 6. Runtime-Driven Recursive Agents

**Mandatory P0 Requirement:** The model decides at runtime WHETHER to spawn, WHAT to investigate, and HOW MANY children to request. The actual investigation tree must never be hardcoded.

The system defines reusable agent capabilities and execution constraints, not a predefined sequence of hypotheses or specialist branches.

### Runtime Architecture

```
┌──────────────────────────────────┐
│        PHYSICIAN CASE            │
└────────────────┬─────────────────┘
                 ▼
┌──────────────────────────────────┐
│      LEAD AGENT · SUPER          │
│                                  │
│ Analyze → Identify uncertainty   │
│         → Plan                   │
│                                  │
│ LLM DECISION AT RUNTIME:         │
│ Spawn children or return result? │
└────────────────┬─────────────────┘
                 │
          Spawn requested?
                 │
        ┌────────┴─────────┐
        │ YES              │ NO
        ▼                  ▼
┌───────────────────┐  Submit findings
│ PYTHON VALIDATOR  │          │
│ Depth / Budget    │          │
│ Scope / Duplicate │          │
└─────────┬─────────┘          │
          ▼                    │
┌──────────────────────────┐   │
│ DYNAMIC CHILD · NANO     │   │
│                          │   │
│ Investigate / Search     │   │
│ Evaluate evidence        │   │
│                          │   │
│ LLM DECISION AT RUNTIME: │   │
│ Spawn another child?     │   │
│                          │   │
│ YES → Validator → Repeat │   │
│ NO  → Return findings    │   │
└────────────┬─────────────┘   │
             │                 │
             └────────┬────────┘
                      ▼
┌──────────────────────────────────┐
│      VERIFIER · SUPER            │
│                                  │
│ ACCEPT / REVISE / INSUFFICIENT   │
│             │                    │
│ REVISE → Parent/Lead replans     │
│          (new LLM decision)      │
└─────────────┬────────────────────┘
              ▼
┌──────────────────────────────────┐
│     CLINICIAN REVIEW BRIEF       │
│ Evidence · Differential · Gaps   │
└──────────────────────────────────┘

 ACROSS ALL NODES:
 SQLite + Checkpoints + Retry + Events
```

### Recursion Rules

- Lead starts at depth 0; maximum depth is 3.
- Maximum 24 investigation nodes per run.
- Maximum three concurrent inference calls.
- A model may request zero, one, or multiple children within limits.
- Every child requires a specific, justified investigation objective.
- Child agents may independently create deeper research tasks.
- Python prevents duplicate tasks, out-of-scope investigations, and runaway recursion.
- Verifier feedback can trigger new model-driven investigation tasks.
- A parent can finish without spawning; failed evidence cannot silently become an accepted conclusion.

**Important:** Recursion is not guaranteed to produce a depth-3 tree for every case. The architecture must permit genuine depth-3 investigation when justified, and the demonstration should include one actual example.

### Definition of done (new P0, Done Means Done)

At run start the lead turns the one-line goal (e.g. "Investigate case_01 for clinician review") into a **done-checklist** of runnable checks, stored with the run and shown in the UI.

- **Floor from the clinical lead (always present; agents may add, never remove):**
  - D1: every accepted claim is grounded (C1, C2 pass).
  - D2: every can't-miss condition the lead flagged has a status: addressed, excluded by a named test, or open.
  - D3: every branch is verified or explicitly unresolved.
  - D4: every contradiction found in the record is listed, not silently resolved.
  - D5: the top hypothesis lists contradicting or missing findings (C3).
- **Agent-written criteria:** case-specific checks the lead adds, e.g. "DRD vs early-onset PD separated by a named discriminator".
- **Code runs the checklist before the report.** Any failure means continue or re-plan (spawn a targeted child) within budget. If it still fails, stop and report "not done" with the failing checks.

### Drift and loop guard (new P0)

- Stop re-spawning an objective that has been rejected twice; record it as unresolved.
- Stop a branch if two consecutive nodes add no new grounded findings.
- Node budget and depth limit as before.

### Ping a human (rare, by design)

- The lead may end with **"needs clinician input"** only when the record contradicts itself or a done-check cannot pass without information no investigation can release. Case 10 is the demo of this.
- Shown as a distinct event and at the top of the report, listing the exact questions for the clinician.

### Recovery

Every task saves checkpoints after meaningful completed stages.

- **Search failure:** Reformulate query → retry → alternative source → unresolved if unsuccessful.
- **Agent crash:** Detect stalled lease → restore checkpoint → resume incomplete stage, retaining finished sibling work.
- **Verifier rejection:** Record feedback → request revised investigation plan → spawn new work only if the model decides it is necessary.
- **Convergence:** The lead can produce a final report only after required branches are verified or explicitly unresolved.

## 7. Testing & Acceptance Criteria

| Test | Pass condition |
|---|---|
| Model connectivity | Both Nemotron models return valid structured output |
| Dynamic spawning | Different cases generate case-specific trees |
| No-spawn behavior | Agent can finish without creating children |
| True recursion | Child independently requests and executes a deeper task |
| Clinical verification | Verifier rejects unsupported claims |
| Verifier challenge set | Verifier run alone on a fixed set of known-true and known-false claims (with their passages) catches the false ones and accepts the true ones |
| Evidence-driven replanning | Rejection leads to an appropriate new runtime decision |
| Autonomous recovery | Injected failure resumes from checkpoint |
| State integrity | Finished sibling tasks are not rerun |
| Motion visualization | Video plays; annotations match verified case findings |
| Evidence grounding | Accepted claims trace to retrieved passages and case findings. Checked in code, not by the model: each quoted passage must appear verbatim in the retrieved source text, and each cited case finding id must exist in `case.json` |
| Can't-miss causes | Every report states whether Wilson disease and dopa-responsive dystonia were addressed, excluded by a named test, or remain open, when the presentation calls for them |
| Anchoring | Case 08 ranks functional disorder in the top 2; case 09 finishes with "no rare cause indicated" and few or no children |
| End-to-end | Hero case produces clinician-review report |

**Evaluation metrics:** Reference diagnosis in Top 5, key findings covered, citation validity, verifier rejection quality, latency, retry success, and node execution counts.

**Frozen references:** before the first scored run, tag the commit `refs-frozen`. Git history then shows the reference answers were fixed before any prompt tuning; any later change is visible with `git diff refs-frozen -- cases/reference/` and means re-running every case.

**Baselines (P1, not stretch):** three arms per case, so each layer's contribution can be shown separately.

| Arm | What runs | Shows |
|---|---|---|
| **B0: plain** | One Nemotron Super call. Same case, same report structure. No clinical rules, no recursion, no verifier. | What the model does alone |
| **B1: plain + rules** | One Nemotron Super call with `docs/clinical/reasoning_rules.md` in the prompt. No recursion, no verifier. | B1 vs B0 = what the clinical rules add |
| **Full** | The recursive system with rules and verifier. | Full vs B1 = what recursion plus verification add |

- All arms get the same case input, the same report JSON schema, temperature 0, and the same model version.
- B0 and B1 cannot search the literature, so compare them on reasoning measures (reference in top 5, can't-miss addressed, anchoring, harm, next test), and report citation measures for the full system only.
- The clinical rules were written after reading the cases, so B1 and Full share that advantage. Comparing Full with B1 keeps the recursion-plus-verifier comparison fair. B1 vs B0 may overstate what the rules would add on unseen cases; say so on the slide.
- Cost: two API calls per case on top of the full runs.

**Grading:** outputs from all three arms are stripped of labels and shuffled before Wiki grades them against the reference file, because Wiki also wrote the cases. Report results as counts ("3 of 4"), not percentages: ten cases is a feasibility check, not an accuracy study.

**Additional safety metrics:** can't-miss causes addressed (target: all), unsupported accepted claims on a clinician spot-check of 20 claims (target: zero), unsafe recommendations (target: zero).

## 8. Team Responsibilities

**Holly — Product & Engineering**
- Product scope and UX
- Frontend / React Flow investigation canvas
- Motion Viewer and optional MediaPipe integration
- FastAPI + Crusoe API integration
- Python orchestration and runtime spawning
- SQLite persistence, recovery, WebSocket
- Evidence Graph and source inspector
- Integration tests and demo presentation

**Dr. Wiki Milczyńska — Clinical Lead**
- Select ten suitable case candidates
- Fully review the hero case and three validation cases
- Prepare structured case JSON and held-out evidence
- Define relevant movement-disorder reasoning rules
- Define investigation prompts and verifier acceptance criteria
- Validate literature evidence and clinical conclusions
- Review next-step investigations and safety language
- Evaluate actual outputs against reference cases

**Required early handoff from Wiki:** Hero case JSON, reference answer stored separately, reasonable competing hypotheses, key evidence gaps, and verification checklist.

## 9. Build Plan (revised for the 5:00 PM deadline)

| Time (PT) | Holly | Wiki |
|---|---|---|
| Now to 2:30 | Done-checklist, done-check before report, loop guard, "needs clinician input" stop. First real Crusoe runs on case 01 (demo) and case 10 | Ask @CV about the medical-advice rule. Merge PRs #9 to #11. Review the first traces |
| 2:30 to 3:30 | Tag `refs-frozen`. Start unattended runs: B0, B1, Full on cases 01s, 08, 09, 10 (more if time) | Download the case 01 videos. Confirm annotation labels. Rehearse the clinical lines |
| 3:30 to 4:15 | UI polish for the demo path only | Blind grading of finished runs; scorecard counts |
| 4:15 to 4:40 | Record the 1-minute video. Make the repo public. README credits | Check credits and safety wording |
| 4:40 to 5:00 | **Submit.** Buffer | Submit check: repo public, video link works, both team members added |
| 5:00 to 6:45 | Live 3-minute demo (round one) | Clinical Q&A |

Freeze changes at 4:15 PM. Anything not working by then is cut, not fixed.

## 10. MVP Cut Line

**P0 — Must ship**
- Self-written done-checklist with the clinical floor (D1 to D5), checked in code before the report
- Loop guard and "needs clinician input" stop
- Public repository and 1-minute video by 5:00 PM
- Crusoe-hosted Nemotron inference
- One complete hero case
- Actual model-driven spawning and at least one recursive child delegation
- Literature retrieval and evidence provenance
- Independent verifier rejection or acceptance
- Durable checkpoints and one automatic recovery
- Live React Flow investigation tree
- Clinical evidence inspector
- Clinician-review report

**P1 — High-value demo additions**
- Baselines B0 (plain) and B1 (plain + clinical rules) on every reviewed case, graded blind with the full system
- Verifier challenge set
- Hero case Motion Viewer
- Physician-reviewed movement annotations
- Three more clinically reviewed cases
- Ten standardized candidate fixtures
- Basic Evidence Graph

**P2 — Cut if necessary**
- MediaPipe landmark tracking
- 3D anatomical reconstruction
- Automated video diagnosis
- Raw MRI interpretation
- Arbitrary PDF ingestion
- Advanced evaluation dashboard
- Authentication and EHR integrations

## 11. Three-Minute Demo (Done Means Done framing)

- **0:00–0:20: Hook and scope:** case 01 video S1 (credited). "Ten years, one label, and nobody asked whether the work was done. We built an agent team that refuses to say 'done' until it can prove it. It's human-in-the-loop: the agents investigate and verify, a doctor decides. Synthetic and published cases, never advice to patients."
- **0:20–0:40: Definition of done:** one-line goal in; the lead writes its own done-checklist (clinical floor plus case-specific checks) on screen.
- **0:40–1:20: Recursion:** the lead spawns children at runtime; a child spawns a deeper question. Nemotron Super plans, Nano investigates.
- **1:20–1:45: Verification:** a red rejection with its rule id, e.g. "R3: absence of diurnal variation does not exclude DRD". The agent re-plans.
- **1:45–2:05: Done-check and human ping:** the done-check catches a failing criterion and forces a re-plan; then case 10 stops with "needs clinician input" because its records contradict.
- **2:05–2:20: Recovery:** inject a search failure; the task resumes from its checkpoint.
- **2:20–2:40: Result:** the clinician-review report, then the reveal: levodopa result and videos S1 and S2 side by side.
- **2:40–2:55: Walk away:** scorecard from unattended runs, B0 vs B1 vs Full (counts, not percentages).
- **2:55–3:00: Closing:**

> "Most agents fill in the gaps and report success. Ours writes down what done means, proves it, and asks a human when it can't."

**1-minute submission video:** 0:00 to 0:10 hook and scope; 0:10 to 0:25 done-checklist; 0:25 to 0:40 tree plus one rejection; 0:40 to 0:50 human ping or recovery; 0:50 to 1:00 report reveal and credits.

## 12. Safety

**Not medical advice.** The system is a research prototype for clinicians. It never addresses patients, never states a diagnosis as established, and never gives doses or treatment instructions (verifier red lines RL1 to RL5). This is how we stay within the hackathon's ban on AI that gives medical advice.

Research prototype only — not a diagnostic medical device. Use synthetic or appropriately reusable de-identified cases. Do not process identifiable PHI. No autonomous clinical test ordering or treatment decisions. All conclusions and suggested next steps require physician review.

---

**Product principle:** We define the rules of recursion, not the shape of the investigation tree.

**Visual principle:** Watch the patient's movement. Watch the agents investigate. Watch the evidence change their hypotheses.
