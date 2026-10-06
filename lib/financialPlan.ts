export const ACCOUNT_PURPOSES = ["equities", "retirement", "hysa"] as const;

export type AccountPurpose = (typeof ACCOUNT_PURPOSES)[number];

export type DateInput = string | Date;

export type PlannedPaycheck = {
  date: string;
  netAmount: number;
  rothContribution: number;
  billsAllocation: number;
  weeklySpendingAllocation: number;
  cushion: number;
};

export type PaycheckPlan = {
  netAmount: number;
  paydays: readonly string[];
  rothContribution: number;
  billsAllocation: number;
  weeklySpendingAllocation: number;
  cushion: number;
};

export type RothContributionPlan = {
  destination: string;
  totalRemaining: number;
  contributions: readonly {
    date: string;
    amount: number;
    mayExecuteOnNextTradingDay?: boolean;
  }[];
};

export type BillsPlan = {
  destination: string;
  reservePurpose: "bills-cash-reserve";
  intendedApy: number;
  monthlyObligations: {
    rent: number;
    utilities: number;
    phone: number;
    total: number;
  };
  period: {
    start: string;
    end: string;
    totalRequired: number;
  };
  perPaycheckAllocation: number;
};

export type WeeklySpendingPlan = {
  weeklyTarget: number;
  dailyTarget: number;
  periodStartDay: "Friday";
  periodEndDay: "Thursday";
  includes: readonly ["subscriptions", "credit-card-purchases"];
  excludes: readonly ["credit-card-payments", "transfers", "investment-activity"];
  venmoBalanceSemantics: "available-liquidity-offset";
};

export type FinancialPlan = {
  currency: "USD";
  paychecks: PaycheckPlan;
  roth: RothContributionPlan;
  bills: BillsPlan;
  weeklySpending: WeeklySpendingPlan;
};

export type AccountMetadata = {
  name?: string | null;
  institution?: string | null;
  type?: string | null;
  subtype?: string | null;
  purpose?: AccountPurpose | null;
};

export type SpendingPeriod = {
  start: string;
  end: string;
};

const NET_PAYCHECK = 1900;
const ROTH_PER_PAYCHECK = 500;
const BILLS_PER_PAYCHECK = 385;
const WEEKLY_SPENDING_TARGET = 420;
const PAYCHECK_SPENDING_ALLOCATION = WEEKLY_SPENDING_TARGET * 2;
const PAYCHECK_CUSHION = 175;

const PAYDAYS = [
  "2026-10-02",
  "2026-10-16",
  "2026-10-30",
  "2026-11-13",
  "2026-11-27",
  "2026-12-11",
  "2026-12-25",
] as const;

const ROTH_CONTRIBUTIONS = [
  { date: "2026-10-02", amount: 500 },
  { date: "2026-10-16", amount: 500 },
  { date: "2026-10-30", amount: 500 },
  { date: "2026-11-13", amount: 500 },
  { date: "2026-11-27", amount: 500 },
  { date: "2026-12-11", amount: 500 },
  { date: "2026-12-25", amount: 260, mayExecuteOnNextTradingDay: true },
] as const;

const MONTHLY_OBLIGATIONS = {
  rent: 733,
  utilities: 100,
  phone: 65,
  total: 898,
} as const;

export const FINANCIAL_PLAN: FinancialPlan = {
  currency: "USD",
  paychecks: {
    netAmount: NET_PAYCHECK,
    paydays: PAYDAYS,
    rothContribution: ROTH_PER_PAYCHECK,
    billsAllocation: BILLS_PER_PAYCHECK,
    weeklySpendingAllocation: PAYCHECK_SPENDING_ALLOCATION,
    cushion: PAYCHECK_CUSHION,
  },
  roth: {
    destination: "Robinhood Roth IRA",
    totalRemaining: 3260,
    contributions: ROTH_CONTRIBUTIONS,
  },
  bills: {
    destination: "Robinhood HYSA",
    reservePurpose: "bills-cash-reserve",
    intendedApy: 0.0375,
    monthlyObligations: MONTHLY_OBLIGATIONS,
    period: {
      start: "2026-10-01",
      end: "2026-12-31",
      totalRequired: 2694,
    },
    perPaycheckAllocation: BILLS_PER_PAYCHECK,
  },
  weeklySpending: {
    weeklyTarget: WEEKLY_SPENDING_TARGET,
    dailyTarget: 60,
    periodStartDay: "Friday",
    periodEndDay: "Thursday",
    includes: ["subscriptions", "credit-card-purchases"],
    excludes: ["credit-card-payments", "transfers", "investment-activity"],
    venmoBalanceSemantics: "available-liquidity-offset",
  },
};

function toUtcDate(input: DateInput): Date {
  if (input instanceof Date) {
    return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) {
    throw new Error(`Expected a date in YYYY-MM-DD format, received: ${input}`);
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function getConfiguredPaydays(): readonly string[] {
  return FINANCIAL_PLAN.paychecks.paydays;
}

export function getCurrentOrNextPlannedPaycheck(input: DateInput): PlannedPaycheck | null {
  const date = formatDate(toUtcDate(input));
  const payday = FINANCIAL_PLAN.paychecks.paydays.find((candidate) => candidate >= date);
  return payday ? getPlannedPaycheck(payday) : null;
}

export function getPlannedPaycheck(payday: string): PlannedPaycheck {
  if (!FINANCIAL_PLAN.paychecks.paydays.includes(payday as (typeof PAYDAYS)[number])) {
    throw new Error(`No planned paycheck exists for ${payday}`);
  }

  return {
    date: payday,
    netAmount: NET_PAYCHECK,
    rothContribution: calculatePlannedRothContribution(payday),
    billsAllocation: BILLS_PER_PAYCHECK,
    weeklySpendingAllocation: PAYCHECK_SPENDING_ALLOCATION,
    cushion: PAYCHECK_CUSHION,
  };
}

export function getSpendingPeriod(input: DateInput): SpendingPeriod {
  const date = toUtcDate(input);
  const dayOfWeek = date.getUTCDay();
  const daysSinceFriday = (dayOfWeek + 2) % 7;
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - daysSinceFriday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  return { start: formatDate(start), end: formatDate(end) };
}

export function getWeeklySpendingTarget(): number {
  return FINANCIAL_PLAN.weeklySpending.weeklyTarget;
}

export function getPaycheckAllocation(): PaycheckPlan {
  return FINANCIAL_PLAN.paychecks;
}

export function calculatePlannedRothContribution(payday: string): number {
  return FINANCIAL_PLAN.roth.contributions.find((contribution) => contribution.date === payday)?.amount ?? 0;
}

export function calculateRemainingPlannedRothContributions(asOfDate?: DateInput): number {
  if (asOfDate === undefined) {
    return FINANCIAL_PLAN.roth.contributions.reduce((total, contribution) => total + contribution.amount, 0);
  }

  const date = formatDate(toUtcDate(asOfDate));
  return FINANCIAL_PLAN.roth.contributions
    .filter((contribution) => contribution.date >= date)
    .reduce((total, contribution) => total + contribution.amount, 0);
}

export function identifyAccountPurpose(account: AccountMetadata): AccountPurpose | null {
  if (account.purpose) {
    return account.purpose;
  }

  const text = [account.name, account.institution, account.type, account.subtype]
    .map(normalize)
    .join(" ");

  if (text.includes("roth") || text.includes("401k") || text.includes("401(k)") || normalize(account.subtype) === "retirement") {
    return "retirement";
  }

  if (text.includes("hysa") || text.includes("high yield") || text.includes("bills") || text.includes("cash reserve")) {
    return "hysa";
  }

  if (text.includes("taxable") || text.includes("individual") || text.includes("brokerage") || text.includes("portfolio")) {
    return "equities";
  }

  return null;
}