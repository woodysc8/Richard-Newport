const fs = require('fs');
const path = require('path');
const fetch = globalThis.fetch || require('node-fetch');

function loadEnv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
if (!fs.existsSync(envPath)) {
  console.error('.env.local not found in project root');
  process.exit(1);
}

const env = loadEnv(envPath);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const FIXED_USER_ID = '4ac12929-b795-474e-9001-56190c6c4daf';

function norm(s) { return (s || '').toLowerCase(); }

const ARB_MERCHANTS = ['draftkings','fliff','bally bet','ballybet','betrivers','rebet','prophetx','bet'];
const GAMBLING_MERCHANTS = ['caesars','casino','mgm','betmgm'];
const TRANSFER_KEYWORDS = ['venmo','cash app','cashapp','paypal','transfer','zelle','deposit','withdrawal','ach','move','p2p'];
const INVESTMENT_KEYWORDS = ['robinhood','schwab','fidelity','vanguard'];
const CREDIT_PAYMENT_KEYWORDS = ['bilt','card payment','credit card payment','cc payment'];
const PAYROLL_KEYWORDS = ['gusto','payroll','paycheck','salary','direct deposit'];

function classify(tx) {
  const name = norm(tx.name);
  const merchant = norm(tx.merchant_name);
  const category = norm(tx.category);
  const merchantContains = (arr) => arr.some(k => merchant.includes(k) || name.includes(k));

  if (merchantContains(ARB_MERCHANTS)) return { financial_type: 'arbitrage', budget_category: null, include_in_income:false, include_in_spending:false, confidence:'high', classification_reason:`Matched arb merchant: ${merchant||name}` };
  if (merchantContains(GAMBLING_MERCHANTS) || category.includes('gambling') || name.includes('casino')) return { financial_type:'gambling', budget_category:'entertainment', include_in_income:false, include_in_spending:true, confidence:'high', classification_reason:`Matched gambling merchant/category: ${merchant||name}` };
  if (merchantContains(INVESTMENT_KEYWORDS) || category.includes('investment') || name.includes('investment')) return { financial_type:'investment', budget_category:null, include_in_income:false, include_in_spending:false, confidence:'high', classification_reason:`Matched investment merchant/category: ${merchant||name}` };
  if (merchantContains(CREDIT_PAYMENT_KEYWORDS) || category.includes('credit card payment') || name.includes('card payment') || name.includes('bill pay')) return { financial_type:'credit_card_payment', budget_category:null, include_in_income:false, include_in_spending:false, confidence:'high', classification_reason:`Matched credit card payment: ${merchant||name}` };
  if (merchantContains(PAYROLL_KEYWORDS) || category.includes('payroll') || category.includes('salary') || name.includes('check deposit') || name.includes('check')) return { financial_type:'income', budget_category:null, include_in_income:true, include_in_spending:false, confidence:'high', classification_reason:`Matched payroll/deposit: ${merchant||name}` };
  if (merchantContains(TRANSFER_KEYWORDS) || category.includes('transfer') || name.includes('transfer') || name.includes('withdrawal') || name.includes('deposit')) return { financial_type:'transfer', budget_category:null, include_in_income:false, include_in_spending:false, confidence:'medium', classification_reason:`Matched transfer-like merchant/category: ${merchant||name}` };

  if (category && (category.includes('shops') || category.includes('food') || category.includes('restaurant') || category.includes('travel') || category.includes('gas') || category.includes('transportation') || category.includes('health') || category.includes('entertainment') || category.includes('shopping') || category.includes('grocery') || category.includes('grocer') )) {
    let budget = 'other';
    if (category.includes('housing')) budget = 'housing';
    else if (category.includes('food') && category.includes('restaurant')) budget = 'food';
    else if (category.includes('grocery') || category.includes('grocer')) budget = 'groceries';
    else if (category.includes('transportation') || category.includes('gas')) budget = 'transportation';
    else if (category.includes('entertainment') || category.includes('arts') || category.includes('recreation')) budget = 'entertainment';
    else if (category.includes('shopping') || category.includes('retail') || category.includes('shops')) budget = 'shopping';
    else if (category.includes('health') || category.includes('medical')) budget = 'healthcare';
    else if (category.includes('travel') || category.includes('airlines') || category.includes('lodging')) budget = 'travel';
    else if (category.includes('service') && name.includes('subscription')) budget = 'subscriptions';
    return { financial_type:'spending', budget_category:budget, include_in_income:false, include_in_spending:true, confidence:'medium', classification_reason:`Mapped from Plaid category: ${tx.category}` };
  }

  return { financial_type:'unknown', budget_category:null, include_in_income:false, include_in_spending:false, confidence:'low', classification_reason:'No strong pattern matched; manual review needed' };
}

async function fetchTransactions() {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/transactions?select=id,date,name,merchant_name,amount,category,pending,plaid_transaction_id&user_id=eq.${FIXED_USER_ID}&order=date.desc&limit=1000`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: 'application/json'
    }
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase fetch failed: ${res.status} ${txt}`);
  }
  return res.json();
}

(async () => {
  try {
    const txs = await fetchTransactions();

    const totals = { income:0, spending:0, transfers:0, credit_card_payments:0, investments:0, arbitrage:0, gambling:0, by_budget_category:{} };
    const examples = [];

    for (const tx of txs) {
      const cls = classify(tx);
      const amt = Number(tx.amount) || 0;
      if (cls.include_in_income) totals.income += amt;
      if (cls.include_in_spending) totals.spending += amt;
      if (cls.financial_type === 'transfer') totals.transfers += amt;
      if (cls.financial_type === 'credit_card_payment') totals.credit_card_payments += amt;
      if (cls.financial_type === 'investment') totals.investments += amt;
      if (cls.financial_type === 'arbitrage') totals.arbitrage += amt;
      if (cls.financial_type === 'gambling') totals.gambling += amt;
      if (cls.budget_category) totals.by_budget_category[cls.budget_category] = (totals.by_budget_category[cls.budget_category] || 0) + amt;

      if (examples.length < 20) {
        examples.push({ id: tx.id, date: tx.date, name: tx.name, merchant_name: tx.merchant_name, amount: tx.amount, old_category: tx.category, classification: cls });
      }
    }

    console.log('Totals:', JSON.stringify(totals, null, 2));
    console.log('\nExamples:', JSON.stringify(examples, null, 2));
  } catch (err) {
    console.error('Error running diagnosis:', err);
    process.exit(1);
  }
})();
