import type { ReactNode } from "react";
import { createClient } from "@supabase/supabase-js";
import PlaidConnect from "./components/PlaidConnect";
import {
  DashboardAccount,
  InvestmentHolding,
  InvestmentSnapshot,
  RecentTransaction,
  rewardBalances,
} from "../lib/dashboard";
import { buildDashboardViewModel, PortfolioPosition } from "../lib/dashboardViewModel";
import { getSpendingPeriod } from "../lib/financialPlan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const FIXED_USER_ID = "4ac12929-b795-474e-9001-56190c6c4daf";

function number(value: number | string | null | undefined): number | null {
  const parsed = Number(value);
  return value == null || value === "" || !Number.isFinite(parsed) ? null : parsed;
}

function money(value: number | string | null | undefined): string {
  const amount = number(value);
  return amount == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
}

function signedMoney(value: number | null): string {
  if (value == null) return "Unavailable";
  return `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`;
}

function percent(value: number | null | undefined): string {
  return value == null ? "Unavailable" : `${value.toFixed(1)}%`;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function accountName(account: DashboardAccount): string {
  return `${account.institution_name ?? "Unknown institution"} · ${account.account_name ?? "Unnamed account"}${account.mask ? ` ••••${account.mask}` : ""}`;
}

function transactionCategory(transaction: RecentTransaction): string {
  return Array.isArray(transaction.category) ? transaction.category.join(" > ") : transaction.category ?? "Uncategorized";
}

function SectionHeader({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-ink)]">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">{title}</h2>
      {detail && <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{detail}</p>}
    </div>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-[var(--border)] bg-white p-5 ${className}`}>{children}</div>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--text-muted)]">{children}</div>;
}

function Metric({ label, value, detail, positive = false }: { label: string; value: string; detail?: string; positive?: boolean }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${positive ? "text-[var(--up)]" : "text-[var(--text)]"}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-[var(--text-muted)]">{detail}</p>}
    </div>
  );
}

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-[var(--surface)] ${className}`}>
      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
    </div>
  );
}

function PositionCard({ label, description, position, accent = false, children }: { label: string; description: string; position: PortfolioPosition; accent?: boolean; children?: ReactNode }) {
  return (
    <Panel className={accent ? "border-[var(--accent)]" : ""}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--text)]">{label}</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p>
        </div>
        <span className="text-xs font-medium text-[var(--text-muted)]">{position.accounts.length} account{position.accounts.length === 1 ? "" : "s"}</span>
      </div>
      <p className="mt-7 text-xs text-[var(--text-muted)]">Total value</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-[var(--text)]">{money(position.currentValue)}</p>
      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-4">
        <Metric label="Invested" value={money(position.investedValue)} />
        <Metric label="Cash" value={money(position.cashValue)} />
      </div>
      <div className="mt-5 flex items-center justify-between text-sm">
        <span className="text-[var(--text-muted)]">Gains / losses</span>
        <span className={position.totalGain == null ? "text-[var(--text-muted)]" : position.totalGain >= 0 ? "font-semibold text-[var(--up)]" : "font-semibold text-[var(--down)]"}>
          {signedMoney(position.totalGain)} {position.totalGainPercent == null ? "" : `(${percent(position.totalGainPercent)})`}
        </span>
      </div>
      {children}
    </Panel>
  );
}

function PortfolioTable({ title, position }: { title: string; position: PortfolioPosition }) {
  return (
    <Panel>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--text)]">{title}</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{position.holdings.length} holding{position.holdings.length === 1 ? "" : "s"} · {money(position.investedValue)} invested</p>
        </div>
        <p className="text-sm font-semibold text-[var(--text)]">{money(position.currentValue)}</p>
      </div>
      {position.holdings.length === 0 ? (
        <div className="mt-5"><Empty>No holdings are available for this purpose.</Empty></div>
      ) : (
        <div className="mt-5 divide-y divide-[var(--border)]">
          {position.holdings.map((holding) => (
            <div key={holding.id} className="grid gap-2 py-4 first:pt-0 sm:grid-cols-[1fr_auto_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--text)]">{holding.security_name ?? "Unknown security"}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{holding.ticker_symbol ?? "Ticker unavailable"} · {holding.quantity == null ? "Shares unavailable" : `${holding.quantity} shares`}</p>
              </div>
              <div className="sm:text-right"><p className="text-xs text-[var(--text-muted)]">Value</p><p className="font-semibold text-[var(--text)]">{money(holding.institution_value)}</p></div>
              <div className="sm:text-right"><p className="text-xs text-[var(--text-muted)]">Allocation</p><p className="font-semibold text-[var(--text)]">{percent(holding.allocationPercent)}</p></div>
              <div className="sm:col-span-3 sm:flex sm:items-center sm:gap-3"><ProgressBar value={holding.allocationPercent ?? 0} className="flex-1" /><span className={holding.gain == null ? "text-xs text-[var(--text-muted)]" : holding.gain >= 0 ? "text-xs text-[var(--up)]" : "text-xs text-[var(--down)]"}>{signedMoney(holding.gain)}</span></div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function PortfolioGrowthChart({ observations }: { observations: { date: string; value: number }[] }) {
  if (observations.length < 2) {
    return <Empty>Portfolio history will appear as more securities-only snapshots are recorded.</Empty>;
  }

  const width = 720;
  const height = 240;
  const padding = { top: 18, right: 18, bottom: 34, left: 58 };
  const values = observations.map((observation) => observation.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const x = (index: number) => padding.left + (index / (observations.length - 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + (1 - (value - minimum) / range) * (height - padding.top - padding.bottom);
  const points = observations.map((observation, index) => `${x(index)},${y(observation.value)}`).join(" ");
  const first = observations[0];
  const last = observations[observations.length - 1];

  return (
    <div className="overflow-x-auto">
      <svg aria-label="Portfolio value over time" className="min-w-[620px]" viewBox={`0 0 ${width} ${height}`} role="img">
        <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} stroke="var(--border)" />
        <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} stroke="var(--border)" />
        <polyline fill="none" points={points} stroke="var(--accent)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        {observations.map((observation, index) => <circle key={`${observation.date}-${index}`} cx={x(index)} cy={y(observation.value)} fill="var(--bg)" r="4" stroke="var(--accent)" strokeWidth="2" />)}
        <text fill="var(--text-muted)" fontSize="11" x="4" y={padding.top + 4}>{money(maximum)}</text>
        <text fill="var(--text-muted)" fontSize="11" x="4" y={height - padding.bottom}>{money(minimum)}</text>
        <text fill="var(--text-muted)" fontSize="11" textAnchor="start" x={padding.left} y={height - 8}>{first.date}</text>
        <text fill="var(--text-muted)" fontSize="11" textAnchor="end" x={width - padding.right} y={height - 8}>{last.date}</text>
      </svg>
    </div>
  );
}

export default async function Home() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const historyStart = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().slice(0, 10);
  const spendingPeriod = getSpendingPeriod(now);
  const transactionSelect = "id, date, name, merchant_name, amount, category, pending, plaid_transaction_id, account_id";
  const [accountsResult, monthResult, historyResult, weeklyResult, recentResult, holdingsResult, snapshotsResult] = await Promise.all([
    supabase.from("accounts").select("id, institution_name, account_name, mask, account_type, account_subtype, current_balance, available_balance, plaid_account_id, plaid_item_id").eq("user_id", FIXED_USER_ID).order("created_at", { ascending: false }),
    supabase.from("transactions").select(transactionSelect).eq("user_id", FIXED_USER_ID).gte("date", monthStart).lte("date", monthEnd).order("date", { ascending: false }),
    supabase.from("transactions").select(transactionSelect).eq("user_id", FIXED_USER_ID).gte("date", historyStart).lte("date", monthEnd).order("date", { ascending: false }),
    supabase.from("transactions").select(transactionSelect).eq("user_id", FIXED_USER_ID).gte("date", spendingPeriod.start).lte("date", spendingPeriod.end).order("date", { ascending: false }),
    supabase.from("transactions").select(transactionSelect).eq("user_id", FIXED_USER_ID).order("date", { ascending: false }).limit(15),
    supabase.from("investment_holdings").select("id, plaid_account_id, security_id, ticker_symbol, security_name, quantity, institution_price, institution_value, cost_basis, currency, iso_currency_code").eq("user_id", FIXED_USER_ID).order("institution_value", { ascending: false }),
    supabase.from("investment_snapshots").select("id, plaid_item_id, plaid_account_id, snapshot_date, portfolio_value, securities_value, created_at").eq("user_id", FIXED_USER_ID).order("snapshot_date", { ascending: false }),
  ]);

  const accounts = (accountsResult.data ?? []) as DashboardAccount[];
  const recent = (recentResult.data ?? []) as RecentTransaction[];
  const holdings = (holdingsResult.data ?? []) as InvestmentHolding[];
  const snapshots = (snapshotsResult.data ?? []) as InvestmentSnapshot[];
  const view = buildDashboardViewModel({
    accounts,
    monthTransactions: (monthResult.data ?? []) as RecentTransaction[],
    historicalTransactions: (historyResult.data ?? []) as RecentTransaction[],
    weeklyTransactions: (weeklyResult.data ?? []) as RecentTransaction[],
    holdings,
    snapshots,
    now,
  });
  const dataUnavailable = Boolean(accountsResult.error || monthResult.error || historyResult.error || weeklyResult.error || recentResult.error || holdingsResult.error || snapshotsResult.error);
  const nextPaycheck = view.financialPlan.nextPaycheck;
  const weeklyProgress = view.weeklySpending.target > 0 ? (view.weeklySpending.eligibleSpending / view.weeklySpending.target) * 100 : 0;
  const rothPlannedTotal = view.financialPlan.rothContributions.reduce((total, contribution) => total + contribution.amount, 0);
  const chartMax = Math.max(...view.monthlyHistory.flatMap((item) => [item.income, item.spending]), 1);
  const currentInvestedPortfolioValue = view.financialPosition.equities.investedValue + view.financialPosition.retirement.investedValue;

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 lg:py-10">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[var(--border)] pb-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-ink)]">Richard-Newport · financial operating system</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Budget Builder</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-muted)]">A live view of where your money is, what it is for, and what deserves attention next.</p>
          </div>
          <PlaidConnect investmentPlaidItemId={accounts.find((account) => account.account_type?.toLowerCase() === "investment")?.plaid_item_id} />
        </header>

        {dataUnavailable && <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-muted)]">Some connected data is unavailable. Plan values remain visible; live balances appear when their source loads.</div>}

        <section className="mt-10">
          <SectionHeader eyebrow="Overall position" title="The starting point" detail="Authoritative connected-account totals, with checking kept separate from bills reserve cash." />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Panel>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Net worth</p>
              <p className="mt-4 text-4xl font-semibold tracking-tight text-[var(--text)]">{money(view.overallPosition.netWorth)}</p>
              <p className="mt-2 text-sm text-[var(--text-muted)]">Current connected balances</p>
            </Panel>
            <Panel>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Checking</p>
              <p className="mt-4 text-4xl font-semibold tracking-tight text-[var(--text)]">{view.overallPosition.checkingAccounts.length > 0 ? money(view.overallPosition.checkingBalance) : "Not connected"}</p>
              <p className="mt-2 text-sm text-[var(--text-muted)]">USAA spending account · not HYSA reserve</p>
            </Panel>
          </div>
        </section>

        <section className="mt-10">
          <SectionHeader eyebrow="Financial position" title="Where your money is" detail="Three distinct jobs for your money: flexible investing, retirement growth, and bills reserve." />
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <PositionCard label="Equities" description="Taxable Robinhood individual brokerage" position={view.financialPosition.equities}>
              <p className="mt-5 text-xs text-[var(--text-muted)]">Flexible invested money · holdings below</p>
            </PositionCard>
            <PositionCard label="Retirement" description="Primary Roth IRA position" position={view.financialPosition.retirement} accent>
              <div className="mt-5 border-t border-[var(--border)] pt-4"><div className="flex justify-between text-xs"><span className="text-[var(--text-muted)]">Configured 2026 plan remaining</span><span className="font-semibold text-[var(--text)]">{money(view.financialPlan.rothRemaining)}</span></div><p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Contribution progress is unavailable without contribution history. Planned schedule: {money(rothPlannedTotal)}</p></div>
            </PositionCard>
            <Panel>
              <div className="flex items-start justify-between gap-4"><div><h3 className="text-base font-semibold">HYSA</h3><p className="mt-1 text-sm text-[var(--text-muted)]">Bills and cash-reserve bucket</p></div><span className="text-xs font-medium text-[var(--text-muted)]">{view.financialPosition.hysa.accounts.length} account{view.financialPosition.hysa.accounts.length === 1 ? "" : "s"}</span></div>
              <p className="mt-7 text-3xl font-semibold tracking-tight">{view.financialPosition.hysa.accounts.length > 0 ? money(view.financialPosition.hysa.currentBalance) : "Not connected"}</p>
              <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-4"><Metric label="Monthly bills" value={money(view.financialPlan.bills.monthlyObligations.total)} /><Metric label="Per paycheck" value={money(view.financialPlan.bills.perPaycheckAllocation)} /></div>
              <div className="mt-5 flex items-center justify-between text-sm"><span className="text-[var(--text-muted)]">Configured plan APY</span><span className="font-semibold text-[var(--text)]">{(view.financialPosition.hysa.configuredApy * 100).toFixed(2)}%</span></div>
              <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Plan value only, not a live APY reading. Intended for bills and reserve funding.</p>
            </Panel>
          </div>
        </section>

        <section className="mt-12">
          <SectionHeader eyebrow="Weekly spending" title="Friday → Thursday" detail="Purchases and subscriptions count. Card payments, transfers, investments, and Venmo balance do not." />
          <Panel className="mt-5">
            <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-sm text-[var(--text-muted)]">Current period</p><p className="mt-1 text-lg font-semibold">{formatDate(view.weeklySpending.periodStart)} – {formatDate(view.weeklySpending.periodEnd)}</p></div><div className="text-left sm:text-right"><p className="text-sm text-[var(--text-muted)]">Weekly target</p><p className="mt-1 text-3xl font-semibold">{money(view.weeklySpending.target)}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{money(view.weeklySpending.dailyTarget)} per day reference</p></div></div>
            <div className="mt-7"><div className="flex justify-between text-sm"><span className="text-[var(--text-muted)]">Eligible spending</span><span className="font-semibold">{money(view.weeklySpending.eligibleSpending)} · {percent(view.weeklySpending.spendingPercentage)}</span></div><ProgressBar value={weeklyProgress} className="mt-3 h-3" /></div>
            {view.weeklySpending.eligibleSpending > view.weeklySpending.target && <p className="mt-3 text-sm font-semibold text-[var(--down)]">{money(view.weeklySpending.eligibleSpending - view.weeklySpending.target)} over target</p>}
            <div className="mt-7 grid gap-5 border-t border-[var(--border)] pt-5 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Remaining budget" value={money(view.weeklySpending.remainingBudget)} /><Metric label="Venmo liquidity" value={money(view.weeklySpending.venmoBalance)} detail="Separate funding offset" /><Metric label="Remaining funding need" value={money(view.weeklySpending.remainingFundingNeed)} positive={view.weeklySpending.remainingFundingNeed === 0} /><Metric label="Transactions counted" value={String(view.weeklySpending.transactionCount)} detail="Eligible activity" /></div>
          </Panel>
        </section>

        <section className="mt-12">
          <SectionHeader eyebrow="Financial plan" title="Every paycheck has a job" detail="The configured plan keeps investing, bills, weekly spending, and cushion visible at the same time." />
          <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Panel>
              <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-[var(--text-muted)]">Net paycheck</p><p className="mt-1 text-3xl font-semibold">{money(view.financialPlan.paycheck.netAmount)}</p></div><p className="text-sm text-[var(--text-muted)]">{nextPaycheck ? `Next planned: ${formatDate(nextPaycheck.date)}` : "No future payday configured"}</p></div>
              <div className="mt-7 grid gap-4 sm:grid-cols-2"><Metric label="Roth IRA" value={money(view.financialPlan.paycheck.rothContribution)} /><Metric label="HYSA / bills" value={money(view.financialPlan.paycheck.billsAllocation)} /><Metric label="Weekly spending" value={money(view.financialPlan.paycheck.weeklySpendingAllocation)} /><Metric label="Cushion" value={money(view.financialPlan.paycheck.cushion)} /></div>
            </Panel>
            <Panel>
              <div className="flex items-end justify-between gap-4"><div><h3 className="font-semibold">2026 Roth schedule</h3><p className="mt-1 text-sm text-[var(--text-muted)]">Configured remaining: {money(view.financialPlan.rothRemaining)}</p></div><p className="text-sm font-semibold text-[var(--accent-ink)]">{money(rothPlannedTotal)} planned</p></div>
              <div className="mt-5 divide-y divide-[var(--border)]">{view.financialPlan.rothContributions.map((contribution) => <div key={contribution.date} className="flex items-center justify-between gap-4 py-3 first:pt-0"><span className="text-sm text-[var(--text-muted)]">{formatDate(contribution.date)}{contribution.mayExecuteOnNextTradingDay ? " · next trading day" : ""}</span><span className="font-semibold">{money(contribution.amount)}</span></div>)}</div>
            </Panel>
          </div>
        </section>

        <section className="mt-12">
          <SectionHeader eyebrow="Portfolio analysis" title="Invested money, by purpose" detail="Holdings, allocation, cash, and gains are shown only where connected data supports them." />
          <div className="mt-5 grid gap-4 lg:grid-cols-2"><PortfolioTable title="Taxable equities" position={view.financialPosition.equities} /><PortfolioTable title="Roth IRA" position={view.financialPosition.retirement} /></div>
        </section>

        <section className="mt-12">
          <SectionHeader eyebrow="Portfolio growth" title="All-time invested value" detail="Securities-only portfolio observations across taxable Equities and Retirement." />
          <Panel className="mt-5">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div><p className="text-xs text-[var(--text-muted)]">Current invested portfolio value</p><p className="mt-1 text-3xl font-semibold tracking-tight">{money(currentInvestedPortfolioValue)}</p></div>
              {view.portfolioGrowth.changeSinceFirstSnapshot == null ? <p className="text-sm text-[var(--text-muted)]">Change since first snapshot: Unavailable</p> : <p className={view.portfolioGrowth.changeSinceFirstSnapshot >= 0 ? "text-sm font-semibold text-[var(--up)]" : "text-sm font-semibold text-[var(--down)]"}>Change since first snapshot: {signedMoney(view.portfolioGrowth.changeSinceFirstSnapshot)}</p>}
            </div>
            <div className="mt-7"><PortfolioGrowthChart observations={view.portfolioGrowth.observations} /></div>
          </Panel>
        </section>

        <section className="mt-12 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Panel>
            <div className="flex items-end justify-between gap-4"><SectionHeader eyebrow="Cash flow" title="Recent financial rhythm" /><div className="text-right"><p className="text-xs text-[var(--text-muted)]">This month</p><p className="mt-1 text-sm font-semibold">{money(view.monthly.income)} in · {money(view.monthly.spending)} out</p></div></div>
            <div className="mt-7 flex h-36 items-end gap-3">{view.monthlyHistory.map((item) => <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2"><div className="flex h-28 items-end gap-1"><i className="w-2 rounded-t bg-[var(--accent)]" style={{ height: `${Math.max((item.income / chartMax) * 100, item.income ? 4 : 0)}%` }} /><i className="w-2 rounded-t bg-[var(--text)]" style={{ height: `${Math.max((item.spending / chartMax) * 100, item.spending ? 4 : 0)}%` }} /></div><span className="text-xs text-[var(--text-muted)]">{item.label}</span></div>)}</div>
          </Panel>
          <Panel>
            <SectionHeader eyebrow="Attention" title="What deserves a look" />
            <div className="mt-5 space-y-4 text-sm leading-6 text-[var(--text-muted)]"><p>{view.financialPosition.hysa.accounts.length === 0 ? "Connect or designate a HYSA to make the bills reserve visible here." : "Your bills reserve is separated from general spending cash."}</p><p>{view.weeklySpending.remainingFundingNeed > 0 ? `${money(view.weeklySpending.remainingFundingNeed)} still needs funding after Venmo liquidity.` : "This week's spending plan is fully funded after the Venmo offset."}</p><p>{nextPaycheck ? `Next plan checkpoint: ${formatDate(nextPaycheck.date)}.` : "No future paycheck is configured beyond the current schedule."}</p></div>
          </Panel>
        </section>

        <section className="mt-12 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Panel>
            <SectionHeader eyebrow="Recent activity" title="Latest transactions" />
            <div className="mt-5 divide-y divide-[var(--border)]">{recent.length === 0 ? <Empty>No recent transactions available.</Empty> : recent.slice(0, 8).map((transaction) => { const amount = number(transaction.amount); return <div key={transaction.id} className="flex justify-between gap-4 py-3 first:pt-0"><div className="min-w-0"><p className="truncate text-sm font-medium">{transaction.merchant_name ?? transaction.name ?? "Unknown transaction"}</p><p className="mt-1 truncate text-xs text-[var(--text-muted)]">{transaction.date} · {transactionCategory(transaction)}{transaction.pending ? " · Pending" : ""}</p></div><p className={amount != null && amount < 0 ? "text-sm font-semibold text-[var(--up)]" : "text-sm font-semibold"}>{money(amount)}</p></div>; })}</div>
          </Panel>
          <Panel>
            <SectionHeader eyebrow="Connected accounts" title="Account map" detail="Purpose labels keep account roles clear without exposing IDs." />
            <div className="mt-5 divide-y divide-[var(--border)]">{view.accounts.length === 0 ? <Empty>No connected accounts yet.</Empty> : view.accounts.map((account) => <div key={account.id} className="flex justify-between gap-4 py-3 first:pt-0"><div className="min-w-0"><p className="truncate text-sm font-medium">{accountName(account)}</p><p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">{account.accountClass}</p></div><p className="text-sm font-semibold">{money(account.current_balance)}</p></div>)}</div>
          </Panel>
        </section>

        <section className="mt-12 border-t border-[var(--border)] pt-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">Rewards</p><p className="mt-1 text-sm text-[var(--text-muted)]">Provider balances remain unavailable until connected.</p></div><div className="flex flex-wrap gap-2">{rewardBalances.map((reward) => <span key={reward.label} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-muted)]">{reward.label}: {reward.value == null ? "Unavailable" : reward.value}</span>)}</div></div></section>
      </div>
    </main>
  );
}