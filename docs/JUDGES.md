# Judges & Q&A Prep

Prep for the Recursive Agents Hackathon (Cerebral Valley × Crusoe, October 17, 2026). It covers who is judging, what each judge is likely to ask, how we answer today, and which theme we are entering.

Backgrounds come from public professional sources only. **Confirmed** means a first-party or employer source. **Unverified** means a third-party aggregator, or nothing found. "Likely cares about" is our inference, not a fact.

Event tagline: *"Build a team of agents you can walk away from."* The official judging rubric is not published, so ask the organizers for it.

---

## 1. Theme: 01 — Done Means Done

> Build an agent team on Crusoe Managed Inference that defines success, verifies its own work, detects failures, and knows when to stop or ask for help.

| Theme requirement | What we have | Gap |
|---|---|---|
| Defines success | Implicit only: can't-miss rules in `reasoning_rules.md`, and the convergence rule (every branch verified or unresolved) | Add explicit `done_criteria` to the lead plan and a code-checked **done gate** before `report.ready` |
| Verifies its own work | Independent verifier (Super) with ACCEPT / REVISE / INSUFFICIENT. Code checks that quotes appear verbatim in the source and that finding ids exist (`grounding.py`). `_check_report_ids` drops invalid citations. Verifier challenge set: 10 true and 10 false claims | Run the challenge set and record the score |
| Detects failures | Checkpoint retry (`MAX_ATTEMPTS=3`), a search recovery ladder (reformulate → retry → alternative → unresolved), a spawn validator, JSON repair and re-ask, and failure injection (`/inject`) | — |
| Knows when to stop | Depth limit 3, budget of 24 nodes, `max_replans_per_branch`, and an `unresolved` status. Case 09 should finish with "no rare cause indicated" | — |
| Asks for help | `unresolved_questions` in the report only | Add a `help.requested` event: after a replan, an INSUFFICIENT verdict hands an explicit question to the clinician |

**Do not claim theme 02 or 03.** Investigators do not share evidence across branches, and there is no memory across runs, so theme 02 does not fit. Nothing learns between runs, so theme 03 does not fit. If someone asks about self-improvement, say it is future work (see Q&A in section 3).

---

## 2. Judges

### First round

| Judge | Role | Background | Likely cares about | Source status |
|---|---|---|---|---|
| **Janaki Ram Goteti** | Sr. Staff Software Engineer, Crusoe | Co-author of Crusoe's "GPU fundamentals for Triton programmers" (Oct 2026). Previously Staff SWE at Google, co-founder of CellFish, and Microsoft (patents). | Systems depth, token and GPU efficiency, whether the recursion is real engineering or just a prompt loop | Confirmed (Crusoe blog); earlier roles unverified (ZoomInfo) |
| **George Gulabyan** | Sr. Product Manager, Crusoe | Northwestern MEng Management. Co-founded TensorAI. Posts about AI for healthcare, including a physician-agent project that won a hackathon. Was a TA for Northwestern's NUvention AI course. | Product fit, who the clinical user is, trust, what happens when the system is wrong | LinkedIn confirmed; details unverified |
| **Shubham Amilkanthwar** | Staff / Sr. Data Engineer, Crusoe | Leads Crusoe's data team (real-time analytics). Previously led BI at Sprout and built AI-assisted revenue pipelines at Asana. Has presented on observability pipelines and multi-agent research. | Observability, auditability, provenance, replaying a run | Confirmed (InfoWorld bio) |
| **Martin Cala** | Staff Solutions Engineer, Crusoe | Authored Crusoe's MLPerf Inference v6.1 post (~5.75M tok/s, 512× MI355X). Posts on Union.ai and Slurm. PyTorch posts on fault-tolerant training. | Throughput, fault tolerance, orchestration, concurrency, rate limits | Confirmed (Crusoe blog) |
| **Hemant Sethi** | Staff Software / Infrastructure Engineer, Crusoe | AI storage and distributed systems. Posts mention the Crusoe post-training team, Triton, FSDP and Ray Train. | State consistency, SQLite under concurrency, fine-tuning a small verifier | Confirmed (GitHub, personal site) |
| **Rohit Kalmankar** | Sr. Staff Solutions Engineer, Crusoe | Crusoe blog: 10,195 AI videos in a weekend on 16 H200s in Crusoe's Iceland region. Previously at C3 AI (solution architecture). Focus on compute, storage and networking. | Cost per run, end-to-end latency, scaling to thousands of cases, data residency and HIPAA | Crusoe blog confirmed; earlier roles unverified |
| **Raj Jagiasi** | Founder, Elite (YC S26) | Elite builds AI voice agents for healthcare front offices, with 19+ EHR integrations. Previously at Deel. Earlier pivot: Stratum, which ran parallel agents with a human in the loop. | Clinical workflow fit, who pays, EHR integration, human in the loop | Confirmed (YC) |
| **Pranay Periwal** | Founding PM (title unconfirmed), Color | Probably Color Health: genomics, plus a cancer copilot that physicians oversee. Former JPMorgan quant developer and co-founder of Tova. | Physician oversight, validation against ground truth, blocking hallucinated citations | LinkedIn confirmed; title and that Color = Color Health unverified |
| **Kaan Yigit** | Co-founder & CTO, Stoa (YC S26) | Stoa is a marketplace for GPUs and AI hardware. Previously a quant developer at Uniper. | GPU and token economics, cost per case, crash and resume, latency | Confirmed (YC) |
| **Sanjana Somayajula** | Product Manager, NVIDIA | No public profile found | Probably how we use Nemotron | Unverified |
| **Abhinav Balasubramanian** | Staff AI Engineer, NVIDIA | Works on scaling generative AI and agentic systems. Applied-ML papers, including AI analytics for pharma. | Spawn/stop logic, runaway recursion, tool calling, whether the verifier catches real errors | Confirmed (LinkedIn, Google Scholar) |
| **Didi Kamalova** | System Software Engineer, NVIDIA | Stanford. Low-level and systems background. | Bottlenecks, concurrency, where MediaPipe runs | Partially confirmed |
| **George H.** | Technical Program/Product Manager, Apple | Not identified (surname not legible on the slide) | Possibly on-device processing and privacy (guess) | Unknown |
| **Mi… (surname not legible)** | Founder(?), Bl… | Not identified | — | Unknown |
| **Christina Lucey** | Product Lead, You.com | Leads enterprise and core experiences at You.com. Waterloo BCS. Previously at BlackBerry, Yammer and Credit Karma (Associate Director of PM). | How central You.com is to the build, how citations surface, end-to-end user flow | LinkedIn confirmed; title per ZoomInfo |

### Final round

| Judge | Role | Background | Likely cares about | Source status |
|---|---|---|---|---|
| **Connor Guerrero** | DevRel & ML Engineer, Crusoe | Sr. DevRel Manager since Feb 2026 and a founding member of developer advocacy. Previously at Tenstorrent (vLLM apps) and AONDevices. Wrote Crusoe tutorials on self-healing PyTorch/Slurm, KServe and Triton. Co-presented "GPU Died. Training Didn't" at AI Engineer. His Crusoe workshop repo teaches routing from cheap to heavy models and Pydantic structured output. | Idiomatic use of Crusoe inference, routing between cheap and expensive models, self-healing, a demo that runs end to end | Confirmed (personal site, GitHub) |
| **Piyush Kadam** | Group Product Manager, Crusoe | Co-authored the Crusoe Serverless Fine-Tuning launch post. Previously at NVIDIA (GeForce cloud gaming) and Amazon SageMaker (MLOps). Holds a patent on observability for ML training and inference. | Product value, measurable evals and a baseline, observability, whether run traces could feed fine-tuning | Confirmed (Crusoe blog, LinkedIn) |
| **Emmanuel Acheampong** | Sr. Manager, Developer Relations, Crusoe | Founding member of Crusoe Managed AI DevRel. Co-founded yShade.ai. Wrote Crusoe posts on Nemotron 3 Ultra + LangChain Deep Agents ("the biggest wins live in the harness") and on the Hermes agent. Talks: "No Single Model to Rule Them All" and "Inference in Production". | Harness design, routing and failover across models, cost per task, traceability, an honest "I don't know" | Confirmed (Sessionize, Crusoe blog) |
| **Sako Mammadov** | Staff Back End Engineer, You.com | Background in AI, DevOps and security. CKA/CKAD and AWS certified. Previously at OpenGov, Gladly and Huawei. Runs GDG and CNCF communities and mentors and judges hackathons often. Repos include `ydc-knowledge-samples` and `youhack`. | Non-trivial use of You.com, backend robustness (retries, rate limits, caching), source quality, PHI and security | Confirmed (GitHub, LinkedIn) |

### What sponsors are pushing (useful talking points)

- **Crusoe Managed Inference.** OpenAI-compatible serverless API. Self-Serve dedicated endpoints cost $5.50/hr (H100) and $6.00/hr (H200). **MemoryAlloy** is a cluster-wide KV cache that Crusoe pitches for agents that "cycle over large, stable prompts". Crusoe also offers Serverless Fine-Tuning.
- **Nemotron 3.** Both models are hybrid Mamba/MoE with up to 1M context, a reasoning on/off switch and thinking budgets.
  - Super 120B-A12B: planner and verifier.
  - Nano 30B-A3B (~3B active): cheap leaf workers.
- **You.com API.** Search (`livecrawl` returns full page text), Contents (clean Markdown for given URLs), and Research (cited, multi-search synthesis).

---

## 3. Likely questions and our answers

Status: ✅ we can answer now · ⚠️ partial · ❌ we can't yet. Each ❌ has a fix in section 4.

### Cost, latency, infrastructure (Crusoe: Janaki, Martin, Rohit, Hemant, Kaan, Connor)

| Question | Status | Answer / notes |
|---|---|---|
| How many tokens, how many dollars, and how many seconds per case? | ❌ | We don't log `resp.usage` or latency yet. Fix 2. |
| Where does the time go: inference, search, or waiting on children? | ❌ | Same as above. Fix 2. |
| Peak concurrent requests to Crusoe? Did you hit rate limits? | ⚠️ | `MAX_CONCURRENT_INFERENCE=3`, enforced by an asyncio semaphore around every call. No rate-limit data yet. |
| Why Super for some roles and Nano for others? | ✅ | Super (12B active) handles planning, verification and replanning, where errors propagate through the tree. Nano (~3B active) handles the many leaf investigations: plan searches, read abstracts, extract grounded findings. Leaves are the bulk of the calls and much cheaper on Nano. |
| Do sub-agents share a prompt prefix so MemoryAlloy / prefix caching helps? | ⚠️ | System prompts are fixed per role. In most payloads the case record comes first, so calls of the same role share a long, stable prefix. We haven't measured cache hits. Don't claim a speedup we haven't measured. |
| What happens if a Crusoe call fails or times out mid-tree? | ✅ | The node retries from its last checkpoint, up to 3 attempts. Finished siblings are never rerun. Demo: `/inject agent_crash`. A run can also `/resume` from SQLite after the backend process restarts. |
| Is SQLite enough under concurrency? | ✅ | Everything runs in one asyncio process, so writes are serialized and there's no write contention. In production, Postgres plus a task queue. The event log is append-only with gapless `seq`, so it ports directly. |
| How would this scale to thousands of cases? | ⚠️ | Runs are independent, so they shard by run. Move the batch evaluation to a Crusoe Self-Serve dedicated endpoint (throughput profile). |

### Recursion and agent design (NVIDIA: Abhinav, Didi; Crusoe DevRel: Emmanuel, Connor)

| Question | Status | Answer / notes |
|---|---|---|
| Is the tree hardcoded? | ✅ | No. The model decides whether to spawn, what to spawn and how many. Python only validates. Different cases produce different trees. Show two cases side by side. |
| How do you prevent runaway recursion? | ✅ | `validator.py` checks depth ≤ 3, ≤ 24 nodes per run, duplicate objectives, scope, and a cap on children per decision. Rejections are emitted as `spawn.rejected` events. |
| Show a child that independently spawns a deeper task. | ⚠️ | The architecture allows it. We need a recorded real run that shows depth ≥ 2. |
| Native tool calling or prompt-parsed JSON? Failure rate? | ⚠️ | Prompt-parsed JSON. It strips `<think>`, extracts JSON, repairs trailing commas, checks required keys per role, and re-asks once. We have no failure-rate numbers yet. Fix 2 can count re-asks. |
| Why a custom harness and not LangChain Deep Agents or Hermes? | ✅ | We need guarantees enforced in code, not prompts: verbatim-quote grounding, held-out release rules, spawn validation, and checkpoint-level resume with a replayable event log. Those are the "Done Means Done" properties. |
| Did you use Nemotron's reasoning budgets or on/off? | ❌ | Not yet. A cheap win: reasoning on for the verifier, low or off for Nano leaf workers. |
| Where does MediaPipe run? | ⚠️ | Planned for the browser (client side), but not implemented yet (P2 in the PRD). It would only extract landmarks and makes no diagnostic claim. Clinical interpretation comes from Wiki's physician-reviewed annotations. |

### Verification and "done" (Emmanuel, Abhinav, Pranay, Piyush)

| Question | Status | Answer / notes |
|---|---|---|
| How does the system define "done"? | ⚠️ | Today: every branch is verified or explicitly unresolved, and the can't-miss rules apply. Fix 3 makes this an explicit, code-checked checklist. |
| The verifier is the same model family as the planner. What stops it rubber-stamping? | ⚠️ | It's a separate role and prompt, it sees only grounded findings and their source text, and it has explicit rejection rules (population mismatch, ruling out on a variable feature, penetrance). Grounding is checked in code before the verifier runs. Evidence: the challenge set of 10 true and 10 false claims. We need to run it and quote the score. |
| Show a case where it said "I don't know" or escalated. | ⚠️ | Case 09 (nonspecific focal dystonia) should end with "no rare cause indicated". `unresolved` branches show up in the report. Fix 3 adds an explicit `help.requested`. |
| What stops a hallucinated citation reaching the clinician? | ✅ / ⚠️ | Two cases. **A fabricated quote** (✅): the code checks that each quote appears verbatim in the retrieved source text and that each finding id exists in `case.json`, or the finding is discarded. Invalid ids in the report are dropped and listed in `dropped_invalid_ids`. **A real quote used for the wrong claim** (⚠️): code can't catch this; it is the verifier's job (rule A2), measured with the challenge set. |

### Evaluation (Piyush, Pranay, Abhinav)

| Question | Status | Answer / notes |
|---|---|---|
| What is the baseline? | ⚠️ | Three arms per case, same input and report structure, graded blind together. **B0:** one plain Nemotron Super call. **B1:** one plain call with `reasoning_rules.md`. **Full:** the whole system. B1 vs B0 shows what the clinical rules add; Full vs B1 shows what recursion plus the verifier add. Not run yet (fix 5). |
| How did you keep reference answers from leaking? | ⚠️ | Agents only ever see `case.json`. References sit in `cases/reference/` and the loader never sends them. The hero case is demo-only (the model may have memorised the published case); slot 01 is scored on a synthetic version. **Limits:** the retrieval blocklist only blocks the source article's DOI, so other papers discussing the case could still be retrieved. The `refs-frozen` tag will be set before scored runs; it doesn't exist yet. The clinical rules were written after reading the cases, which is why B1 (plain call plus the same rules) is the fair comparison. |
| Ten synthetic cases is tiny. | ✅ | Agreed. It's a feasibility check, not an accuracy study, so we report counts ("3 of 4"), not percentages. Grading is blind to the arm: outputs are shuffled and labels stripped before grading. **But there is a single grader:** Wiki wrote both the cases and the rules, and no second rater checks the grades. |
| Isn't the "held-out" result just mock data? | ⚠️ | In synthetic cases the results are scenario data written by our clinical lead; in case 01 they are the published results. What we test is whether the agents ask for the right investigation: a result is released only when an agent requests it, the way a clinician orders a test. Requests are matched to results by fuzzy text matching. The release rules are in `cases.py`. |
| Could the system improve from its own traces? | ⚠️ | Future work, not claimed. Verifier rejections are labelled training data, so we could fine-tune a Nano verifier with Crusoe Serverless Fine-Tuning and measure it on the challenge set. |

### Product and clinical (George G., Raj, Pranay, Christina, Piyush)

| Question | Status | Answer / notes |
|---|---|---|
| Who is the user, and where in their workflow? | ✅ | A neurologist or movement-disorder specialist reviewing a hard referral before ordering the next test. The output is a clinician-review brief, not a diagnosis. |
| Where is the physician in the loop? | ⚠️ | The output is a clinician-review brief of considerations. The clinician decides every real-world action; agents can only request (issue #14). The organisers cleared us on this human-in-the-loop basis. Suggested investigations are framed as considerations, never orders. Treatment is out of scope. |
| Does it plug into an EHR? Who pays? | ⚠️ | Not in scope today. The input is structured case JSON, which could map from FHIR. The buyer would be academic movement-disorder or rare-disease centres and diagnostic-odyssey programmes. |
| PHI / HIPAA? | ⚠️ | We use synthetic or de-identified cases only, with no PHI. For production: a dedicated or sovereign Crusoe deployment, and search queries designed to contain only clinical terms, not patient text. This is not enforced in code yet. |
| How accurate is it vs a neurologist? | ✅ | We don't claim accuracy. Ten cases is a feasibility check. The metrics we report are safety metrics: can't-miss conditions addressed, zero unsupported claims, zero unsafe outputs. |
| What if it misses something? Who's liable? | ✅ | The clinician decides. The can't-miss floor forces a status for every treatable mimic, and gaps are shown as open, not hidden. |
| Automation bias: won't doctors just trust it? | ✅ | Every hypothesis shows its contradicting evidence, unresolved branches are labelled, and nothing is stated as a diagnosis. |
| Are the report's confidence labels calibrated? | ✅ | No. They are not validated; treat them as ordinal. |
| Why movement disorders? | ✅ | Long diagnostic delays, and treatable mimics that are cheap to test for. The hero patient waited 10 years for a treatment that worked the next day. |

### Search (You.com: Christina, Sako)

| Question | Status | Answer / notes |
|---|---|---|
| Why You.com and not just PubMed? | ❌ | You.com is only a fallback on branch `backend/youcom-search`, it isn't merged, and there's no key. Fix 4. Planned answer: Europe PMC for peer-reviewed abstracts, You.com for clinical guidelines and GeneReviews-style pages with full text. |
| Snippets or full contents? | ❌ | Planned: `livecrawl` or Contents for full text, so verbatim-quote grounding works on the whole page. |
| What stops low-quality web sources contaminating the result? | ⚠️ | Today: verbatim grounding plus the verifier. Planned: a domain allowlist (NIH/NCBI, GeneReviews, journals) and the source domain shown in the report. |
| Do citations survive to the report? | ✅ | Evidence ids in the report link to source ids. The inspector shows title, URL and the quoted passage. |

---

## 4. Fixes, by priority (real backend, no mock data)

1. **Record one full real hero run and keep the SQLite database.** `backend/rdd.sqlite3` is currently empty. Replaying a real recorded event stream is a legitimate demo fallback. Set `LLM_BACKEND=crusoe` explicitly in `.env`; otherwise a missing key silently falls back to the mock model (`config.py`).
2. **`llm.call` event.** Record role, model, latency_ms, prompt and completion tokens (`resp.usage`) and the re-ask count, then summarize per run (total tokens, cost, wall time, peak concurrency). This answers most of the infrastructure questions.
3. **Done gate.**
   - The lead plan emits `done_criteria`.
   - Before `report.ready`, code checks each criterion: can't-miss causes addressed, all branches verified or unresolved, no ungrounded claims. It emits `run.done_check`, which the UI shows as a checklist.
   - An INSUFFICIENT verdict after a replan emits `help.requested`.
4. **You.com.**
   - Merge `backend/youcom-search` and get an API key at the You.com table.
   - Use full text (livecrawl or Contents) and a domain allowlist.
   - Show the source domain in the report.
5. **Numbers.** Run the verifier challenge set and the B0 and B1 baselines on the reviewed cases, and report counts.
6. **Nemotron reasoning settings.** Reasoning on for the verifier, low or off for Nano workers. Measure the difference with fix 2.
