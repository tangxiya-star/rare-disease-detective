# Rare Disease Detective — PRD v4.0

**Recursive Agents Hackathon · Cerebral Valley × Crusoe · October 17, 2026**

## One-liner

An autonomous clinical investigation system that recursively investigates rare neurological movement disorders, verifies medical evidence, and helps physicians explore complex diagnoses through interactive motion and agent visualizations.

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

**Baseline (P1, not stretch):** one Nemotron Super call per case, same input, asked for the same report structure, no recursion and no verifier. Without it there is no evidence that recursion or verification adds anything, which is the first question judges will ask. It costs one API call per case.

**Grading:** outputs from the baseline and the full system are stripped of labels and shuffled before Wiki grades them against the reference file, because Wiki also wrote the cases. Report results as counts ("3 of 4"), not percentages: ten cases is a feasibility check, not an accuracy study.

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

## 9. Thirteen-Hour Build Plan

| Time (PT) | Holly | Wiki |
|---|---|---|
| 9–11 AM | API smoke test, backend/UI scaffold | Hero case + clinical framework |
| 11 AM–1 PM | Runtime spawning, task state | Prompts + gold-standard answers |
| 1–3 PM | Search, evidence, verifier | Review early investigation traces |
| 3–5 PM | React Flow + WebSocket | Validation case preparation |
| 5–7 PM | Recovery + Motion Viewer | Clinical testing and corrections |
| 7–9 PM | Integration + UI polish | Report review + demo rehearsal |
| 9–10 PM | Freeze, present, submit | Clinical sign-off + Q&A |

Freeze changes before the actual organizer submission deadline.

## 10. MVP Cut Line

**P0 — Must ship**
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
- Single-model baseline run on every reviewed case, graded blind
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

## 11. Three-Minute Demo

- **0:00–0:25 — Problem:** Holly introduces the experience of complex medical investigations and why clinicians need evidence-driven autonomous research.
- **0:25–0:50 — Motion:** Show the guitarist's documented hand movement and the physician-reviewed observations.
- **0:50–1:25 — Recursion:** Start the investigation. The Lead Agent creates tasks dynamically; a child discovers an evidence gap and requests further research.
- **1:25–1:55 — Verification:** Show supporting and conflicting evidence. The verifier rejects an unsupported claim or requests clarification.
- **1:55–2:20 — Recovery:** Inject a simulated research failure; watch the task restore its checkpoint and continue.
- **2:20–2:45 — Result:** Open the clinician-review report and show source-backed hypotheses and unresolved questions.
- **2:45–3:00 — Closing:**

> "We're not building another AI that guesses diagnoses. We're building an autonomous clinical investigation system that knows what to question next, verifies its evidence, and shows physicians how it reached every conclusion."

## 12. Safety

Research prototype only — not a diagnostic medical device. Use synthetic or appropriately reusable de-identified cases. Do not process identifiable PHI. No autonomous clinical test ordering or treatment decisions. All conclusions and suggested next steps require physician review.

---

**Product principle:** We define the rules of recursion, not the shape of the investigation tree.

**Visual principle:** Watch the patient's movement. Watch the agents investigate. Watch the evidence change their hypotheses.
