import { acceptAllowsStreamable, handleMcpMessage, originAllowed } from "@/lib/mcp/protocol";

export const runtime = "nodejs";

const MAX_BYTES = 300_000;

function denied(message: string, status: number): Response {
  return Response.json({ jsonrpc: "2.0", error: { code: -32000, message } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request.headers.get("origin"), request.headers.get("host"))) {
    return denied("Origin not allowed.", 403);
  }
  if (!acceptAllowsStreamable(request.headers.get("accept"))) {
    return denied("Accept must include application/json and text/event-stream.", 400);
  }

  const text = await request.text();
  if (text.length > MAX_BYTES) return denied("Payload too large.", 413);

  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return denied("Invalid JSON.", 400);
  }
  if (Array.isArray(message)) return denied("Batch messages are not accepted.", 400);

  const result = handleMcpMessage(message, request.headers.get("mcp-protocol-version"));
  if (result.body == null) return new Response(null, { status: result.status });
  return Response.json(result.body, { status: result.status });
}

export function GET(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export function DELETE(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
