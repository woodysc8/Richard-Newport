import { NextResponse } from "next/server";
import { Configuration, PlaidApi } from "plaid";
import { createClient } from "@supabase/supabase-js";

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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FIXED_USER_ID =
  "4ac12929-b795-474e-9001-56190c6c4daf";

export async function POST(request: Request) {
  try {
    /*
     * ------------------------------------------------------------
     * 1. GET PUBLIC TOKEN
     * ------------------------------------------------------------
     */

    const body = await request.json();

    const publicToken = body?.public_token;

    if (!publicToken) {
      return NextResponse.json(
        {
          error: "Missing public_token",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * ------------------------------------------------------------
     * 2. EXCHANGE PUBLIC TOKEN
     * ------------------------------------------------------------
     */

    let accessToken: string;
    let itemId: string;

    try {
      const exchange =
        await plaidClient.itemPublicTokenExchange({
          public_token: publicToken,
        });

      accessToken =
        exchange.data.access_token;

      itemId =
        exchange.data.item_id;
    } catch (error: any) {
      console.error(
        "Plaid token exchange error:",
        error?.response?.data || error
      );

      return NextResponse.json(
        {
          error: "Plaid token exchange failed",
          details:
            error?.response?.data ||
            error?.message ||
            null,
        },
        {
          status: 500,
        }
      );
    }

    /*
     * ------------------------------------------------------------
     * 3. GET ITEM / INSTITUTION
     * ------------------------------------------------------------
     */

    let institutionId: string | null = null;
    let institutionName: string | null = null;

    try {
      const item =
        await plaidClient.itemGet({
          access_token: accessToken,
        });

      institutionId =
        item.data.item.institution_id ??
        null;
    } catch (error: any) {
      console.error(
        "Plaid itemGet error:",
        error?.response?.data || error
      );
    }

    if (institutionId) {
      try {
        const institutionResponse =
          await plaidClient.institutionsGetById({
            institution_id: institutionId,
            country_codes: ["US"] as any,
          } as any);

        institutionName =
          institutionResponse.data.institution?.name ??
          null;
      } catch (error: any) {
        console.error(
          "Plaid institution lookup error:",
          error?.response?.data || error
        );
      }
    }

    const safeInstitutionName =
      institutionName ??
      institutionId ??
      "Unknown Institution";

    /*
     * ------------------------------------------------------------
     * 4. ENSURE PROFILE EXISTS
     * ------------------------------------------------------------
     */

    const {
      data: existingProfile,
      error: profileLookupError,
    } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", FIXED_USER_ID)
      .maybeSingle();

    if (profileLookupError) {
      console.error(
        "Profile lookup error:",
        profileLookupError
      );

      return NextResponse.json(
        {
          error: "Failed checking user profile",
        },
        {
          status: 500,
        }
      );
    }

    if (!existingProfile) {
      const { error: profileInsertError } =
        await supabase
          .from("profiles")
          .insert({
            id: FIXED_USER_ID,
            full_name: null,
          });

      if (profileInsertError) {
        console.error(
          "Profile insert error:",
          profileInsertError
        );

        return NextResponse.json(
          {
            error: "Failed creating user profile",
          },
          {
            status: 500,
          }
        );
      }
    }

    /*
     * ------------------------------------------------------------
     * 5. SAVE PLAID ITEM
     * ------------------------------------------------------------
     */

    const {
      data: existingItem,
      error: itemLookupError,
    } = await supabase
      .from("plaid_items")
      .select("id")
      .eq("plaid_item_id", itemId)
      .maybeSingle();

    if (itemLookupError) {
      console.error(
        "Plaid item lookup error:",
        itemLookupError
      );

      return NextResponse.json(
        {
          error: "Failed checking Plaid item",
        },
        {
          status: 500,
        }
      );
    }

    if (existingItem) {
      const { error: itemUpdateError } =
        await supabase
          .from("plaid_items")
          .update({
            access_token: accessToken,
            institution_name:
              safeInstitutionName,
            updated_at:
              new Date().toISOString(),
          })
          .eq("plaid_item_id", itemId);

      if (itemUpdateError) {
        console.error(
          "Plaid item update error:",
          itemUpdateError
        );

        return NextResponse.json(
          {
            error: "Failed updating Plaid item",
          },
          {
            status: 500,
          }
        );
      }
    } else {
      const { error: itemInsertError } =
        await supabase
          .from("plaid_items")
          .insert({
            user_id: FIXED_USER_ID,
            plaid_item_id: itemId,
            access_token: accessToken,
            institution_name:
              safeInstitutionName,
          });

      if (itemInsertError) {
        console.error(
          "Plaid item insert error:",
          itemInsertError
        );

        return NextResponse.json(
          {
            error: "Failed saving Plaid item",
          },
          {
            status: 500,
          }
        );
      }
    }

    /*
     * ------------------------------------------------------------
     * 6. GET ACCOUNTS
     * ------------------------------------------------------------
     */

    let plaidAccounts: any[] = [];

    try {
      const accountsResponse =
        await plaidClient.accountsGet({
          access_token: accessToken,
        });

      plaidAccounts =
        accountsResponse.data.accounts ?? [];
    } catch (error: any) {
      console.error(
        "Plaid accountsGet error:",
        error?.response?.data || error
      );

      return NextResponse.json(
        {
          error: "Failed retrieving Plaid accounts",
          details:
            error?.response?.data ||
            error?.message ||
            null,
        },
        {
          status: 500,
        }
      );
    }

    /*
     * ------------------------------------------------------------
     * 7. SAVE ACCOUNTS
     * ------------------------------------------------------------
     */

    let accountsCreated = 0;

    for (const account of plaidAccounts) {
      const plaidAccountId =
        account.account_id;

      const accountName =
        account.name ??
        account.official_name ??
        "";

      const accountType =
        account.type ?? null;

      const accountSubtype =
        account.subtype ?? null;

      const mask =
        account.mask ?? null;

      const currentBalance =
        account.balances?.current ??
        null;

      const availableBalance =
        account.balances?.available ??
        null;

      const currency =
        account.balances?.iso_currency_code ??
        account.balances
          ?.unofficial_currency_code ??
        "USD";

      const {
        data: existingAccount,
        error: accountLookupError,
      } = await supabase
        .from("accounts")
        .select("id")
        .eq(
          "plaid_account_id",
          plaidAccountId
        )
        .eq("user_id", FIXED_USER_ID)
        .maybeSingle();

      if (accountLookupError) {
        console.error(
          "Account lookup error:",
          accountLookupError
        );

        continue;
      }

      if (existingAccount) {
        const { error: accountUpdateError } =
          await supabase
            .from("accounts")
            .update({
              institution_name:
                safeInstitutionName,
              account_name: accountName,
              account_type: accountType,
              account_subtype:
                accountSubtype,
              mask,
              plaid_item_id: itemId,
              current_balance:
                currentBalance,
              available_balance:
                availableBalance,
              currency,
              updated_at:
                new Date().toISOString(),
            })
            .eq(
              "plaid_account_id",
              plaidAccountId
            )
            .eq(
              "user_id",
              FIXED_USER_ID
            );

        if (accountUpdateError) {
          console.error(
            "Account update error:",
            accountUpdateError
          );
        }
      } else {
        const { error: accountInsertError } =
          await supabase
            .from("accounts")
            .insert({
              user_id: FIXED_USER_ID,
              institution_name:
                safeInstitutionName,
              account_name: accountName,
              account_type: accountType,
              account_subtype:
                accountSubtype,
              mask,
              plaid_item_id: itemId,
              plaid_account_id:
                plaidAccountId,
              current_balance:
                currentBalance,
              available_balance:
                availableBalance,
              currency,
            });

        if (accountInsertError) {
          console.error(
            "Account insert error:",
            accountInsertError
          );
        } else {
          accountsCreated += 1;
        }
      }
    }

    /*
     * ------------------------------------------------------------
     * 8. GET INVESTMENT HOLDINGS
     *
     * This is the important new piece.
     * It pulls actual securities from Robinhood
     * rather than using placeholder holdings.
     * ------------------------------------------------------------
     */

    let holdings: any[] = [];
    let securities: any[] = [];

    try {
      const investmentResponse =
        await plaidClient.investmentsHoldingsGet({
          access_token: accessToken,
        });

      holdings = investmentResponse.data.holdings ?? [];
      securities = investmentResponse.data.securities ?? [];

      console.log(
        `Plaid returned ${holdings.length} investment holdings`
      );
    } catch (error: any) {
      /*
       * Not every connected institution supports
       * investment holdings. This should NOT make
       * the entire bank connection fail.
       */
      console.log(
        "No investment holdings available for this connection:",
        error?.response?.data ||
          error?.message ||
          error
      );

      holdings = [];
    }

    /*
     * ------------------------------------------------------------
     * 9. SAVE INVESTMENT HOLDINGS
     * ------------------------------------------------------------
     */

    let holdingsSaved = 0;

    for (const holding of holdings) {
      const plaidAccountId =
        holding.account_id ?? null;

      const plaidSecurityId =
        holding.security_id ?? null;

      if (!plaidAccountId || !plaidSecurityId) {
        continue;
      }

      const security = securities.find(
        (item: any) => item.security_id === plaidSecurityId
      ) ?? null;

      const tickerSymbol =
        security?.ticker_symbol ??
        null;

      const securityName =
        security?.name ??
        null;

      const quantity =
        holding.quantity ??
        null;

      const institutionPrice =
        holding.institution_price ??
        null;

      const institutionValue =
        holding.institution_value ??
        null;

      const costBasis =
        holding.cost_basis ??
        null;

      const isoCurrencyCode =
        security?.iso_currency_code ??
        holding.iso_currency_code ??
        "USD";

      /*
       * Check whether this holding already exists.
       */
      const {
        data: existingHolding,
        error: holdingLookupError,
      } = await supabase
        .from("investment_holdings")
        .select("id")
        .eq("user_id", FIXED_USER_ID)
        .eq(
          "plaid_account_id",
          plaidAccountId
        )
        .eq(
          "security_id",
          plaidSecurityId
        )
        .maybeSingle();

      if (holdingLookupError) {
        console.error(
          "Investment holding lookup error:",
          holdingLookupError
        );

        continue;
      }

      const holdingData = {
        user_id: FIXED_USER_ID,
        plaid_item_id: itemId,
        plaid_account_id:
          plaidAccountId,
        security_id:
          plaidSecurityId,
        ticker_symbol:
          tickerSymbol,
        security_name:
          securityName,
        quantity,
        institution_price:
          institutionPrice,
        institution_value:
          institutionValue,
        cost_basis:
          costBasis,
        currency:
          isoCurrencyCode,
        iso_currency_code:
          isoCurrencyCode,
        updated_at:
          new Date().toISOString(),
      };

      if (existingHolding) {
        const {
          error: holdingUpdateError,
        } = await supabase
          .from("investment_holdings")
          .update(holdingData)
          .eq(
            "id",
            existingHolding.id
          );

        if (holdingUpdateError) {
          console.error(
            "Investment holding update error:",
            holdingUpdateError
          );

          continue;
        }
      } else {
        const {
          error: holdingInsertError,
        } = await supabase
          .from("investment_holdings")
          .insert(holdingData);

        if (holdingInsertError) {
          console.error(
            "Investment holding insert error:",
            holdingInsertError
          );

          continue;
        }
      }

      holdingsSaved += 1;
    }

    /*
     * ------------------------------------------------------------
     * 10. RETURN RESULT
     * ------------------------------------------------------------
     *
     * Never return the Plaid access token.
     * ------------------------------------------------------------
     */

    return NextResponse.json({
      success: true,
      item_id: itemId,
      institution_id:
        institutionId,
      institution_name:
        institutionName,
      accounts_created:
        accountsCreated,
      investment_holdings_found:
        holdings.length,
      investment_holdings_saved:
        holdingsSaved,
    });
  } catch (error: any) {
    console.error(
      "Unexpected exchange-token route error:",
      error
    );

    return NextResponse.json(
      {
        error: "Internal server error",
        details:
          error?.message ?? null,
      },
      {
        status: 500,
      }
    );
  }
}
