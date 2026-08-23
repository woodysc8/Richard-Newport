import { NextResponse } from "next/server";
import { refreshFinancialData } from "../../../../lib/plaidRefresh";

// Backward-compatible endpoint. Financial refresh is the single sync implementation.
export async function POST() {
  try {
    const result = await refreshFinancialData();
    return NextResponse.json(result, { status: result.success ? 200 : 207 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Financial refresh failed";
    console.error("Transaction sync failed:", message);
    return NextResponse.json({ success: false, error: message, items: [] }, { status: 500 });
  }
}
