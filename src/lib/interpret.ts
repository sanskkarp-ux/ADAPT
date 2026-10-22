import type { SampleId } from "@/lib/demo-data";
import { parseCommand } from "@/lib/parse-command";
import { at } from "@/lib/time";
import type { Disruption, Task } from "@/lib/types";

/**
 * Turns a sentence into a structured request.
 * This runs before the planner. The planner never reads raw text.
 */

const SAMPLE_UNDERSTOOD: Record<SampleId, string> = {
  presentation: "Studio presentation moved to 11:00 AM.",
  traffic: "Traffic adds 30 minutes to the commute.",
  pickup: "Pick up Noah at the station.",
};

export type ScheduleRequest =
  | {
      kind: "review";
      command: "approve" | "reject" | "reset" | "help" | "select";
      index?: number;
    }
  | {
      kind: "sample";
      id: SampleId;
      understood: string;
    }
  | {
      kind: "disruption";
      disruption: Disruption;
      understood: string;
    }
  | {
      kind: "prefer-move";
      taskQuery: string;
      understood: string;
    }
  | { kind: "invalid"; message: string }
  | { kind: "unknown" };

function normalize(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ");
}

export function studySessionTask(): Task {
  return {
    id: "study",
    title: "Study session",
    detail: "Added from your request. Ninety minutes, finished before 10:00 PM. Not a live calendar event.",
    durationMin: 90,
    priority: "high",
    flexibility: "movable",
    category: "focus",
    earliestStartMin: at(0, 16, 0),
    latestEndMin: at(0, 22, 0),
    deadlineMin: at(0, 22, 0),
    pinnedStartMin: null,
    dependsOn: [],
    location: "Dorm desk",
  };
}

export function interpretRequest(input: string, tasks: Task[]): ScheduleRequest {
  const parsed = parseCommand(input);
  if (parsed.type === "sample") {
    return { kind: "sample", id: parsed.id, understood: SAMPLE_UNDERSTOOD[parsed.id] };
  }
  if (parsed.type === "select") {
    return { kind: "review", command: "select", index: parsed.index };
  }
  if (parsed.type !== "unknown") {
    return { kind: "review", command: parsed.type };
  }

  const text = normalize(input);
  if (!text) return { kind: "unknown" };

  if (/\b(study session|study block)\b/.test(text) && /\b(90|ninety)\b/.test(text)) {
    if (tasks.some((task) => task.id === "study")) {
      return { kind: "invalid", message: "A study session is already on the accepted plan. The plan was not changed." };
    }
    return {
      kind: "disruption",
      understood: "Add a 90-minute study session before 10:00 PM.",
      disruption: {
        type: "add-task",
        task: studySessionTask(),
        label: "A 90-minute study session is added, and it must finish before 10:00 PM.",
      },
    };
  }

  if (/\b(study session|study block)\b/.test(text)) {
    return {
      kind: "invalid",
      message: "Tell me the length. For example: add a 90 minute study session before 10 PM. The plan was not changed.",
    };
  }

  if (/\bgym\b/.test(text) && /\b(move|reschedule|shift)\b/.test(text)) {
    return {
      kind: "prefer-move",
      taskQuery: "gym",
      understood: "Move the gym session if a recovery needs that time.",
    };
  }

  return { kind: "unknown" };
}
