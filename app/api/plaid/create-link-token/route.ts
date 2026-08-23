import { NextResponse } from "next/server";
import { Configuration, PlaidApi, Products, CountryCode } from "plaid";

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

export async function POST() {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: "budget-builder-user",
      },
      client_name: "Budget Builder",
      products: [
        Products.Transactions,
        Products.Investments,
      ],
      country_codes: [CountryCode.Us],
      language: "en",
    });

    return NextResponse.json({
      link_token: response.data.link_token,
    });
  } catch (error: any) {
    console.error("Plaid link token error:", error?.response?.data || error);

    return NextResponse.json(
      {
        error: "Failed to create Plaid link token",
        details: error?.response?.data || error?.message,
      },
      { status: 500 }
    );
  }
}