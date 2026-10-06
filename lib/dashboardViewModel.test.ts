import { describe, expect, it } from "vitest";
import { buildDashboardViewModel, buildPortfolioGrowthSeries, isCashHolding } from "./dashboardViewModel";
import { DashboardAccount, InvestmentHolding, InvestmentSnapshot, RecentTransaction } from "./dashboard";

function account(overrides: Partial<DashboardAccount>): DashboardAccount {
  return {
    id: "account-id",
    institution_name: "Robinhood",
    account_name: "Robinhood Individual",
    mask: null,
    account_type: "investment",
    account_subtype: "brokerage",
    current_balance: 500,
    available_balance: 400,
    plaid_account_id: "individual-id",
    ...overrides,
  };
}

function holding(overrides: Partial<InvestmentHolding>): InvestmentHolding {
  return {
    id: "holding-id",
    plaid_account_id: "individual-id",
    security_id: "security-id",
    ticker_symbol: "VOO",
    security_name: "Vanguard S&P 500 ETF",
    quantity: 1,
    institution_price: 100,
    institution_value: 100,
    cost_basis: 90,
    ...overrides,
  };
}

function snapshot(overrides: Partial<InvestmentSnapshot>): InvestmentSnapshot {
  return {
    id: "snapshot-id",
    plaid_item_id: "item-id",
    plaid_account_id: "individual-id",
    snapshot_date: "2026-01-01",
    portfolio_value: 100,
    created_at: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

const accounts = [
  account({}),
  account({ id: "roth-account", account_name: "Robinhood Roth IRA", account_subtype: "roth", plaid_account_id: "roth-id" }),
];
const emptyTransactions: RecentTransaction[] = [];

describe("buildPortfolioGrowthSeries", () => {
  it("sorts observations chronologically and combines duplicate dates", () => {
    const series = buildPortfolioGrowthSeries([
      snapshot({ snapshot_date: "2026-01-03", portfolio_value: 120, securities_value: 120 }),
      snapshot({ snapshot_date: "2026-01-01", portfolio_value: 100, securities_value: 100 }),
      snapshot({ snapshot_date: "2026-01-03", portfolio_value: 80, securities_value: 80, plaid_account_id: "roth-id" }),
    ], accounts);

    expect(series.observations).toEqual([
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-03", value: 200 },
    ]);
  });

  it("aggregates taxable and Roth snapshots and calculates the earliest-to-latest change", () => {
    const series = buildPortfolioGrowthSeries([
      snapshot({ snapshot_date: "2026-01-01", portfolio_value: 100, securities_value: 100 }),
      snapshot({ snapshot_date: "2026-01-01", portfolio_value: 50, securities_value: 50, plaid_account_id: "roth-id" }),
      snapshot({ snapshot_date: "2026-02-01", portfolio_value: 180, securities_value: 180 }),
      snapshot({ snapshot_date: "2026-02-01", portfolio_value: 70, securities_value: 70, plaid_account_id: "roth-id" }),
    ], accounts);

    expect(series.latestValue).toBe(250);
    expect(series.changeSinceFirstSnapshot).toBe(100);
  });

  it("returns no observations when stored snapshots include cash", () => {
    const series = buildPortfolioGrowthSeries([snapshot({ portfolio_value: 500 })], accounts);

    expect(series.observations).toEqual([]);
    expect(series.changeSinceFirstSnapshot).toBeNull();
  });

  it("represents insufficient history without fabricating observations", () => {
    const series = buildPortfolioGrowthSeries([snapshot({ portfolio_value: 100, securities_value: 100 })], accounts);

    expect(series.observations).toHaveLength(1);
  });
});

describe("cash-aware portfolio positions", () => {
  it("does not include Robinhood Individual CUR:USD in Equities invested value", () => {
    const view = buildDashboardViewModel({
      accounts: [account({})],
      monthTransactions: emptyTransactions,
      historicalTransactions: emptyTransactions,
      holdings: [
        holding({ institution_value: 100 }),
        holding({ id: "cash-holding", ticker_symbol: "CUR:USD", security_name: "CUR:USD", institution_value: 400, cost_basis: null }),
      ],
      snapshots: [],
      now: new Date("2026-10-05T12:00:00.000Z"),
    });

    expect(isCashHolding(holding({ ticker_symbol: "CUR:USD", security_name: "CUR:USD" }))).toBe(true);
    expect(view.financialPosition.equities.investedValue).toBe(100);
    expect(view.financialPosition.equities.cashValue).toBe(400);
    expect(view.financialPosition.equities.holdings).toHaveLength(1);
    expect(view.financialPosition.hysa.currentBalance).toBe(400);
  });
});