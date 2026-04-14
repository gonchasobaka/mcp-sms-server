/**
 * CLI utility for managing users and balances.
 *
 * Usage:
 *   npx ts-node src/cli.ts create-user [initial_balance] [email]
 *   npx ts-node src/cli.ts add-balance <api_key> <amount>
 *   npx ts-node src/cli.ts check-balance <api_key>
 *   npx ts-node src/cli.ts list-users
 */
import dotenv from "dotenv";
dotenv.config();

import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { createUser, addBalance, getBalance } from "./database";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const [, , command, ...args] = process.argv;

async function main() {
  switch (command) {
    case "create-user": {
      const balance = parseFloat(args[0] || "0");
      const email = args[1];
      const apiKey = `sk-sms-${uuidv4()}`;
      await createUser(apiKey, balance, email);
      console.log("User created!");
      console.log(`API Key: ${apiKey}`);
      console.log(`Balance: $${balance.toFixed(2)}`);
      break;
    }

    case "add-balance": {
      const [apiKey, amount] = args;
      if (!apiKey || !amount) {
        console.error("Usage: add-balance <api_key> <amount>");
        process.exit(1);
      }
      await addBalance(apiKey, parseFloat(amount), "manual top-up via CLI");
      const newBalance = await getBalance(apiKey);
      console.log(`Balance updated. New balance: $${newBalance.toFixed(2)}`);
      break;
    }

    case "check-balance": {
      const apiKey = args[0];
      if (!apiKey) {
        console.error("Usage: check-balance <api_key>");
        process.exit(1);
      }
      const balance = await getBalance(apiKey);
      console.log(`Balance: $${balance.toFixed(2)}`);
      break;
    }

    case "list-users": {
      const { rows } = await pool.query(
        "SELECT api_key, email, balance_usd, created_at FROM users ORDER BY created_at DESC"
      );
      if (rows.length === 0) {
        console.log("No users found.");
      } else {
        console.log("Users:");
        for (const u of rows) {
          console.log(`  ${u.api_key} | ${u.email || "no email"} | $${parseFloat(u.balance_usd).toFixed(2)} | ${u.created_at}`);
        }
      }
      break;
    }

    default:
      console.log("Commands:");
      console.log("  create-user [balance] [email]  - Create a new user with API key");
      console.log("  add-balance <api_key> <amount> - Add balance to user");
      console.log("  check-balance <api_key>        - Check user balance");
      console.log("  list-users                     - List all users");
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
