import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "sms-server.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const fs = require("fs");
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      api_key TEXT PRIMARY KEY,
      email TEXT,
      balance_usd REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);
  // migrate: add email column if missing (for existing DBs)
  const cols = db.pragma("table_info(users)") as { name: string }[];
  if (!cols.find(c => c.name === "email")) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT;");
    db.exec("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);");
  }
  db.exec(`

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (api_key) REFERENCES users(api_key)
    );

    CREATE TABLE IF NOT EXISTS active_numbers (
      number_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      api_key TEXT NOT NULL,
      phone_number TEXT,
      service TEXT,
      cost_usd REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (number_id, provider),
      FOREIGN KEY (api_key) REFERENCES users(api_key)
    );
  `);
}

export function validateApiKey(apiKey: string): { valid: boolean; balance: number } {
  const db = getDb();
  const user = db.prepare("SELECT balance_usd FROM users WHERE api_key = ?").get(apiKey) as
    | { balance_usd: number }
    | undefined;

  if (!user) {
    return { valid: false, balance: 0 };
  }
  return { valid: true, balance: user.balance_usd };
}

export function getBalance(apiKey: string): number {
  const db = getDb();
  const user = db.prepare("SELECT balance_usd FROM users WHERE api_key = ?").get(apiKey) as
    | { balance_usd: number }
    | undefined;
  return user?.balance_usd ?? 0;
}

export function deductBalance(apiKey: string, amount: number, description: string): boolean {
  const db = getDb();
  const txn = db.transaction(() => {
    const user = db.prepare("SELECT balance_usd FROM users WHERE api_key = ?").get(apiKey) as
      | { balance_usd: number }
      | undefined;

    if (!user || user.balance_usd < amount) {
      return false;
    }

    db.prepare("UPDATE users SET balance_usd = balance_usd - ? WHERE api_key = ?").run(
      amount,
      apiKey
    );
    db.prepare(
      "INSERT INTO transactions (api_key, amount, type, description) VALUES (?, ?, 'spend', ?)"
    ).run(apiKey, amount, description);
    return true;
  });
  return txn();
}

export function addBalance(apiKey: string, amount: number, description: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE users SET balance_usd = balance_usd + ? WHERE api_key = ?").run(
      amount,
      apiKey
    );
    db.prepare(
      "INSERT INTO transactions (api_key, amount, type, description) VALUES (?, ?, 'topup', ?)"
    ).run(apiKey, amount, description);
  })();
}

export function createUser(apiKey: string, initialBalance: number = 0, email?: string): void {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO users (api_key, email, balance_usd) VALUES (?, ?, ?)").run(
    apiKey,
    email || null,
    initialBalance
  );
}

export function getApiKeyByEmail(email: string): string | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT api_key FROM users WHERE email = ? ORDER BY created_at DESC LIMIT 1")
    .get(email) as { api_key: string } | undefined;
  return row?.api_key;
}

export function saveActiveNumber(
  numberId: string,
  provider: string,
  apiKey: string,
  phoneNumber: string,
  service: string,
  costUsd: number
): void {
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO active_numbers (number_id, provider, api_key, phone_number, service, cost_usd) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(numberId, provider, apiKey, phoneNumber, service, costUsd);
}

export function getActiveNumber(
  numberId: string,
  provider: string
): { api_key: string; cost_usd: number } | undefined {
  const db = getDb();
  return db
    .prepare("SELECT api_key, cost_usd FROM active_numbers WHERE number_id = ? AND provider = ?")
    .get(numberId, provider) as { api_key: string; cost_usd: number } | undefined;
}

export function removeActiveNumber(numberId: string, provider: string): void {
  const db = getDb();
  db.prepare("DELETE FROM active_numbers WHERE number_id = ? AND provider = ?").run(
    numberId,
    provider
  );
}
