import { demoTasks, makeDisruption, type SampleId } from "@/lib/demo-data";
import { parseCommand, type ParsedCommand } from "@/lib/parse-command";
import type { Disruption, Task } from "@/lib/types";

/**
 * The planner accepts normalized tasks and a Disruption.
 * These providers are the only place demo facts enter that pipeline.
 *
 * Nothing here calls Alexa, AWS, a calendar API, or live traffic.
 * `connected` is false on every demo provider so the UI cannot claim a live link.
 *
 * The local planning tool that speaks MCP lives in src/lib/mcp and
 * src/app/api/mcp/route.ts. It calls propose() and is not an Alexa device.
 *
 * Still open, and not connected:
 * - Calendar: replace `demoCalendar.load()` with a provider that returns Task[].
 * - Traffic: replace `demoTraffic.sampleDelay()` with a provider that returns added minutes.
 * - A device interpreter: replace `demoInterpreter` only if a real assistant returns
 *   a ParsedCommand or a Disruption. Do not let that tool invent clock times.
 */

export interface CalendarSnapshot {
  source: "demo" | "external-calendar";
  connected: false;
  tasks: Task[];
}

export interface CalendarProvider {
  readonly id: "demo-calendar";
  readonly connected: false;
  load(): CalendarSnapshot;
}

export interface TrafficDelay {
  source: "demo" | "external-traffic";
  connected: false;
  travelTaskId: string;
  addedMinutes: number;
  summary: string;
}

export interface TrafficProvider {
  readonly id: "demo-traffic";
  readonly connected: false;
  /** Sample delay only. Returns null when the sample commute is already extended. */
  sampleDelay(tasks: Task[]): TrafficDelay | null;
}

export interface InterpretedRequest {
  source: "demo-phrases" | "external-assistant";
  connected: false;
  command: ParsedCommand;
}

export interface RequestInterpreter {
  readonly id: "demo-phrases";
  readonly connected: false;
  interpret(text: string): InterpretedRequest;
}

export const demoCalendar: CalendarProvider = {
  id: "demo-calendar",
  connected: false,
  load() {
    return { source: "demo", connected: false, tasks: demoTasks() };
  },
};

export const demoTraffic: TrafficProvider = {
  id: "demo-traffic",
  connected: false,
  sampleDelay(tasks) {
    const commute = tasks.find((task) => task.category === "travel" && task.arrivesBeforeTaskId);
    if (!commute || commute.durationMin >= 75) return null;
    return {
      source: "demo",
      connected: false,
      travelTaskId: commute.id,
      addedMinutes: 30,
      summary: "Sample traffic adds 30 minutes to the commute. This is not a live traffic report.",
    };
  },
};

export const demoInterpreter: RequestInterpreter = {
  id: "demo-phrases",
  connected: false,
  interpret(text) {
    return { source: "demo-phrases", connected: false, command: parseCommand(text) };
  },
};

/** Turn a traffic notice into the disruption the planner already understands. */
export function disruptionFromTraffic(delay: TrafficDelay): Disruption {
  return {
    type: "extend-travel",
    taskId: delay.travelTaskId,
    addMin: delay.addedMinutes,
    label: delay.summary,
  };
}

/**
 * Demo button path. A new sample button should return one of the existing
 * disruption types. The planner does not need a new scheduling pass for that.
 */
export function disruptionForSample(
  id: SampleId,
  tasks: Task[],
): { ok: true; disruption: Disruption } | { ok: false; error: string } {
  return makeDisruption(id, tasks);
}
