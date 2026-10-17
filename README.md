# Rare Disease Detective

An autonomous clinical investigation system that recursively investigates rare neurological movement disorders, verifies medical evidence, and helps physicians explore complex diagnoses through interactive motion and agent visualizations.

**Recursive Agents Hackathon · Cerebral Valley × Crusoe · October 17, 2026**

> Research prototype only — not a diagnostic medical device. Synthetic / de-identified cases only. No PHI. All outputs require physician review.

## Team

- **Holly** — Product & Engineering
- **Dr. Wiki Milczyńska** — Clinical Lead

## Docs

- [PRD v4.0](docs/PRD.md) — full product spec, architecture, build plan, MVP cut line, demo script
- [Clinical Lead Brief](docs/CLINICAL_LEAD_BRIEF.md) — Wiki's deliverables, deadlines, and file formats
- [Case templates](cases/_template/) — `case.json`, `reference.example.json`, `annotations.json`

## Stack

- **Inference:** Crusoe Managed Inference (`https://api.inference.crusoecloud.com/v1`)
  - Lead / Verifier: `nvidia/Nemotron-3-Super-120B-A12B`
  - Child agents: `nvidia/Nemotron-3-Nano-30B-A3B`
- **Backend:** Python 3.11+, FastAPI, asyncio, OpenAI SDK (as Crusoe client), Pydantic, SQLite, HTTPX, WebSocket
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, React Flow, MediaPipe Hand Landmarker
- **Literature:** You.com Search API (fallback: Europe PMC / PubMed)

## Layout

```
backend/    FastAPI orchestrator, runtime spawning, verifier, SQLite checkpoints
frontend/   React Flow agent canvas, Motion Viewer, Evidence Inspector
cases/      Case fixtures (agent-visible) — reference answers held out separately
docs/       PRD and clinical framework
```

## Setup

```bash
cp .env.example .env   # fill in CRUSOE_API_KEY (and YOUCOM_API_KEY if available)
```

Backend and frontend scaffolds land during the 9–11 AM block. See the build plan in the PRD.

## Core principle

> We define the rules of recursion, not the shape of the investigation tree.

## Credits and what we built today

- **Case 01 (demo hero) is not our work.** Case details and both videos are adapted from Hasegawa T, Hosaka T, Harada R, Kawahata I, Hoshino K, Sugeno N, Kikuchi A, Aoki M. *Case Report: Guitarist's cramp as the initial manifestation of dopa-responsive dystonia with a novel heterozygous GCH1 mutation.* F1000Research 2021;10:361, doi:10.12688/f1000research.51433.1 (CC BY 4.0). Videos: Dryad, doi:10.5061/dryad.pzgmsbckd (CC0 1.0). Patient consent for publication was obtained by the original authors. The videos are not committed; download them from Dryad (see `cases/README.md`).
- **Built during the hackathon (17 Oct 2026):** the orchestrator, verifier, grounding checks, held-out release harness, MediaPipe kinematics, UI, the synthetic cases 02 to 10 and the synthetic version of case 01, all reference answers, the clinical rules in `docs/clinical/`, the verifier challenge set, and the evaluation runners in `backend/tools/`.
- **Human-in-the-loop:** agents investigate and verify; a clinician decides. Outputs are considerations for physician review, never a diagnosis or advice to patients.
