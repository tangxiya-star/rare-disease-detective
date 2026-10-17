// Mirrors docs/EVENTS.md. Keep in sync with backend/app/events.py.

export type Mode = 'demo' | 'scored'

export type NodeStatus =
  | 'queued' | 'running' | 'researching' | 'waiting_children' | 'verifying'
  | 'retrying' | 'done' | 'unresolved' | 'failed'

export type Verification = 'pending' | 'accepted' | 'revise' | 'insufficient'

export interface AgentNode {
  id: string
  run_id: string
  parent_id: string | null
  depth: number
  role: 'lead' | 'investigator'
  model: string
  objective: string
  justification: string | null
  status: NodeStatus
  checkpoint: string
  verification: Verification
  retry_count: number
}

export interface Evidence {
  id: string
  node_id: string
  kind: 'literature' | 'heldout' | 'case'
  claim: string
  quote: string | null
  source_id: string | null
  finding_ids: string[]
  stance: string | null
  hypothesis: string | null
  grounded: boolean
  grounding_note: string | null
}

export interface SourceRef { source_id: string; title: string; url: string }

export interface Report {
  summary: string
  differential: {
    rank: number; hypothesis: string; confidence: string
    supporting_evidence_ids: string[]; contradicting_evidence_ids: string[]
  }[]
  cant_miss: { condition: string; status: string; basis: string }[]
  unresolved_questions: string[]
  suggested_investigations: { investigation: string; rationale: string }[]
  disclaimer: string
  dropped_invalid_ids?: string[]
}

export interface RunEvent<T = Record<string, any>> {
  run_id: string
  seq: number
  ts: number
  type: string
  data: T
}

export interface CaseEntry { id: string; [k: string]: any }

export interface CaseRecord {
  case_id: string
  title: string
  demographics: { age: number; sex: string; handedness: string; occupation: string }
  chief_complaint: string
  history_of_present_illness: string
  symptom_timeline: CaseEntry[]
  movement_findings: CaseEntry[]
  neurological_exam: Record<string, string>
  labs: CaseEntry[]
  imaging: CaseEntry[]
  neurophysiology?: CaseEntry[]
  motion_analysis?: CaseEntry[]
  medications: { current: string[]; prior_trials: Record<string, string>[] }
  family_history: string
  social_history: string
  prior_workup_and_opinions: string
}

export interface Annotation { t_start: number; t_end: number; label: string; finding_id: string }

export interface CaseView {
  slot: string
  mode: Mode
  case: CaseRecord
  annotations: { annotations: Annotation[]; video: Record<string, any> } | null
  has_video: boolean
  has_landmarks?: boolean
}

export interface Health { llm_backend: 'mock' | 'crusoe'; search_backend: string; lead_model: string; child_model: string }
