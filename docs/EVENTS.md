# API and event stream

The contract between the backend (`backend/app/`) and the React frontend. Keep it in sync with `backend/app/events.py`.

## REST

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{llm_backend: "mock" \| "crusoe", search_backend, lead_model, child_model}` |
| GET | `/api/cases?mode=demo\|scored` | `[{slot, case_id, title}]` from `cases/manifest.json` |
| GET | `/api/cases/{slot}?mode=` | `{case, annotations, has_video}`. `case` is exactly what agents see (no provenance, no reference). |
| GET | `/api/cases/{slot}/video?mode=demo` | The agent-visible clip (`video/mp4`). 404 if not downloaded locally. |
| POST | `/api/runs` `{slot, mode}` | `{run_id}`; the run starts immediately in the background |
| GET | `/api/runs/{run_id}` | `{run, nodes, evidence, sources}`: full current state, for page reloads |
| GET | `/api/runs/{run_id}/media/{gap_id}` | Held-out media (e.g. post-levodopa clip). **403 until this run released that result.** |
| POST | `/api/runs/{run_id}/inject` `{kind: "agent_crash" \| "search_failure", node_id?}` | Failure injection for the recovery demo |
| POST | `/api/runs/{run_id}/resume` | Continue a run from SQLite (after a backend restart) |
| WS | `/api/runs/{run_id}/events?after=<seq>` | Replays events with `seq > after`, then streams live |

## Event envelope

```json
{"run_id": "run_ab12cd34ef", "seq": 17, "ts": 1792353600.12, "type": "node.created", "data": {...}}
```

`seq` increases by one per run with no gaps. On reconnect, pass the last `seq` you saw as `after`.

## Node

```json
{"id": "node_03", "run_id": "...", "parent_id": "node_01", "depth": 2,
 "role": "lead" | "investigator", "model": "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
 "objective": "...", "justification": "...",
 "status": "queued" | "running" | "researching" | "waiting_children" | "verifying" | "retrying" | "done" | "unresolved" | "failed",
 "checkpoint": "created" | "planned" | "research_done" | "analyzed" | "children_spawned" | "children_done" | "finished" | "reported",
 "verification": "pending" | "accepted" | "revise" | "insufficient",
 "retry_count": 0}
```

Lead checkpoints: `created → analyzed → children_spawned → children_done → reported`.
Investigator checkpoints: `created → planned → research_done → analyzed → children_spawned → children_done → finished`.

## Event types

| type | data | UI use |
|---|---|---|
| `run.started` | `{run_id, slot, mode, case_id, llm_backend}` | Header status; show a "mock model" badge when `llm_backend == "mock"` |
| `node.created` | `{node}` | Add a node to the agent tree |
| `node.status` | `{node_id, status, checkpoint, verification}` | Node colour / icon (● working, ↻ retrying, ✓ verified) |
| `node.decision` | `{node_id, action: "spawn" \| "finish" \| "unresolved", requested_children, rationale, hypotheses?, trigger?: "verifier", about?: node_id}` | Show the model's runtime decision; `trigger: "verifier"` marks replanning after a rejection |
| `spawn.rejected` | `{node_id, objective, reason}` | Python validator blocked a request (depth, budget, duplicate, scope) |
| `search.performed` | `{node_id, query, query_used, attempts: [{source, query, ok, n?, error?}], results: [{source_id, title, url}]}` | Sources in the inspector; failed attempts show the recovery ladder |
| `search.failed` | `{node_id, query, attempts, status: "unresolved"}` | All attempts failed |
| `heldout.released` | `{node_id, request, gap_id, source_id: "HELDOUT:gap_NN", investigation, result, media}` | New investigation result; if `media`, fetch `/api/runs/{run_id}/media/{gap_id}` (demo reveal) |
| `heldout.unavailable` | `{node_id, request, status: "withheld" \| "not_available", reason}` | Requested result not in the record or not yet releasable |
| `evidence.added` | `{evidence: {id, node_id, kind: "literature" \| "heldout" \| "case", claim, quote, source_id, finding_ids, stance, hypothesis, grounded, grounding_note}}` | Evidence inspector and graph; `grounded: false` items were discarded by the code check |
| `verification` | `{node_id, verdict: "accepted" \| "revise" \| "insufficient", feedback, rejected_evidence_ids}` | Verifier decision panel |
| `node.retry` | `{node_id, attempt, checkpoint, reason}` | ↻ on the node |
| `node.recovered` | `{node_id, from_checkpoint}` | "Restored from checkpoint X" |
| `failure.injected` | `{kind, node_id}` | Demo marker |
| `report.check` | `{check: "C3", passed: bool}` | Agent events. Emitted when the rank-1 hypothesis listed no contradicting findings and the lead was re-asked |
| `report.ready` | `{report: {summary, differential[], cant_miss[], unresolved_questions[], suggested_investigations[], disclaimer}}` | Clinical Report tab |
| `run.finished` | `{status: "completed" \| "failed", nodes}` | Header status |

`finding_ids` and the movement annotations' `finding_id` refer to ids in `case.json` (`mf_*`, `tl_*`, `lab_*`, `img_*`, `np_*`), so the UI can link evidence to the video timeline.
