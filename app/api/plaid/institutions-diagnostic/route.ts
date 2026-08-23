import { NextResponse } from "next/server";
import { Configuration, PlaidApi } from "plaid";

const configuration = new Configuration({
  basePath:
    process.env.PLAID_ENV === "production"
      ? "https://production.plaid.com"
      : "https://sandbox.plaid.com",
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
      "PLAID-SECRET": process.env.PLAID_SECRET!,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

const QUERIES = ["Bilt", "Barclays", "Venmo", "Robinhood"];

function sanitizeInstitution(inst: any) {
  return {
    name: inst.name,
    institution_id: inst.institution_id,
    products: inst.products ?? [],
    country_codes: inst.country_codes ?? [],
    oauth: inst.oauth ?? false,
    primary_routing_number: inst.primary_routing_number ?? null,
  };
}

export async function GET() {
  try {
    const results: Record<string, any> = {};

    for (const q of QUERIES) {
      try {
        // Use the expected request shape: query + country_codes; avoid sending an empty products array
        const reqBody = {
          query: q,
          country_codes: ["US"],
          // options: { include_optional_metadata: true } // optional
        };

        const resp = await plaidClient.institutionsSearch(reqBody as any);

        const institutions = resp.data?.institutions ?? [];
        if (!institutions || institutions.length === 0) {
          results[q] = { found: false, institutions: [] };
          continue;
        }

        results[q] = {
          found: true,
          institutions: institutions.map((i: any) => sanitizeInstitution(i)),
        };
      } catch (err: any) {
        // Prefer Plaid's error body when available
        const plaidErr = err?.response?.data ?? err?.message ?? String(err);
        const status = err?.response?.status ?? null;
        console.error("Plaid institutionsSearch error for", q, status, plaidErr);
        results[q] = { error: plaidErr, status, found: false };
      }
    }

    // For each institution, indicate Transactions/Investments support
    for (const q of Object.keys(results)) {
      const entry = results[q];
      if (!entry.found || !Array.isArray(entry.institutions)) continue;
      entry.institutions = entry.institutions.map((inst: any) => ({
        ...inst,
        supports_transactions: (inst.products || []).includes("transactions"),
        supports_investments: (inst.products || []).includes("investments"),
      }));
    }

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    console.error("Institutions diagnostic unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
