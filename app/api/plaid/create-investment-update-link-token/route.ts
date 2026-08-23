import { NextResponse } from "next/server";
import { Configuration, CountryCode, PlaidApi, Products } from "plaid";
import { createClient } from "@supabase/supabase-js";

const FIXED_USER_ID = "4ac12929-b795-474e-9001-56190c6c4daf";

const configuration = new Configuration({
  basePath: process.env.PLAID_ENV === "production"
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
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const plaidItemId = typeof body?.plaid_item_id === "string" ? body.plaid_item_id : "";
    if (!plaidItemId) {
      return NextResponse.json({ error: "Missing Plaid Item identifier" }, { status: 400 });
    }

    const { data: item, error: lookupError } = await supabase
      .from("plaid_items")
      .select("access_token")
      .eq("user_id", FIXED_USER_ID)
      .eq("plaid_item_id", plaidItemId)
      .maybeSingle();
    if (lookupError) {
      console.error("Investment consent Item lookup failed:", lookupError.message);
      return NextResponse.json({ error: "Unable to find the requested Plaid Item" }, { status: 500 });
    }
    if (!item?.access_token) {
      return NextResponse.json({ error: "Plaid Item was not found" }, { status: 404 });
    }

    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: "budget-builder-user" },
      client_name: "Budget Builder",
      country_codes: [CountryCode.Us],
      language: "en",
      access_token: item.access_token,
      additional_consented_products: [Products.Investments],
    });

    return NextResponse.json({ link_token: response.data.link_token });
  } catch (error) {
    const responseData = (error as { response?: { data?: { error_code?: string; error_message?: string } } })?.response?.data;
    const message = responseData?.error_message ?? "Unable to create Investment consent Link token";
    console.error("Investment consent Link token error:", responseData?.error_code ?? message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
