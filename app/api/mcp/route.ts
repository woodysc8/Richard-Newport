import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FinancialContextQuery = Record<string, string | undefined>;

function hasValidMcpKey(request: NextRequest): boolean {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?? request.nextUrl.searchParams.get("key");
  const expected = process.env.MCP_SERVER_API_KEY;

  if (!token || !expected || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function failedFinancialDataResult() {
  return {
    content: [{ type: "text" as const, text: "failed to fetch financial data" }],
    isError: true,
  };
}

async function fetchFinancialContext(request: NextRequest, query: FinancialContextQuery = {}) {
  const url = new URL("/api/financial-context", request.nextUrl.origin);
  for (const [key, value] of Object.entries(query)) {
    if (value != null) url.searchParams.set(key, value);
  }

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function contextTool(request: NextRequest, query: FinancialContextQuery = {}) {
  return async () => {
    const payload = await fetchFinancialContext(request, query);
    return payload == null
      ? failedFinancialDataResult()
      : { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
  };
}

function createMcpServer(request: NextRequest) {
  const server = new McpServer({ name: "perfi-financial-context", version: "1.0.0" });

  server.registerTool("get_net_worth", {
    description: "Get current net worth, cash, credit-card debt, and investments. Use for balance-summary questions; it does not include accounts or transaction-level detail.",
  }, contextTool(request, { scope: "networth" }));

  server.registerTool("get_monthly_budget", {
    description: "Get this month's canonical income, gross spending, net personal spending, refunds, transfers, credit-card payments, and spending categories. Use for monthly budget questions.",
  }, contextTool(request, { scope: "monthly" }));

  server.registerTool("get_investments", {
    description: "Get the canonical investment total and current holdings. Set includeSnapshots only when historical investment snapshots are needed.",
    inputSchema: {
      includeSnapshots: z.boolean().optional().describe("Include historical investment snapshots when true."),
    },
  }, async ({ includeSnapshots }) => {
    const payload = await fetchFinancialContext(request, {
      scope: "investments",
      includeSnapshots: includeSnapshots ? "true" : undefined,
    });
    return payload == null
      ? failedFinancialDataResult()
      : { content: [{ type: "text", text: JSON.stringify(payload) }] };
  });

  server.registerTool("get_recent_transactions", {
    description: "Get recent transaction records only. Use for merchant, date, amount, pending-status, or transaction-level questions; do not use for net worth or budget summaries.",
    inputSchema: {
      limit: z.number().int().min(1).optional().describe("Maximum records to return; defaults to 50 and is capped at 200."),
    },
  }, async ({ limit }) => {
    const transactionLimit = Math.min(limit ?? 50, 200);
    const payload = await fetchFinancialContext(request, {
      scope: "transactions",
      transactionLimit: String(transactionLimit),
    });
    return payload == null
      ? failedFinancialDataResult()
      : { content: [{ type: "text", text: JSON.stringify(payload) }] };
  });

  server.registerTool("get_rewards", {
    description: "Get Bilt Points, Bilt Cash, and Barclays Points balances. Unavailable balances are returned as null, never zero.",
  }, contextTool(request, { scope: "rewards" }));

  server.registerTool("get_full_snapshot", {
    description: "Get the complete financial context across net worth, accounts, investments, monthly spending, transactions, rewards, and freshness. Use only when a question genuinely spans multiple domains; prefer the narrower scoped tools by default.",
  }, contextTool(request));

  return server;
}

async function handleMcpRequest(request: NextRequest) {
  if (!hasValidMcpKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createMcpServer(request);
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch {
    return NextResponse.json({ error: "failed to fetch financial data" }, { status: 500 });
  }
}

export const POST = handleMcpRequest;
export const GET = handleMcpRequest;
export const DELETE = handleMcpRequest;
