import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

export async function getDb(): Promise<Pool> {
  return pool;
}

export async function validateApiKey(apiKey: string): Promise<{ valid: boolean; balance: number }> {
  const { rows } = await pool.query(
    "SELECT balance_usd FROM users WHERE api_key = $1",
    [apiKey]
  );
  if (rows.length === 0) return { valid: false, balance: 0 };
  return { valid: true, balance: parseFloat(rows[0].balance_usd) };
}

export async function getBalance(apiKey: string): Promise<number> {
  const { rows } = await pool.query(
    "SELECT balance_usd FROM users WHERE api_key = $1",
    [apiKey]
  );
  return rows.length > 0 ? parseFloat(rows[0].balance_usd) : 0;
}

export async function deductBalance(
  apiKey: string,
  amount: number,
  description: string
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT balance_usd FROM users WHERE api_key = $1 FOR UPDATE",
      [apiKey]
    );
    if (rows.length === 0 || parseFloat(rows[0].balance_usd) < amount) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      "UPDATE users SET balance_usd = balance_usd - $1 WHERE api_key = $2",
      [amount, apiKey]
    );
    await client.query(
      "INSERT INTO transactions (api_key, amount, type, description) VALUES ($1, $2, 'spend', $3)",
      [apiKey, amount, description]
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function addBalance(
  apiKey: string,
  amount: number,
  description: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE users SET balance_usd = balance_usd + $1 WHERE api_key = $2",
      [amount, apiKey]
    );
    await client.query(
      "INSERT INTO transactions (api_key, amount, type, description) VALUES ($1, $2, 'topup', $3)",
      [apiKey, amount, description]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function createUser(
  apiKey: string,
  initialBalance: number = 0,
  email?: string
): Promise<void> {
  await pool.query(
    "INSERT INTO users (api_key, email, balance_usd) VALUES ($1, $2, $3) ON CONFLICT (api_key) DO NOTHING",
    [apiKey, email || null, initialBalance]
  );
}

export async function getApiKeyByEmail(email: string): Promise<string | undefined> {
  const { rows } = await pool.query(
    "SELECT api_key FROM users WHERE email = $1 ORDER BY created_at DESC LIMIT 1",
    [email]
  );
  return rows[0]?.api_key;
}

export async function saveActiveNumber(
  numberId: string,
  provider: string,
  apiKey: string,
  phoneNumber: string,
  service: string,
  costUsd: number
): Promise<void> {
  await pool.query(
    `INSERT INTO active_numbers (number_id, provider, api_key, phone_number, service, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (number_id, provider) DO UPDATE
     SET phone_number = $4, service = $5, cost_usd = $6`,
    [numberId, provider, apiKey, phoneNumber, service, costUsd]
  );
}

export async function getActiveNumber(
  numberId: string,
  provider: string
): Promise<{ api_key: string; cost_usd: number } | undefined> {
  const { rows } = await pool.query(
    "SELECT api_key, cost_usd FROM active_numbers WHERE number_id = $1 AND provider = $2",
    [numberId, provider]
  );
  if (!rows[0]) return undefined;
  return { api_key: rows[0].api_key, cost_usd: parseFloat(rows[0].cost_usd) };
}

export async function removeActiveNumber(numberId: string, provider: string): Promise<void> {
  await pool.query(
    "DELETE FROM active_numbers WHERE number_id = $1 AND provider = $2",
    [numberId, provider]
  );
}
