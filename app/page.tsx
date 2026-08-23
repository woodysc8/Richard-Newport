import { createClient } from "@supabase/supabase-js";
import PlaidConnect from "./components/PlaidConnect";
import accounting from "../lib/accounting";
import { DashboardAccount, InvestmentHolding, InvestmentSnapshot, RecentTransaction, rewardBalances } from "../lib/dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const FIXED_USER_ID = "4ac12929-b795-474e-9001-56190c6c4daf";
const MONTHLY_BUDGET = {
  projectedIncome: 4300,
  spendingGoal: 2520,
  savingsGoal: 1780,
  redThreshold: 8000,
} as const;

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatCurrency(value: number | null | undefined) {
  return value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatPercent(value: number | null) {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function categoryLabel(category: RecentTransaction["category"]) {
  return Array.isArray(category) ? category.join(" > ") : category ?? "Uncategorized";
}

function isInvestmentAccount(account: DashboardAccount) {
  const type = (account.account_type ?? "").toLowerCase();
  const subtype = (account.account_subtype ?? "").toLowerCase();
  return type === "investment" || subtype.includes("brokerage") || subtype.includes("investment");
}

function isRobinhoodInvestmentAccount(account: DashboardAccount) {
  return isInvestmentAccount(account) && (account.institution_name ?? "").toLowerCase().includes("robinhood");
}

function newYorkDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function closestWeeklySnapshot(snapshots: InvestmentSnapshot[], today: string) {
  const target = Date.parse(`${today}T00:00:00Z`) - 7 * 24 * 60 * 60 * 1000;
  return snapshots
    .filter((snapshot) => snapshot.snapshot_date < today)
    .map((snapshot) => ({
      snapshot,
      distance: Math.abs(Date.parse(`${snapshot.snapshot_date}T00:00:00Z`) - target),
    }))
    .filter((candidate) => candidate.distance <= 2 * 24 * 60 * 60 * 1000)
    .sort((left, right) => left.distance - right.distance)[0]?.snapshot ?? null;
}

export default async function Home() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [accountsResult, monthTransactionsResult, recentTransactionsResult, holdingsResult] = await Promise.all([
    supabase.from("accounts").select("id, institution_name, account_name, mask, account_type, account_subtype, current_balance, available_balance, plaid_account_id, plaid_item_id").eq("user_id", FIXED_USER_ID).order("created_at", { ascending: false }),
    supabase.from("transactions").select("id, date, name, merchant_name, amount, category, pending, plaid_transaction_id, account_id").eq("user_id", FIXED_USER_ID).gte("date", monthStart).lte("date", monthEnd).order("date", { ascending: false }),
    supabase.from("transactions").select("id, date, name, merchant_name, amount, category, pending, plaid_transaction_id, account_id").eq("user_id", FIXED_USER_ID).order("date", { ascending: false }).limit(15),
    supabase.from("investment_holdings").select("id, plaid_account_id, security_id, ticker_symbol, security_name, quantity, institution_price, institution_value, cost_basis").eq("user_id", FIXED_USER_ID).order("institution_value", { ascending: false }),
  ]);
  const accounts = (accountsResult.data ?? []) as DashboardAccount[];
  const monthTransactions = (monthTransactionsResult.data ?? []) as RecentTransaction[];
  const recentTransactions = (recentTransactionsResult.data ?? []) as RecentTransaction[];
  const holdings = (holdingsResult.data ?? []) as InvestmentHolding[];
  const accountSummary = accounting.summarizeAccounts(accounts);
  const monthly = accounting.computeMonthlyAccounting(monthTransactions, accounts);
  const robinhoodInvestmentAccount = accounts
    .filter(isRobinhoodInvestmentAccount)
    .sort((left, right) => (toNumber(right.current_balance) ?? -Infinity) - (toNumber(left.current_balance) ?? -Infinity))[0];
  const snapshotsResult = robinhoodInvestmentAccount?.plaid_account_id
    ? await supabase.from("investment_snapshots").select("id, plaid_item_id, plaid_account_id, snapshot_date, portfolio_value, created_at").eq("user_id", FIXED_USER_ID).eq("plaid_account_id", robinhoodInvestmentAccount.plaid_account_id).order("snapshot_date", { ascending: false })
    : { data: [], error: null };
  const snapshots = (snapshotsResult.data ?? []) as InvestmentSnapshot[];
  const hasDataError = Boolean(accountsResult.error || monthTransactionsResult.error || recentTransactionsResult.error || holdingsResult.error || snapshotsResult.error);
  const robinhoodHoldings = robinhoodInvestmentAccount?.plaid_account_id
    ? holdings.filter((holding) => holding.plaid_account_id === robinhoodInvestmentAccount.plaid_account_id)
    : [];
  const holdingsValue = robinhoodHoldings.reduce((total, holding) => total + (toNumber(holding.institution_value) ?? 0), 0);
  // Account balances are the portfolio source of truth. Holdings only fill the gap.
  const currentPortfolioValue = toNumber(robinhoodInvestmentAccount?.current_balance) ?? holdingsValue;
  const hasReliableCostBasis = robinhoodHoldings.length > 0 && robinhoodHoldings.every(
    (holding) => (toNumber(holding.cost_basis) ?? 0) > 0 && toNumber(holding.institution_value) != null
  );
  const totalCostBasis = hasReliableCostBasis
    ? robinhoodHoldings.reduce((total, holding) => total + (toNumber(holding.cost_basis) ?? 0), 0)
    : null;
  const totalReturn = totalCostBasis != null ? currentPortfolioValue - totalCostBasis : null;
  const totalReturnPercent = totalReturn != null && totalCostBasis != null && totalCostBasis > 0
    ? (totalReturn / totalCostBasis) * 100
    : null;
  const budgetLines = accounting.getDashboardBudgetTotals(monthly.spendingByCategory);
  const spendingGaugePosition = Math.min(Math.max(monthly.spending / MONTHLY_BUDGET.redThreshold, 0), 1) * 100;
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "America/New_York" }).format(now);
  const weeklySnapshot = closestWeeklySnapshot(snapshots, newYorkDate());
  const weeklySnapshotValue = toNumber(weeklySnapshot?.portfolio_value);
  const weeklyReturn = weeklySnapshotValue != null && weeklySnapshotValue > 0
    ? currentPortfolioValue - weeklySnapshotValue
    : null;
  const weeklyReturnPercent = weeklyReturn != null && weeklySnapshotValue != null
    ? (weeklyReturn / weeklySnapshotValue) * 100
    : null;

  return <main className="min-h-screen bg-white text-black"><div className="mx-auto max-w-7xl px-6 py-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-bold tracking-tight">Budget Builder</h1><p className="mt-1 text-sm text-gray-500">Your personal financial dashboard.</p></div><PlaidConnect investmentPlaidItemId={robinhoodInvestmentAccount?.plaid_item_id} /></header>
    {hasDataError && <section className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Some financial data could not be loaded. Check the server-side Supabase configuration and refresh.</section>}
    <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">{[["Net Worth", accountSummary.netWorth], ["Cash", accountSummary.cash], ["Credit Card Owed", accountSummary.credit]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><div className="text-sm font-medium text-gray-500">{label}</div><div className="mt-3 text-3xl font-semibold tracking-tight">{formatCurrency(Number(value))}</div></div>)}</section>
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><div><h2 className="text-lg font-semibold">{monthName} Spending</h2><div className="mt-1 text-3xl font-semibold tracking-tight">{formatCurrency(monthly.spending)} spent</div></div><div className="mt-8"><div className="relative h-3 rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-red-600" role="img" aria-label={`${formatCurrency(monthly.spending)} of ${formatCurrency(MONTHLY_BUDGET.redThreshold)} monthly spending scale`}><div className="absolute top-1/2 h-7 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black ring-2 ring-white" style={{ left: `${spendingGaugePosition}%` }} /><div className="absolute -top-8 -translate-x-1/2 text-xs font-semibold text-gray-700" style={{ left: `${(MONTHLY_BUDGET.spendingGoal / MONTHLY_BUDGET.redThreshold) * 100}%` }}><span className="whitespace-nowrap">{formatCurrency(MONTHLY_BUDGET.spendingGoal)} goal</span><div className="mx-auto mt-1 h-5 w-px bg-gray-900" /></div></div><div className="mt-3 flex justify-between text-xs font-medium text-gray-500"><span>$0</span><span>{formatCurrency(MONTHLY_BUDGET.redThreshold)}</span></div></div></section>
    <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><div className="flex items-start justify-between gap-4"><div><div className="text-sm font-medium text-gray-500">Investments</div><div className="mt-2 text-4xl font-semibold tracking-tight">{formatCurrency(currentPortfolioValue)}</div><div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><div className="font-medium text-gray-500">Total return</div><div className={totalReturn == null ? "mt-1 text-gray-500" : `mt-1 font-medium ${totalReturn >= 0 ? "text-emerald-600" : "text-red-600"}`}>{totalReturn == null ? "Unavailable" : `${totalReturn >= 0 ? "+" : ""}${formatCurrency(totalReturn)} / ${formatPercent(totalReturnPercent)}`}</div></div><div><div className="font-medium text-gray-500">7-day return</div><div className={weeklyReturn == null ? "mt-1 text-gray-500" : `mt-1 font-medium ${weeklyReturn >= 0 ? "text-emerald-600" : "text-red-600"}`}>{weeklyReturn == null ? "Unavailable" : `${weeklyReturn >= 0 ? "+" : ""}${formatCurrency(weeklyReturn)} / ${formatPercent(weeklyReturnPercent)}`}</div>{weeklyReturn == null && <div className="mt-1 text-xs text-gray-400">Need historical data</div>}</div></div></div><div className="text-right text-sm font-medium text-gray-500">All time</div></div>
      <div className="mt-6 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5">{snapshots.length === 0 ? <div className="flex h-32 items-center justify-center text-center"><div><p className="text-sm font-medium text-gray-600">Portfolio history unavailable</p><p className="mt-1 text-xs text-gray-400">A snapshot will be recorded after a successful Robinhood refresh.</p></div></div> : <div><div className="text-sm font-medium text-gray-700">Portfolio history</div><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{snapshots.slice(0, 8).map((snapshot) => <div key={snapshot.id} className="rounded-lg bg-white p-3"><div className="text-xs text-gray-500">{snapshot.snapshot_date}</div><div className="mt-1 text-sm font-medium">{formatCurrency(toNumber(snapshot.portfolio_value))}</div></div>)}</div></div>}</div>
      <div className="mt-8"><h2 className="text-lg font-semibold">Holdings</h2><div className="mt-4 divide-y">{holdings.length === 0 ? <p className="py-5 text-sm text-gray-500">No investment holdings available yet.</p> : holdings.map((holding) => { const value = toNumber(holding.institution_value); const cost = toNumber(holding.cost_basis); const gain = value != null && cost != null ? value - cost : null; const gainPercent = gain != null && cost != null && cost !== 0 ? (gain / cost) * 100 : null; const symbol = holding.ticker_symbol ?? "—"; return <div key={holding.id} className="flex items-center justify-between gap-4 py-4"><div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black text-xs font-semibold text-white">{symbol.slice(0, 2)}</div><div className="min-w-0"><div className="truncate font-medium">{holding.security_name ?? "Unknown security"}</div><div className="mt-0.5 text-sm text-gray-500">{symbol}{holding.quantity != null ? ` · ${holding.quantity} shares` : ""}</div></div></div><div className="text-right"><div className="font-medium">{formatCurrency(value)}</div><div className={`mt-1 text-sm ${gain == null ? "text-gray-500" : gain >= 0 ? "text-emerald-600" : "text-red-600"}`}>{gain == null ? "Gain/loss unavailable" : `${gain >= 0 ? "+" : ""}${formatCurrency(gain)} · ${formatPercent(gainPercent)}`}</div></div></div>; })}</div></div></div>
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Recent Transactions</h2><p className="mt-1 text-sm text-gray-500">Latest activity</p><div className="mt-4">{recentTransactions.length === 0 ? <p className="text-sm text-gray-500">No recent transactions.</p> : <ul className="divide-y">{recentTransactions.map((transaction) => { const amount = toNumber(transaction.amount) ?? 0; return <li key={transaction.id} className="py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-medium">{transaction.merchant_name ?? transaction.name ?? "Unknown transaction"}</div><div className="mt-1 text-xs text-gray-500">{transaction.date} · {categoryLabel(transaction.category)}</div>{transaction.pending && <div className="mt-1 text-xs font-medium text-amber-600">Pending</div>}</div><div className={`shrink-0 text-sm font-medium ${amount < 0 ? "text-emerald-600" : "text-gray-900"}`}>{formatCurrency(amount)}</div></div></li>; })}</ul>}</div></div>
    </section>
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold">Rewards</h2><p className="mt-1 text-sm text-gray-500">Reward-program balances require a separate, supported data source.</p><div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">{rewardBalances.map((reward) => <div key={reward.label} className="rounded-xl border border-gray-200 p-5"><div className="text-sm font-medium text-gray-500">{reward.label}</div><div className="mt-3 text-2xl font-semibold">—</div><div className="mt-1 text-xs text-gray-500">Balance unavailable</div></div>)}</div></section>
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><div className="flex items-baseline justify-between"><div><h2 className="text-lg font-semibold">Monthly Budget</h2><p className="mt-1 text-sm text-gray-500">Actual spending this month, grouped into broad categories.</p></div><div className="text-sm font-medium">{formatCurrency(monthly.spending)} spent</div></div><div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-5">{budgetLines.map((line) => <div key={line.label} className="rounded-xl bg-gray-50 p-4"><div className="text-xs font-medium text-gray-500">{line.label}</div><div className="mt-2 text-lg font-semibold">{formatCurrency(line.total)}</div></div>)}</div></section>
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Connected Accounts</h2><p className="mt-1 text-sm text-gray-500">Accounts currently connected through Plaid.</p></div><div className="text-sm text-gray-500">{accounts.length} connected</div></div><div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{accounts.filter((account) => !(account.account_type ?? "").toLowerCase().includes("crypto") && !(account.account_subtype ?? "").toLowerCase().includes("crypto")).map((account) => <div key={account.id} className="rounded-xl border border-gray-200 p-5"><div className="text-xs font-medium text-gray-500">{account.institution_name ?? "Unknown institution"}</div><div className="mt-1 truncate font-semibold">{account.account_name ?? "Unnamed account"}{account.mask ? ` ••••${account.mask}` : ""}</div><div className="mt-5 text-xs text-gray-500">Balance</div><div className="mt-1 text-xl font-semibold">{formatCurrency(toNumber(account.current_balance))}</div>{account.available_balance != null && <div className="mt-1 text-xs text-gray-500">Available {formatCurrency(toNumber(account.available_balance))}</div>}</div>)}<div className="rounded-xl border border-dashed border-gray-300 p-5"><div className="text-xs font-medium text-gray-500">Coming Soon</div><div className="mt-1 font-semibold">Retirement</div><div className="mt-5 text-sm text-gray-500">Connect your retirement account later.</div></div></div></section>
  </div></main>;
}
