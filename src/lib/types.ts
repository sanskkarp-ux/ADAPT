/**
 * Shared shapes for ADAPT.
 * The planner, the screen, and localStorage all speak these types
 * so a future model or MCP tool can return the same structures.
 */

export type Priority = "critical" | "high" | "medium" | "low";

/**
 * fixed: moves only when a disruption reports a new time.
 * protected: stays put unless the user approves an alternative that moves it.
 * movable: free to reschedule around the constraints above.
 */
export type Flexibility = "fixed" | "protected" | "movable";

export type Category = "focus" | "travel" | "commitment" | "personal" | "rest";

export type PlacementStatus =
  | "kept"
  | "moved"
  | "added"
  | "shortened"
  | "dropped"
  | "unresolved";

export interface Task {
  id: string;
  title: string;
  detail: string;
  durationMin: number;
  priority: Priority;
  flexibility: Flexibility;
  category: Category;
  /** Minutes from Wednesday 00:00 in the sample week. */
  earliestStartMin: number;
  /** Hard stop. The task must finish at or before this minute. */
  latestEndMin: number | null;
  /** Soft window. Missing it is a tradeoff, not a failure. */
  preferStartMin?: number;
  preferEndMin?: number;
  /**
   * Optional tasks that start after this minute are dropped by the
   * "simpler morning" recovery instead of being pushed to the afternoon.
   */
  preferLatestStartMin?: number;
  deadlineMin: number | null;
  /** Required for fixed and protected tasks. */
  pinnedStartMin: number | null;
  dependsOn: string[];
  /** This task must finish at or before the named task starts. */
  finishBeforeTaskId?: string;
  /** Travel tasks finish this many minutes before the anchor starts. */
  arrivesBeforeTaskId?: string;
  arrivalBufferMin?: number;
  optional?: boolean;
  /** On-campus blocks affect when the commute must arrive. */
  onCampus?: boolean;
  location?: string;
}

export interface Placement {
  taskId: string;
  startMin: number;
  endMin: number;
  status: PlacementStatus;
  note: string;
}

export interface Conflict {
  id: string;
  severity: "hard" | "soft";
  taskIds: string[];
  message: string;
}

export interface SolvedPlan {
  id: string;
  title: string;
  tradeoff: string;
  placements: Placement[];
  conflicts: Conflict[];
  feasible: boolean;
  score: number;
}

export type Disruption =
  | {
      type: "move-fixed";
      taskId: string;
      newStartMin: number;
      label: string;
    }
  | {
      type: "extend-travel";
      taskId: string;
      addMin: number;
      label: string;
    }
  | {
      type: "add-task";
      task: Task;
      label: string;
    };

export interface Proposal {
  disruption: Disruption;
  /** Task list with the disruption applied, before approval commits pins. */
  tasks: Task[];
  alternatives: SolvedPlan[];
  recommendedId: string;
  /** Why the strict reading fails, when a protected time cannot stay. */
  blockedReason: string | null;
  headline: string;
  detail: string;
  /** Sentence showing what was understood before scheduling. Optional for older saves. */
  understood?: string;
  /** mcp: local planning tool. builtin: the tool was off or unreachable. */
  channel?: "mcp" | "builtin";
}

export type ProposalResult =
  | { ok: true; proposal: Proposal }
  | { ok: false; error: string };

export interface ChatMessage {
  id: string;
  role: "user" | "adapt";
  text: string;
  tone: "neutral" | "warning" | "success" | "error";
}

export type AppStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; text: string }
  | { kind: "rejected"; text: string }
  | { kind: "error"; text: string };

export interface SessionState {
  tasks: Task[];
  accepted: SolvedPlan;
  /** The sample schedule from the start of the demo. Never edited until reset. */
  openingPlacements: Placement[];
  proposal: Proposal | null;
  selectedAlternativeId: string | null;
  messages: ChatMessage[];
  status: AppStatus;
  seq: number;
  appliedLabels: string[];
}

export interface ScheduleRow {
  taskId: string;
  title: string;
  detail: string;
  location?: string;
  priority: Priority;
  flexibility: Flexibility;
  optional: boolean;
  before: { startMin: number; endMin: number } | null;
  after: { startMin: number; endMin: number } | null;
  change: "same" | "moved" | "added" | "removed" | "shortened" | "unresolved";
  note: string;
  conflict: boolean;
}
