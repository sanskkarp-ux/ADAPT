import { propose } from "@/lib/planner";
import type { Disruption, Placement, ProposalResult, Task } from "@/lib/types";

/**
 * Local planning tool.
 * Speaks MCP over Streamable HTTP, protocol 2025-11-25.
 * It calls propose(). It is not connected to an Alexa device or AWS.
 */

export const MCP_PROTOCOL_VERSION = "2025-11-25";

const SUPPORTED_VERSIONS = new Set(["2025-03-26", "2025-06-18", "2025-11-25"]);

const TOOL_NAME = "propose_recovery";

export interface McpHttpResult {
  status: number;
  body: unknown | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rpcError(id: unknown, code: number, message: string): McpHttpResult {
  return { status: 200, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } };
}

export function originAllowed(origin: string | null, host: string | null): boolean {
  if (!origin) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function acceptAllowsStreamable(accept: string | null): boolean {
  if (!accept) return false;
  const value = accept.toLowerCase();
  return value.includes("application/json") && value.includes("text/event-stream");
}

function isTask(value: unknown): value is Task {
  if (!isRecord(value)) return false;
  const flexibility = value.flexibility;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length < 80 &&
    typeof value.title === "string" &&
    typeof value.durationMin === "number" &&
    Number.isFinite(value.durationMin) &&
    typeof value.earliestStartMin === "number" &&
    Array.isArray(value.dependsOn) &&
    (flexibility === "fixed" || flexibility === "protected" || flexibility === "movable")
  );
}

function isPlacement(value: unknown): value is Placement {
  if (!isRecord(value)) return false;
  return (
    typeof value.taskId === "string" &&
    typeof value.startMin === "number" &&
    typeof value.endMin === "number" &&
    typeof value.status === "string" &&
    typeof value.note === "string"
  );
}

function isDisruption(value: unknown): value is Disruption {
  if (!isRecord(value) || typeof value.label !== "string" || value.label.length > 400) return false;
  if (value.type === "move-fixed") {
    return typeof value.taskId === "string" && typeof value.newStartMin === "number";
  }
  if (value.type === "extend-travel") {
    return typeof value.taskId === "string" && typeof value.addMin === "number";
  }
  if (value.type === "add-task") return isTask(value.task);
  return false;
}

function toolDefinition() {
  return {
    name: TOOL_NAME,
    description:
      "Ask the ADAPT scheduler for recovery options. Send the accepted tasks, the current placements, and one normalized disruption. This tool does not read free text and does not connect to an Alexa device.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["tasks", "baseline", "disruption"],
      properties: {
        tasks: { type: "array", description: "Accepted tasks." },
        baseline: { type: "array", description: "Current placements." },
        disruption: {
          type: "object",
          description: "move-fixed, extend-travel, or add-task.",
        },
      },
    },
  };
}

function callTool(args: unknown): { isError: boolean; text: string; proposal?: ProposalResult } {
  if (!isRecord(args)) {
    return { isError: true, text: "propose_recovery needs tasks, baseline, and a disruption." };
  }
  if (!Array.isArray(args.tasks) || args.tasks.length === 0 || args.tasks.length > 40 || !args.tasks.every(isTask)) {
    return { isError: true, text: "tasks must be a list of schedule tasks." };
  }
  if (!Array.isArray(args.baseline) || args.baseline.length > 40 || !args.baseline.every(isPlacement)) {
    return { isError: true, text: "baseline must be a list of placements." };
  }
  if (!isDisruption(args.disruption)) {
    return { isError: true, text: "disruption must be move-fixed, extend-travel, or add-task." };
  }

  try {
    const result = propose(args.tasks, args.disruption, args.baseline);
    if (!result.ok) return { isError: true, text: result.error, proposal: result };
    return { isError: false, text: result.proposal.headline, proposal: result };
  } catch {
    return { isError: true, text: "The scheduler could not read that request." };
  }
}

export function handleMcpMessage(message: unknown, protocolHeader: string | null): McpHttpResult {
  if (!isRecord(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(isRecord(message) ? message.id : null, -32600, "Invalid JSON-RPC request.");
  }

  const hasId = Object.prototype.hasOwnProperty.call(message, "id") && message.id !== null && message.id !== undefined;
  const version = protocolHeader?.trim() || null;
  if (version && !SUPPORTED_VERSIONS.has(version)) {
    return { status: 400, body: { jsonrpc: "2.0", id: hasId ? message.id : null, error: { code: -32000, message: "Unsupported MCP-Protocol-Version." } } };
  }
  if (message.method !== "initialize" && version === null) {
    // Spec: a missing header means assume 2025-03-26, which this server accepts.
  }

  if (!hasId) {
    if (message.method === "notifications/initialized" || message.method.startsWith("notifications/")) {
      return { status: 202, body: null };
    }
    return { status: 400, body: { jsonrpc: "2.0", error: { code: -32600, message: "Notification was not recognized." } } };
  }

  if (message.method === "initialize") {
    const params = isRecord(message.params) ? message.params : {};
    const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
    if (!SUPPORTED_VERSIONS.has(requested)) {
      return rpcError(message.id, -32602, `Unsupported protocol version. This server uses ${MCP_PROTOCOL_VERSION}.`);
    }
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "adapt-planning-tool", version: "1.0.0" },
          instructions:
            "Local ADAPT planning tool. It proposes schedule recoveries from normalized disruptions. It is not an Alexa device.",
        },
      },
    };
  }

  if (message.method === "tools/list") {
    return { status: 200, body: { jsonrpc: "2.0", id: message.id, result: { tools: [toolDefinition()] } } };
  }

  if (message.method === "ping") {
    return { status: 200, body: { jsonrpc: "2.0", id: message.id, result: {} } };
  }

  if (message.method === "tools/call") {
    const params = isRecord(message.params) ? message.params : null;
    if (!params || params.name !== TOOL_NAME) {
      return rpcError(message.id, -32602, "Unknown tool. This server offers propose_recovery.");
    }
    const called = callTool(params.arguments);
    return {
      status: 200,
      body: {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [{ type: "text", text: called.text }],
          structuredContent: called.proposal ?? null,
          isError: called.isError,
        },
      },
    };
  }

  return rpcError(message.id, -32601, `Method not found: ${message.method}`);
}
