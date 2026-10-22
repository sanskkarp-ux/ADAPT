import { at } from "@/lib/time";
import { cloneTask } from "@/lib/tasks";
import type { Disruption, Task } from "@/lib/types";

export { cloneTask };

/**
 * Sample day for a college student.
 * Nothing here comes from a calendar, map, or weather service.
 * Wednesday evening is "tonight." Thursday morning is "tomorrow."
 */
export const DEMO_REVISION = 1;

export const DEMO_DISCLAIMER =
  "Sample scenario. Not live calendar, traffic, or weather data. This demo is not connected to Alexa or any Amazon device.";

const TASKS: Task[] = [
  {
    id: "essay",
    title: "History essay",
    detail: "Due tonight at 11:59 PM. Needs one uninterrupted block.",
    durationMin: 120,
    priority: "critical",
    flexibility: "movable",
    category: "focus",
    earliestStartMin: at(0, 16, 0),
    latestEndMin: at(0, 23, 59),
    deadlineMin: at(0, 23, 59),
    pinnedStartMin: null,
    dependsOn: [],
    location: "Dorm desk",
  },
  {
    id: "prep",
    title: "Presentation rehearsal",
    detail: "Ninety minutes of practice. Must finish before you leave campus.",
    durationMin: 90,
    priority: "critical",
    flexibility: "movable",
    category: "focus",
    earliestStartMin: at(0, 16, 0),
    latestEndMin: null,
    deadlineMin: null,
    pinnedStartMin: null,
    dependsOn: [],
    finishBeforeTaskId: "commute",
    location: "Dorm",
  },
  {
    id: "dinner",
    title: "Dinner",
    detail: "Preferred between 6:00 and 8:15 PM. Can slide if a deadline is at risk.",
    durationMin: 45,
    priority: "low",
    flexibility: "movable",
    category: "personal",
    earliestStartMin: at(0, 17, 30),
    latestEndMin: at(0, 22, 30),
    preferStartMin: at(0, 18, 0),
    preferEndMin: at(0, 20, 15),
    deadlineMin: null,
    pinnedStartMin: null,
    dependsOn: [],
    location: "Dining hall",
  },
  {
    id: "cards",
    title: "Flashcards",
    detail: "Optional review. Useful, but it can leave the plan.",
    durationMin: 40,
    priority: "low",
    flexibility: "movable",
    category: "focus",
    earliestStartMin: at(0, 16, 0),
    latestEndMin: at(0, 23, 0),
    deadlineMin: null,
    pinnedStartMin: null,
    dependsOn: [],
    optional: true,
    location: "Dorm",
  },
  {
    id: "sleep",
    title: "Sleep",
    detail: "Protected rest. ADAPT will not schedule through it.",
    durationMin: 450,
    priority: "critical",
    flexibility: "protected",
    category: "rest",
    earliestStartMin: at(0, 22, 0),
    latestEndMin: at(1, 8, 0),
    deadlineMin: null,
    pinnedStartMin: at(0, 23, 0),
    dependsOn: [],
    location: "Dorm",
  },
  {
    id: "routine",
    title: "Morning routine",
    detail: "Shower, dress, and pack. Happens after sleep and before you leave.",
    durationMin: 30,
    priority: "medium",
    flexibility: "movable",
    category: "personal",
    earliestStartMin: at(1, 6, 30),
    latestEndMin: at(1, 12, 0),
    deadlineMin: null,
    pinnedStartMin: null,
    dependsOn: ["sleep"],
    finishBeforeTaskId: "commute",
    location: "Dorm",
  },
  {
    id: "print",
    title: "Print slides",
    detail: "Twenty minutes at home. Must be done before the commute.",
    durationMin: 20,
    priority: "high",
    flexibility: "movable",
    category: "focus",
    earliestStartMin: at(1, 6, 30),
    latestEndMin: at(1, 12, 0),
    deadlineMin: null,
    pinnedStartMin: null,
    dependsOn: ["sleep"],
    finishBeforeTaskId: "commute",
    location: "Home printer",
  },
  {
    id: "gym",
    title: "Gym session",
    detail: "Optional. Prefer to finish before 8:00 AM, otherwise it can move or drop.",
    durationMin: 40,
    priority: "low",
    flexibility: "movable",
    category: "personal",
    earliestStartMin: at(1, 6, 30),
    latestEndMin: at(1, 14, 30),
    preferLatestStartMin: at(1, 8, 0),
    deadlineMin: null,
    pinnedStartMin: null,
    dependsOn: ["sleep"],
    optional: true,
    location: "Campus gym",
  },
  {
    id: "commute",
    title: "Commute to campus",
    detail: "Sample travel time of 45 minutes, plus a 15-minute arrival buffer. Not live traffic.",
    durationMin: 45,
    priority: "critical",
    flexibility: "movable",
    category: "travel",
    earliestStartMin: at(1, 6, 30),
    latestEndMin: null,
    deadlineMin: null,
    pinnedStartMin: null,
    dependsOn: ["sleep"],
    arrivesBeforeTaskId: "present",
    arrivalBufferMin: 15,
    location: "Dorm to campus",
  },
  {
    id: "present",
    title: "Studio presentation",
    detail: "Fixed appointment in Studio 204. It moves only when you report a new time.",
    durationMin: 60,
    priority: "critical",
    flexibility: "fixed",
    category: "commitment",
    earliestStartMin: at(1, 8, 0),
    latestEndMin: at(1, 15, 0),
    deadlineMin: null,
    pinnedStartMin: at(1, 9, 0),
    dependsOn: [],
    onCampus: true,
    location: "Studio 204",
  },
  {
    id: "seminar",
    title: "Required seminar",
    detail: "Protected. ADAPT will not move or shorten it unless you approve that alternative.",
    durationMin: 60,
    priority: "high",
    flexibility: "protected",
    category: "commitment",
    earliestStartMin: at(1, 8, 0),
    latestEndMin: at(1, 15, 0),
    deadlineMin: null,
    pinnedStartMin: at(1, 10, 15),
    dependsOn: [],
    onCampus: true,
    location: "Hall B",
  },
  {
    id: "standup",
    title: "Project standup",
    detail: "Starts after the presentation. The time can move.",
    durationMin: 45,
    priority: "medium",
    flexibility: "movable",
    category: "commitment",
    earliestStartMin: at(1, 10, 0),
    latestEndMin: at(1, 15, 0),
    deadlineMin: null,
    pinnedStartMin: null,
    dependsOn: ["present"],
    onCampus: true,
    location: "Lab 3",
  },
  {
    id: "lunch",
    title: "Lunch",
    detail: "Optional. Fits wherever the afternoon is open.",
    durationMin: 40,
    priority: "low",
    flexibility: "movable",
    category: "personal",
    earliestStartMin: at(1, 11, 30),
    latestEndMin: at(1, 14, 30),
    deadlineMin: null,
    pinnedStartMin: null,
    dependsOn: [],
    optional: true,
    location: "Campus",
  },
];

export function demoTasks(): Task[] {
  return TASKS.map(cloneTask);
}

export function pickupTask(): Task {
  return {
    id: "pickup",
    title: "Pick up Noah",
    detail: "Sample errand at Central Station. The train window is 5:00–6:30 PM. Not a live calendar event.",
    durationMin: 30,
    priority: "high",
    flexibility: "movable",
    category: "personal",
    earliestStartMin: at(0, 17, 0),
    latestEndMin: at(0, 18, 30),
    deadlineMin: at(0, 18, 30),
    pinnedStartMin: null,
    dependsOn: [],
    location: "Central Station",
  };
}

export type SampleId = "presentation" | "traffic" | "pickup";

export function makeDisruption(
  id: SampleId,
  tasks: Task[],
): { ok: true; disruption: Disruption } | { ok: false; error: string } {
  if (id === "presentation") {
    const presentation = tasks.find((task) => task.id === "present");
    if (!presentation || presentation.pinnedStartMin == null) {
      return { ok: false, error: "The sample day has no studio presentation to move." };
    }
    const nextStart = at(1, 11, 0);
    if (presentation.pinnedStartMin === nextStart) {
      return {
        ok: false,
        error: "The presentation is already at 11:00 AM on the accepted plan.",
      };
    }
    return {
      ok: true,
      disruption: {
        type: "move-fixed",
        taskId: "present",
        newStartMin: nextStart,
        label: "The studio presentation moves to 11:00 AM.",
      },
    };
  }

  if (id === "traffic") {
    const commute = tasks.find((task) => task.id === "commute");
    if (!commute) {
      return { ok: false, error: "The sample day has no commute to extend." };
    }
    if (commute.durationMin >= 75) {
      return {
        ok: false,
        error: `Traffic is already on the accepted plan. The commute is ${commute.durationMin} minutes.`,
      };
    }
    return {
      ok: true,
      disruption: {
        type: "extend-travel",
        taskId: "commute",
        addMin: 30,
        label: "Sample traffic adds 30 minutes to the commute. This is not a live traffic report.",
      },
    };
  }

  if (tasks.some((task) => task.id === "pickup")) {
    return { ok: false, error: "Noah's pickup is already on the accepted plan." };
  }
  return {
    ok: true,
    disruption: {
      type: "add-task",
      task: pickupTask(),
      label: "An unexpected errand is added: pick up Noah at Central Station, 5:00–5:30 PM.",
    },
  };
}
