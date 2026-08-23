export interface DashboardAccount {
  id: string;
  institution_name: string | null;
  account_name: string | null;
  mask: string | null;
  account_type: string | null;
  account_subtype: string | null;
  current_balance: number | string | null;
  available_balance: number | string | null;
  plaid_account_id?: string | null;
  plaid_item_id?: string | null;
}

export function isDashboardInvestmentAccount(account: DashboardAccount): boolean {
  const type = (account.account_type ?? "").toLowerCase();
  const subtype = (account.account_subtype ?? "").toLowerCase();

  return type === "investment" || subtype.includes("brokerage") || subtype.includes("investment");
}

export interface InvestmentHolding {
  id: string;
  plaid_account_id: string;
  security_id: string;
  ticker_symbol: string | null;
  security_name: string | null;
  quantity: number | string | null;
  institution_price: number | string | null;
  institution_value: number | string | null;
  cost_basis: number | string | null;
}

export interface InvestmentSnapshot {
  id: string;
  plaid_item_id: string;
  plaid_account_id: string;
  snapshot_date: string;
  portfolio_value: number | string;
  created_at: string;
}

export interface RecentTransaction {
  id: string;
  date: string;
  name: string | null;
  merchant_name: string | null;
  amount: number | string | null;
  category: string | string[] | null;
  pending: boolean | null;
  plaid_transaction_id: string | null;
  account_id: string | null;
}

export interface RewardBalance {
  label: string;
  value: number | null;
  unit: "points" | "currency";
  availability: "unavailable";
}

// Rewards are intentionally unavailable until a legitimate provider is integrated.
export const rewardBalances: RewardBalance[] = [
  { label: "Bilt Points", value: null, unit: "points", availability: "unavailable" },
  { label: "Bilt Cash", value: null, unit: "currency", availability: "unavailable" },
  { label: "Barclays Points", value: null, unit: "points", availability: "unavailable" },
];
