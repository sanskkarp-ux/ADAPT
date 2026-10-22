import { MCP_PROTOCOL_VERSION } from "@/lib/mcp/protocol";
import type { Disruption, Placement, Proposal, Task } from "@/lib/types";

/**
 * Browser-side MCP client for the local planning tool.
 * It sends initialize, tools/list, and tools/call over Streamable HTTP.
 * No secret is read here.
 */

export type PlannerChannel = "mcp" | "builtin";

export type McpProposalResult =
  | { ok: true; proposal: Proposal; channel: "mcp" }
  | { ok: false; reason: "off" | "unavailable" | "invalid" | "error"; message: string };

export function resolveMcpEndpoint(envValue: string | undefined): { mode: "default" | "custom" | "off"; url: string | null } {
  if (envValue == null) return { mode: "default", url: "/api/mcp" };
  const value = envValue.trim();
  if (value === "" || value === "off" || value === "0" || value === "false") return { mode: "off", url: null };
  return { mode: "custom", url: value };
}

interface RpcOk {
  jsonrpc: "2.0";
  id?: unknown;
  result?: unknown;
  error?: { message?: string };
}

async function postRpc(
  url: string,
  message: Record<string, unknown>,
  fetchImpl: typeof fetch,
  protocolHeader: boolean,
): Promise<{ status: number; body: RpcOk | null }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (protocolHeader) headers["mcp-protocol-version"] = MCP_PROTOCOL_VERSION;
  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
  });
  if (response.status === 202) return { status: 202, body: null };
  const body = (await response.json()) as RpcOk;
  return { status: response.status, body };
}

export async function proposeViaMcp(
  tasks: Task[],
  baseline: Placement[],
  disruption: Disruption,
  options?: { envValue?: string; fetchImpl?: typeof fetch },
): Promise<McpProposalResult> {
  const endpoint = resolveMcpEndpoint(options?.envValue ?? process.env.NEXT_PUBLIC_ADAPT_MCP_URL);
  if (endpoint.mode === "off" || !endpoint.url) {
    return { ok: false, reason: "off", message: "The planning tool is turned off." };
  }
  const fetchImpl = options?.fetchImpl ?? fetch;
  const url = endpoint.url;

  try {
    const initialized = await postRpc(
      url,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "adapt-web", version: "1.0.0" },
        },
      },
      fetchImpl,
      false,
    );
    if (initialized.status !== 200 || !initialized.body || initialized.body.error) {
      return { ok: false, reason: "unavailable", message: "The planning tool did not accept initialize." };
    }

    const noted = await postRpc(url, { jsonrpc: "2.0", method: "notifications/initialized" }, fetchImpl, true);
    if (noted.status !== 202) {
      return { ok: false, reason: "unavailable", message: "The planning tool did not accept the initialized notification." };
    }

    const listed = await postRpc(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, fetchImpl, true);
    const tools = listed.body && isRecord(listed.body.result) ? listed.body.result.tools : null;
    const names = Array.isArray(tools)
      ? tools.filter(isRecord).map((tool) => tool.name)
      : [];
    if (!names.includes("propose_recovery")) {
      return { ok: false, reason: "unavailable", message: "The planning tool did not offer propose_recovery." };
    }

    const called = await postRpc(
      url,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "propose_recovery", arguments: { tasks, baseline, disruption } },
      },
      fetchImpl,
      true,
    );
    const result = called.body && isRecord(called.body.result) ? called.body.result : null;
    if (!result) {
      return { ok: false, reason: "error", message: "The planning tool returned an empty result." };
    }
    if (result.isError === true) {
      const text = Array.isArray(result.content) && isRecord(result.content[0]) ? String(result.content[0].text ?? "") : "";
      return { ok: false, reason: "error", message: text || "The planning tool rejected the request." };
    }
    const structured = isRecord(result.structuredContent) ? result.structuredContent : null;
    if (!structured || structured.ok !== true || !isRecord(structured.proposal)) {
      return { ok: false, reason: "invalid", message: "The planning tool response was not a schedule." };
    }
    const proposal = structured.proposal as unknown as Proposal;
    if (!Array.isArray(proposal.alternatives) || typeof proposal.recommendedId !== "string") {
      return { ok: false, reason: "invalid", message: "The planning tool response was missing recoveries." };
    }
    return { ok: true, proposal, channel: "mcp" };
  } catch {
    return { ok: false, reason: "unavailable", message: "The planning tool could not be reached." };
  }
}

/** True only when initialize and tools/list succeed. A turned-off tool returns false. */
export async function probeMcp(options?: { envValue?: string; fetchImpl?: typeof fetch }): Promise<boolean> {
  const endpoint = resolveMcpEndpoint(options?.envValue ?? process.env.NEXT_PUBLIC_ADAPT_MCP_URL);
  if (!endpoint.url) return false;
  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const initialized = await postRpc(
      endpoint.url,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "adapt-web", version: "1.0.0" },
        },
      },
      fetchImpl,
      false,
    );
    if (initialized.status !== 200 || initialized.body?.error) return false;
    const listed = await postRpc(
      endpoint.url,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      fetchImpl,
      true,
    );
    const tools = listed.body && isRecord(listed.body.result) ? listed.body.result.tools : null;
    return Array.isArray(tools) && tools.some((tool) => isRecord(tool) && tool.name === "propose_recovery");
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
