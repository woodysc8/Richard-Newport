/*
 * ============================================================
 * BUDGET CONFIGURATION
 * ============================================================
 *
 * Simple, Plaid-friendly personal budget.
 *
 * The dashboard intentionally uses broad categories rather
 * than trying to force Plaid transactions into very specific
 * categories like:
 *
 *   Mortgage
 *   Electricity
 *   Gym
 *   Doctors
 *   Medicine
 *   Cable
 *   etc.
 *
 * Plaid is much more reliable at identifying broad spending
 * types, so the budget follows that same philosophy.
 * ============================================================
 */

export interface BudgetLine {
  name: string;
  category: string;
  amount: number;
  isIncome: boolean;
  isSavings: boolean;
}

export interface MonthlyBudget {
  year: number;
  month: number;
  lines: BudgetLine[];
}

/*
 * ============================================================
 * MONTHLY BUDGET
 * ============================================================
 *
 * Current monthly plan:
 *
 * Housing & Bills       $985
 * Food                  $900
 * Transportation        $260
 * Fun & Entertainment     $0
 * Shopping & Personal   $200
 * Health                $175
 *
 * Total expenses      $2,520
 *
 * Income target       $4,240
 *
 * Savings target      $1,720
 *
 * $4,240 - $2,520 = $1,720
 * ============================================================
 */

const MONTHLY_INCOME = 4240;

const MONTHLY_EXPENSES = [
  {
    name: "Housing & Bills",
    category: "housing_bills",
    amount: 985,
  },
  {
    name: "Food",
    category: "food",
    amount: 900,
  },
  {
    name: "Transportation",
    category: "transportation",
    amount: 260,
  },
  {
    name: "Fun & Entertainment",
    category: "fun_entertainment",
    amount: 0,
  },
  {
    name: "Shopping & Personal",
    category: "shopping_personal",
    amount: 200,
  },
  {
    name: "Health",
    category: "health",
    amount: 175,
  },
];

const MONTHLY_SAVINGS =
  MONTHLY_INCOME -
  MONTHLY_EXPENSES.reduce(
    (total, line) => total + line.amount,
    0
  );

/*
 * ============================================================
 * GET MONTHLY BUDGET
 * ============================================================
 */

export function getMonthlyBudget(
  year: number,
  month: number
): MonthlyBudget {
  return {
    year,
    month,

    lines: [
      /*
       * --------------------------------------------------------
       * INCOME
       * --------------------------------------------------------
       */

      {
        name: "Monthly Income",
        category: "income",
        amount: MONTHLY_INCOME,
        isIncome: true,
        isSavings: false,
      },

      /*
       * --------------------------------------------------------
       * EXPENSES
       * --------------------------------------------------------
       */

      ...MONTHLY_EXPENSES.map((line) => ({
        name: line.name,
        category: line.category,
        amount: line.amount,
        isIncome: false,
        isSavings: false,
      })),

      /*
       * --------------------------------------------------------
       * SAVINGS
       * --------------------------------------------------------
       */

      {
        name: "Savings",
        category: "savings",
        amount: MONTHLY_SAVINGS,
        isIncome: false,
        isSavings: true,
      },
    ],
  };
}

/*
 * ============================================================
 * BUDGETED INCOME
 * ============================================================
 */

export function getBudgetedIncome(
  budget: MonthlyBudget
): number {
  return budget.lines
    .filter((line) => line.isIncome)
    .reduce(
      (total, line) => total + line.amount,
      0
    );
}

/*
 * ============================================================
 * BUDGETED EXPENSES
 * ============================================================
 */

export function getBudgetedExpenses(
  budget: MonthlyBudget
): number {
  return budget.lines
    .filter(
      (line) =>
        !line.isIncome &&
        !line.isSavings
    )
    .reduce(
      (total, line) => total + line.amount,
      0
    );
}

/*
 * ============================================================
 * BUDGETED SAVINGS
 * ============================================================
 */

export function getBudgetedSavings(
  budget: MonthlyBudget
): number {
  return budget.lines
    .filter((line) => line.isSavings)
    .reduce(
      (total, line) => total + line.amount,
      0
    );
}

/*
 * ============================================================
 * DEFAULT EXPORT
 * ============================================================
 */

const budget = {
  getMonthlyBudget,
  getBudgetedIncome,
  getBudgetedExpenses,
  getBudgetedSavings,
};

export default budget;