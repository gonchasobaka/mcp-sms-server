/**
 * CLI utility for managing users and balances.
 *
 * Usage:
 *   npx ts-node src/cli.ts create-user [initial_balance]
 *   npx ts-node src/cli.ts add-balance <api_key> <amount>
 *   npx ts-node src/cli.ts check-balance <api_key>
 *   npx ts-node src/cli.ts list-users
 */
import dotenv from "dotenv";
dotenv.config();

import { v4 as uuidv4 } from "uuid";
import { createUser, addBalance, getBalance, getDb } from "./database";

const [, , command, ...args] = process.argv;

switch (command) {
  case "create-user": {
    const balance = parseFloat(args[0] || "0");
    const apiKey = `sk-sms-${uuidv4()}`;
    createUser(apiKey, balance);
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
    addBalance(apiKey, parseFloat(amount), "manual top-up via CLI");
    const newBalance = getBalance(apiKey);
    console.log(`Balance updated. New balance: $${newBalance.toFixed(2)}`);
    break;
  }

  case "check-balance": {
    const apiKey = args[0];
    if (!apiKey) {
      console.error("Usage: check-balance <api_key>");
      process.exit(1);
    }
    const balance = getBalance(apiKey);
    console.log(`Balance: $${balance.toFixed(2)}`);
    break;
  }

  case "list-users": {
    const db = getDb();
    const users = db.prepare("SELECT api_key, balance_usd, created_at FROM users").all() as {
      api_key: string;
      balance_usd: number;
      created_at: string;
    }[];
    if (users.length === 0) {
      console.log("No users found.");
    } else {
      console.log("Users:");
      for (const u of users) {
        console.log(`  ${u.api_key} | $${u.balance_usd.toFixed(2)} | ${u.created_at}`);
      }
    }
    break;
  }

  default:
    console.log("Commands:");
    console.log("  create-user [initial_balance]  - Create a new user with API key");
    console.log("  add-balance <api_key> <amount> - Add balance to user");
    console.log("  check-balance <api_key>        - Check user balance");
    console.log("  list-users                     - List all users");
}
