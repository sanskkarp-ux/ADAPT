import { demoCalendar } from "@/lib/providers";
import { commitTasks, solveBaseline } from "@/lib/planner";
import { formatWhen } from "@/lib/time";
import type { AppStatus, ChatMessage, Proposal, SessionState, SolvedPlan } from "@/lib/types";

export type SessionAction =
  | { type: "HYDRATE"; state: SessionState }
  | { type: "STORAGE_INVALID" }
  | { type: "LOADING"; userText: string }
  | { type: "ENGINE_RESULT"; proposal: Proposal }
  | { type: "ENGINE_FAILED"; text: string }
  | { type: "SELECT"; id: string }
  | { type: "APPROVE" }
  | { type: "REJECT" }
  | { type: "RESET" }
  | { type: "HELP"; userText: string }
  | { type: "ERROR"; userText?: string; text: string };

const MESSAGE_LIMIT = 40;

function nextMessage(state: SessionState, role: ChatMessage["role"], text: string, tone: ChatMessage["tone"]): ChatMessage {
  return { id: `m${state.seq + 1}`, role, text, tone };
}

function withMessages(state: SessionState, ...messages: ChatMessage[]): SessionState {
  return {
    ...state,
    seq: state.seq + messages.length,
    messages: [...state.messages, ...messages].slice(-MESSAGE_LIMIT),
  };
}

export function createInitialSession(): SessionState {
  const tasks = demoCalendar.load().tasks;
  const accepted = solveBaseline(tasks);
  const opening = `ADAPT is Adaptive Daily Planning and Recovery. When life changes, ADAPT recalculates your day instead of making you rebuild it. This is a simulated Alexa+ session. The schedule is sample data, not a live calendar, and it is not connected to an Alexa device.`;
  const present = accepted.placements.find((placement) => placement.taskId === "present");
  const commute = accepted.placements.find((placement) => placement.taskId === "commute");
  const detail = present
    ? `Studio presentation is at ${formatWhen(present.startMin)}. ${commute ? `Commute runs ${formatWhen(commute.startMin)}–${formatWhen(commute.endMin)}.` : ""} The history essay is due tonight at 11:59 PM. Tell me what changed.`
    : "Tell me what changed.";

  const base: SessionState = {
    tasks,
    accepted,
    openingPlacements: accepted.placements.map((placement) => ({ ...placement })),
    proposal: null,
    selectedAlternativeId: null,
    messages: [],
    status: accepted.feasible ? { kind: "idle" } : { kind: "error", text: "The sample day could not be scheduled without a conflict." },
    seq: 0,
    appliedLabels: [],
  };

  return withMessages(
    base,
    nextMessage(base, "adapt", `${opening} ${detail}`.replace(/\s+/g, " "), "neutral"),
  );
}

function fail(state: SessionState, text: string, userText?: string): SessionState {
  const user = userText ? [nextMessage(state, "user", userText, "neutral")] : [];
  const draft = user.length > 0 ? withMessages(state, ...user) : state;
  const adapt = nextMessage(draft, "adapt", text, "error");
  return {
    ...withMessages(draft, adapt),
    status: { kind: "error", text },
  };
}

function acceptedFrom(plan: SolvedPlan): SolvedPlan {
  return {
    ...plan,
    id: "accepted",
    title: "Accepted plan",
    placements: plan.placements.map((placement) => ({ ...placement })),
    conflicts: plan.conflicts.map((conflict) => ({ ...conflict })),
  };
}

export function reducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "HYDRATE":
      return action.state;
    case "STORAGE_INVALID":
      return fail(
        createInitialSession(),
        "The saved demo plan could not be read. I loaded a fresh sample day instead.",
      );
    case "LOADING": {
      if (state.status.kind === "loading") return state;
      if (state.proposal) {
        return fail(
          state,
          "Approve or reject the current recovery before starting another change. The accepted plan was not modified.",
          action.userText,
        );
      }
      return {
        ...withMessages(state, nextMessage(state, "user", action.userText, "neutral")),
        status: { kind: "loading" },
      };
    }
    case "ENGINE_RESULT": {
      if (state.status.kind !== "loading") return state;
      const recommended = action.proposal.alternatives.find((plan) => plan.id === action.proposal.recommendedId);
      const tone = action.proposal.blockedReason || !recommended?.feasible ? "warning" : "neutral";
      const text = `${action.proposal.headline} ${action.proposal.detail}`;
      return {
        ...withMessages(state, nextMessage(state, "adapt", text, tone)),
        proposal: action.proposal,
        selectedAlternativeId: action.proposal.recommendedId,
        status: { kind: "idle" },
      };
    }
    case "ENGINE_FAILED":
      if (state.status.kind !== "loading") return state;
      return fail(state, action.text);
    case "SELECT": {
      if (!state.proposal) return fail(state, "There is no recovery to choose from yet.");
      const exists = state.proposal.alternatives.some((plan) => plan.id === action.id);
      if (!exists) return fail(state, "That option is not in the current recovery.");
      const index = state.proposal.alternatives.findIndex((plan) => plan.id === action.id);
      const plan = state.proposal.alternatives[index];
      return {
        ...withMessages(
          state,
          nextMessage(state, "adapt", `Showing option ${index + 1}: ${plan.title}. The accepted plan is still unchanged.`, "neutral"),
        ),
        selectedAlternativeId: action.id,
        status: { kind: "idle" },
      };
    }
    case "APPROVE": {
      if (!state.proposal || !state.selectedAlternativeId) {
        return fail(state, "There is no recovery waiting for approval. The plan was not changed.");
      }
      const plan = state.proposal.alternatives.find((item) => item.id === state.selectedAlternativeId);
      if (!plan) return fail(state, "The selected recovery is missing. The plan was not changed.");
      if (!plan.feasible) {
        return fail(state, "That recovery still has a conflict, so I did not change the accepted plan.");
      }
      const tasks = commitTasks(state.proposal.tasks, plan);
      const text = `Approved. "${plan.title}" is now the accepted plan.`;
      return {
        ...withMessages(state, nextMessage(state, "adapt", text, "success")),
        tasks,
        accepted: acceptedFrom(plan),
        proposal: null,
        selectedAlternativeId: null,
        status: { kind: "success", text },
        appliedLabels: [...state.appliedLabels, state.proposal.disruption.label],
      };
    }
    case "REJECT": {
      if (!state.proposal) return fail(state, "There is no recovery to reject. The plan was not changed.");
      const text = "Rejected. The accepted plan is unchanged.";
      return {
        ...withMessages(state, nextMessage(state, "adapt", text, "neutral")),
        proposal: null,
        selectedAlternativeId: null,
        status: { kind: "rejected", text },
      };
    }
    case "RESET": {
      const fresh = createInitialSession();
      const text = "Sample day restored. Accepted changes were cleared.";
      return {
        ...withMessages(fresh, nextMessage(fresh, "adapt", text, "success")),
        status: { kind: "success", text },
      };
    }
    case "HELP": {
      const text =
        "I can move the presentation to 11:00 AM, add 30 minutes of traffic, pick up Noah, or add a 90-minute study session before 10:00 PM. Say move gym if necessary while a recovery is open. Then say approve or reject. Say reset to start the demo over.";
      const user = nextMessage(state, "user", action.userText, "neutral");
      const draft = withMessages(state, user);
      return {
        ...withMessages(draft, nextMessage(draft, "adapt", text, "neutral")),
        status: { kind: "idle" },
      };
    }
    case "ERROR":
      return fail(state, action.text, action.userText);
    default:
      return state;
  }
}

export function statusLabel(status: AppStatus): string | null {
  switch (status.kind) {
    case "loading":
      return "Checking deadlines, travel, sleep, and protected commitments.";
    case "success":
    case "rejected":
    case "error":
      return status.text;
    default:
      return null;
  }
}
