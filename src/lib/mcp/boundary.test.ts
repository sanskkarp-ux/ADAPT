import { describe, expect, it } from "vitest";
import { demoTasks, makeDisruption } from "@/lib/demo-data";
import { proposeViaMcp, probeMcp, resolveMcpEndpoint } from "@/lib/mcp/client";
import { acceptAllowsStreamable, handleMcpMessage, MCP_PROTOCOL_VERSION, originAllowed } from "@/lib/mcp/protocol";
import { propose, solveBaseline } from "@/lib/planner";
import { at } from "@/lib/time";
import type { Disruption } from "@/lib/types";

const ACCEPT = "application/json, text/event-stream";

function rpc(body: unknown): { status: number; json: Record<string, unknown> | null } {
  const result = handleMcpMessage(body, MCP_PROTOCOL_VERSION);
  return { status: result.status, json: result.body as Record<string, unknown> | null };
}

describe("MCP endpoint rules", () => {
  it("allows a missing origin and rejects a foreign origin", () => {
    expect(originAllowed(null, "localhost:3000")).toBe(true);
    expect(originAllowed("http://localhost:3000", "localhost:3000")).toBe(true);
    expect(originAllowed("https://evil.example", "localhost:3000")).toBe(false);
  });

  it("requires both accepted content types", () => {
    expect(acceptAllowsStreamable(ACCEPT)).toBe(true);
    expect(acceptAllowsStreamable("application/json")).toBe(false);
  });

  it("rejects an unsupported protocol version", () => {
    const result = handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      "1999-01-01",
    );
    expect(result.status).toBe(400);
  });
});

describe("MCP planning tool", () => {
  const tasks = demoTasks();
  const baseline = solveBaseline(tasks).placements;
  const made = makeDisruption("presentation", tasks);
  if (!made.ok) throw new Error(made.error);
  const disruption = made.disruption;

  it("answers initialize, lists propose_recovery, and returns the same seminar plan", () => {
    const init = rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "test", version: "1" } },
    });
    expect(init.status).toBe(200);
    expect(init.json?.result).toMatchObject({ protocolVersion: MCP_PROTOCOL_VERSION });

    const noted = handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, MCP_PROTOCOL_VERSION);
    expect(noted.status).toBe(202);
    expect(noted.body).toBeNull();

    const listed = rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const tools = (listed.json?.result as { tools: { name: string }[] }).tools;
    expect(tools.map((tool) => tool.name)).toContain("propose_recovery");

    const called = rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "propose_recovery", arguments: { tasks, baseline, disruption } },
    });
    const result = called.json?.result as {
      isError: boolean;
      structuredContent: { ok: boolean; proposal: { recommendedId: string; alternatives: { id: string; placements: { taskId: string; startMin: number; endMin: number }[] }[] } };
    };
    expect(result.isError).toBe(false);
    const direct = propose(tasks, disruption, baseline);
    if (!direct.ok) throw new Error(direct.error);
    const fromTool = result.structuredContent.proposal.alternatives.find(
      (plan) => plan.id === result.structuredContent.proposal.recommendedId,
    );
    const seminar = fromTool?.placements.find((placement) => placement.taskId === "seminar");
    expect(seminar?.startMin).toBe(at(1, 12, 0));
    expect(seminar && seminar.endMin - seminar.startMin).toBe(60);
    expect(result.structuredContent.proposal.recommendedId).toBe(direct.proposal.recommendedId);
  });

  it("reports an invalid disruption without inventing a schedule", () => {
    const called = rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "propose_recovery", arguments: { tasks, baseline, disruption: { type: "nope" } } },
    });
    const result = called.json?.result as { isError: boolean; structuredContent: unknown };
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeNull();
  });

  it("reports a provider error when the disruption does not apply", () => {
    const duplicate: Disruption = { type: "move-fixed", taskId: "missing", newStartMin: at(1, 11, 0), label: "Missing." };
    const called = rpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "propose_recovery", arguments: { tasks, baseline, disruption: duplicate } },
    });
    const result = called.json?.result as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text.length).toBeGreaterThan(0);
  });
});

describe("MCP client", () => {
  it("uses the built-in endpoint when no environment variable is set", () => {
    expect(resolveMcpEndpoint(undefined)).toEqual({ mode: "default", url: "/api/mcp" });
  });

  it("treats an explicit off switch as unavailable and does not call the network", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      throw new Error("should not be called");
    };
    const result = await proposeViaMcp([], [], { type: "extend-travel", taskId: "commute", addMin: 30, label: "x" }, {
      envValue: "off",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("off");
    expect(called).toBe(false);
    expect(await probeMcp({ envValue: "", fetchImpl })).toBe(false);
  });

  it("returns unavailable when the server cannot be reached", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("offline");
    };
    const result = await proposeViaMcp([], [], { type: "extend-travel", taskId: "commute", addMin: 30, label: "x" }, {
      envValue: "http://planning-tool.test/mcp",
      fetchImpl,
    });
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("reads a successful tool response and surfaces a tool error", async () => {
    const tasks = demoTasks();
    const baseline = solveBaseline(tasks).placements;
    const made = makeDisruption("traffic", tasks);
    if (!made.ok) throw new Error(made.error);
    const direct = propose(tasks, made.disruption, baseline);
    if (!direct.ok) throw new Error(direct.error);

    const fetchImpl = mockFetch(async (body) => {
      const message = JSON.parse(body) as { method: string; id?: number };
      if (message.method === "notifications/initialized") return { status: 202, json: null };
      if (message.method === "initialize") {
        return { status: 200, json: { jsonrpc: "2.0", id: message.id, result: { protocolVersion: MCP_PROTOCOL_VERSION } } };
      }
      if (message.method === "tools/list") {
        return { status: 200, json: { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "propose_recovery" }] } } };
      }
      return {
        status: 200,
        json: {
          jsonrpc: "2.0",
          id: message.id,
          result: { isError: false, structuredContent: direct, content: [{ type: "text", text: direct.proposal.headline }] },
        },
      };
    });

    const ok = await proposeViaMcp(tasks, baseline, made.disruption, {
      envValue: "http://planning-tool.test/mcp",
      fetchImpl,
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.channel).toBe("mcp");
    expect(ok.proposal.recommendedId).toBe(direct.proposal.recommendedId);

    const failing = mockFetch(async (body) => {
      const message = JSON.parse(body) as { method: string; id?: number };
      if (message.method === "notifications/initialized") return { status: 202, json: null };
      if (message.method === "initialize") {
        return { status: 200, json: { jsonrpc: "2.0", id: message.id, result: {} } };
      }
      if (message.method === "tools/list") {
        return { status: 200, json: { jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "propose_recovery" }] } } };
      }
      return {
        status: 200,
        json: { jsonrpc: "2.0", id: message.id, result: { isError: true, content: [{ type: "text", text: "Bad request." }], structuredContent: null } },
      };
    });
    const error = await proposeViaMcp(tasks, baseline, made.disruption, {
      envValue: "http://planning-tool.test/mcp",
      fetchImpl: failing,
    });
    expect(error).toMatchObject({ ok: false, reason: "error", message: "Bad request." });
  });
});

function mockFetch(handler: (body: string) => Promise<{ status: number; json: unknown }>): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const answered = await handler(String(init?.body ?? ""));
    return {
      status: answered.status,
      json: async () => answered.json,
    } as Response;
  }) as typeof fetch;
}
