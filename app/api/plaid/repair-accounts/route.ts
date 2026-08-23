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

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const FIXED_USER_ID = "4ac12929-b795-474e-9001-56190c6c4daf";

export async function GET() {
  try {
    const { data: items, error: itemsErr } = await supabase
      .from("plaid_items")
      .select("id, plaid_item_id, access_token, institution_name")
      .eq("user_id", FIXED_USER_ID);

    if (itemsErr) {
      console.error("Supabase plaid_items lookup error:", itemsErr);
      return NextResponse.json({ error: "Failed fetching plaid_items" }, { status: 500 });
    }

    let itemsProcessed = 0;
    let accountsCreated = 0;
    let accountsUpdated = 0;
    let errors = 0;
    const details: any[] = [];

    for (const item of items ?? []) {
      itemsProcessed += 1;
      const accessToken = item.access_token as string;
      const storedItemInstitutionName = item.institution_name ?? null;
      let itemInstitutionName: string | null = null;
      let institutionId: string | null = null;
      let institutionNameFromPlaid: string | null = null;

      try {
        // Try to get item metadata (may include institution info)
        const itemRes = await plaidClient.itemGet({ access_token: accessToken });
        institutionId = itemRes.data.item.institution_id ?? null;
        itemInstitutionName = (itemRes.data.item as any)?.institution?.name ?? null;
      } catch (err: any) {
        console.error("Plaid itemGet error for repair (continuing):", err?.response?.data || err?.message || err);
      }

      if (institutionId) {
        try {
          const instRes = await plaidClient.institutionsGetById({ institution_id: institutionId, country_codes: ["US"] } as any);
          institutionNameFromPlaid = instRes.data.institution?.name ?? null;
        } catch (err: any) {
          console.error("Plaid institutionsGetById error for repair (continuing):", err?.response?.status, err?.response?.data || err?.message || err);
        }
      }

      const safeInstitutionName = institutionNameFromPlaid ?? itemInstitutionName ?? storedItemInstitutionName ?? institutionId ?? "Unknown Institution";

      // Update the plaid_items row to ensure institution_name is present
      try {
        const { error: updErr } = await supabase
          .from("plaid_items")
          .update({ institution_name: safeInstitutionName, updated_at: new Date().toISOString() })
          .eq("plaid_item_id", item.plaid_item_id);
        if (updErr) {
          console.error("Failed updating plaid_item institution_name during repair:", updErr);
          // don't fail the whole process
        }
      } catch (err: any) {
        console.error("Unexpected error updating plaid_items during repair:", err);
      }

      // Fetch accounts for this item
      let accounts: any[] = [];
      try {
        const accountsRes = await plaidClient.accountsGet({ access_token: accessToken });
        accounts = accountsRes.data.accounts ?? [];
      } catch (err: any) {
        console.error("Plaid accountsGet error during repair for item", item.plaid_item_id, err?.response?.data || err?.message || err);
        errors += 1;
        details.push({ item: item.plaid_item_id, error: err?.response?.data || err?.message || String(err) });
        continue; // skip to next item
      }

      for (const acct of accounts) {
        const plaidAccountId = acct.account_id;
        const accountName = acct.name ?? acct.official_name ?? "";
        const accountType = acct.type ?? null;
        const accountSubtype = acct.subtype ?? null;
        const mask = acct.mask ?? null;
        const currentBalance = acct.balances?.current ?? null;
        const availableBalance = acct.balances?.available ?? null;
        const currency = acct.balances?.iso_currency_code ?? acct.balances?.unofficial_currency_code ?? "USD";

        try {
          const { data: existingAccount, error: accLookupErr } = await supabase
            .from("accounts")
            .select("id")
            .eq("plaid_account_id", plaidAccountId)
            .eq("user_id", FIXED_USER_ID)
            .maybeSingle();

          if (accLookupErr) {
            console.error("Supabase accounts select error during repair for account", plaidAccountId, accLookupErr);
            errors += 1;
            details.push({ item: item.plaid_item_id, account: plaidAccountId, error: accLookupErr });
            continue;
          }

          if (existingAccount) {
            const { error: accUpdateErr } = await supabase
              .from("accounts")
              .update({
                user_id: FIXED_USER_ID,
                institution_name: safeInstitutionName,
                account_name: accountName,
                account_type: accountType,
                account_subtype: accountSubtype,
                mask,
                plaid_item_id: item.plaid_item_id,
                current_balance: currentBalance,
                available_balance: availableBalance,
                currency,
                updated_at: new Date().toISOString(),
              })
              .eq("plaid_account_id", plaidAccountId)
              .eq("user_id", FIXED_USER_ID);

            if (accUpdateErr) {
              console.error("Supabase accounts update error during repair for account", plaidAccountId, accUpdateErr);
              errors += 1;
              details.push({ item: item.plaid_item_id, account: plaidAccountId, error: accUpdateErr });
              continue;
            }

            accountsUpdated += 1;
            details.push({ item: item.plaid_item_id, account: plaidAccountId, action: "updated", institution: safeInstitutionName });
          } else {
            const { error: accInsertErr } = await supabase.from("accounts").insert({
              user_id: FIXED_USER_ID,
              institution_name: safeInstitutionName,
              account_name: accountName,
              account_type: accountType,
              account_subtype: accountSubtype,
              mask,
              plaid_item_id: item.plaid_item_id,
              plaid_account_id: plaidAccountId,
              current_balance: currentBalance,
              available_balance: availableBalance,
              currency,
            });

            if (accInsertErr) {
              console.error("Supabase accounts insert error during repair for account", plaidAccountId, accInsertErr);
              errors += 1;
              details.push({ item: item.plaid_item_id, account: plaidAccountId, error: accInsertErr });
              continue;
            }

            accountsCreated += 1;
            details.push({ item: item.plaid_item_id, account: plaidAccountId, action: "inserted", institution: safeInstitutionName });
          }
        } catch (err: any) {
          console.error("Unexpected accounts persistence error during repair for account", plaidAccountId, err);
          errors += 1;
          details.push({ item: item.plaid_item_id, account: plaidAccountId, error: String(err) });
          continue;
        }
      }
    }

    return NextResponse.json({ success: true, items_processed: itemsProcessed, accounts_created: accountsCreated, accounts_updated: accountsUpdated, errors, details });
  } catch (err: any) {
    console.error("Repair accounts route unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
