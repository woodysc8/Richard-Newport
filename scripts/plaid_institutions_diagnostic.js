const fs = require('fs');
const path = require('path');
const { Configuration, PlaidApi } = require('plaid');

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
const configuration = new Configuration({
  basePath: env.PLAID_ENV === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com',
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': env.PLAID_CLIENT_ID,
      'PLAID-SECRET': env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

const QUERIES = ['Bilt','Barclays','Venmo','Robinhood'];

async function run() {
  const results = {};
  for (const q of QUERIES) {
    try {
      const reqBody = { query: q, country_codes: ['US'] };
      const resp = await plaidClient.institutionsSearch(reqBody);
      const institutions = resp.data?.institutions ?? [];
      if (!institutions || institutions.length === 0) {
        results[q] = { found: false, institutions: [] };
        continue;
      }

      results[q] = {
        found: true,
        institutions: institutions.map(i => ({
          name: i.name,
          institution_id: i.institution_id,
          products: i.products,
          country_codes: i.country_codes,
          oauth: i.oauth || false,
          supports_transactions: (i.products || []).includes('transactions'),
          supports_investments: (i.products || []).includes('investments'),
        })),
      };
    } catch (err) {
      const plaidErr = err?.response?.data ?? err?.message ?? String(err);
      const status = err?.response?.status ?? null;
      results[q] = { found: false, error: plaidErr, status };
    }
  }

  console.log(JSON.stringify({ success: true, results }, null, 2));
}

run().catch(err => { console.error(err); process.exit(1); });
