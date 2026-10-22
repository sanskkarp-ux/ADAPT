import type { SampleId } from "@/lib/demo-data";

export type ParsedCommand =
  | { type: "sample"; id: SampleId }
  | { type: "approve" }
  | { type: "reject" }
  | { type: "reset" }
  | { type: "help" }
  | { type: "select"; index: number }
  | { type: "unknown" };

export const COMMAND_HINT =
  "Try: the presentation moved to 11, traffic is 30 minutes worse, pick up Noah, add a 90 minute study session before 10 PM, move gym if necessary, approve, reject, or reset.";

function normalize(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Recognizes the demo's supported sentences.
 * This is a phrase list, not a general language model.
 */
export function parseCommand(input: string): ParsedCommand {
  const text = normalize(input);
  if (!text) return { type: "unknown" };

  if (/^(help|commands|what can i say|what can you do)$/.test(text)) return { type: "help" };
  if (/^(approve|approved|yes|apply|accept)( (it|this|changes|the plan|this plan))?$/.test(text) || text === "approve changes") {
    return { type: "approve" };
  }
  if (/^(reject|rejected|no|cancel|discard|never mind|nevermind)$/.test(text)) return { type: "reject" };
  if (/^(reset|start over|start again|reset demo|reset the demo|reset sample day)$/.test(text)) {
    return { type: "reset" };
  }
  if (/\b(option|plan|alternative|choice)\s*2\b/.test(text) || /\b(second one|second plan|second option)\b/.test(text)) {
    return { type: "select", index: 1 };
  }
  if (/\b(option|plan|alternative|choice)\s*3\b/.test(text) || /\bthird (one|plan|option)\b/.test(text)) {
    return { type: "select", index: 2 };
  }
  if (/\b(option|plan|alternative|choice)\s*1\b/.test(text) || /\bfirst (plan|option|one)\b/.test(text)) {
    return { type: "select", index: 0 };
  }

  const mentionsPresentation = /\b(presentation|studio)\b/.test(text);
  const mentionsEleven = /\b(11|11:00|11am|eleven)\b/.test(text);
  if (mentionsPresentation && mentionsEleven) return { type: "sample", id: "presentation" };

  const mentionsTravel = /\b(traffic|commute|drive|driving)\b/.test(text);
  const mentionsExtraTime = /\b(30|thirty|half an hour|longer|extra|delay|delayed)\b/.test(text);
  if (mentionsTravel && mentionsExtraTime) return { type: "sample", id: "traffic" };

  if (/\b(pick up|pickup|picking up|noah|station)\b/.test(text)) return { type: "sample", id: "pickup" };

  return { type: "unknown" };
}
