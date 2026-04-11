import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

import { SmsProvider } from "./types";
import { initProviders, getProviderByName, findCheapestProvider } from "./providers";
import {
  validateApiKey,
  getBalance,
  deductBalance,
  addBalance,
  saveActiveNumber,
  getActiveNumber,
  removeActiveNumber,
  getDb,
} from "./database";

const MARGIN = parseFloat(process.env.MARGIN_MULTIPLIER || "2");

// --- Init (providers populated in main()) ---
getDb();
let providers: SmsProvider[] = [];

const server = new McpServer({
  name: "mcp-sms-server",
  version: "1.0.0",
});

// --- Helper: extract API key from request context ---
// MCP doesn't natively pass HTTP headers through tool calls,
// so we accept api_key as a required parameter on each tool.

function assertAuth(apiKey: string): void {
  const { valid, balance } = validateApiKey(apiKey);
  if (!valid) {
    throw new Error("Invalid API key. Register first or check your key.");
  }
}

function assertBalance(apiKey: string, required: number): void {
  const balance = getBalance(apiKey);
  if (balance < required) {
    throw new Error(
      `Insufficient balance. Required: $${required.toFixed(4)}, available: $${balance.toFixed(4)}`
    );
  }
}

// ==========================================================
// Tool: buy_number
// ==========================================================
server.tool(
  "buy_number",
  "Buy a virtual phone number for receiving SMS from a specific service. Automatically picks the cheapest provider.",
  {
    api_key: z.string().describe("Your API key"),
    service: z.string().describe("Service name (e.g. telegram, whatsapp, google)"),
    country: z.string().default("any").describe("Country code or 'any'"),
    provider: z
      .string()
      .optional()
      .describe("Force specific provider: 5sim, sms-activate, onlinesim"),
  },
  async ({ api_key, service, country, provider: preferredProvider }) => {
    assertAuth(api_key);

    // Build ordered list of providers to try
    let candidates: { provider: SmsProvider; price: number }[] = [];

    if (preferredProvider) {
      const p = getProviderByName(providers, preferredProvider);
      if (!p) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Provider '${preferredProvider}' not found. Available: ${providers.map((p) => p.name).join(", ")}`,
              }),
            },
          ],
        };
      }
      const services = await p.getServices(country);
      const match = services.find((s) => s.service === service);
      candidates = [{ provider: p, price: match?.price_usd ?? 0 }];
    } else {
      candidates = await findCheapestProvider(providers, service, country);
      if (candidates.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Service '${service}' not available in country '${country}' from any provider.`,
              }),
            },
          ],
        };
      }
    }

    // Try each candidate, fallback to next on failure
    const errors: string[] = [];
    for (const { provider: selectedProvider, price: providerCost } of candidates) {
      const userPrice = providerCost * MARGIN;
      try {
        assertBalance(api_key, userPrice);
      } catch {
        errors.push(`${selectedProvider.name}: insufficient user balance for $${userPrice.toFixed(4)}`);
        continue;
      }

      try {
        const result = await selectedProvider.buyNumber(service, country);
        const actualCost = result.cost_usd > 0 ? result.cost_usd : providerCost;
        const finalPrice = actualCost * MARGIN;

        const deducted = deductBalance(
          api_key,
          finalPrice,
          `buy_number: ${service} via ${selectedProvider.name}`
        );
        if (!deducted) {
          await selectedProvider.releaseNumber(result.number_id).catch(() => {});
          errors.push(`${selectedProvider.name}: failed to deduct balance`);
          continue;
        }

        saveActiveNumber(
          result.number_id,
          selectedProvider.name,
          api_key,
          result.phone_number,
          service,
          finalPrice
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                number_id: result.number_id,
                phone_number: result.phone_number,
                provider: selectedProvider.name,
                price_usd: finalPrice,
              }),
            },
          ],
        };
      } catch (err: any) {
        errors.push(`${selectedProvider.name}: ${err.message}`);
        continue;
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: "All providers failed",
            details: errors,
          }),
        },
      ],
    };
  }
);

// ==========================================================
// Tool: get_sms
// ==========================================================
server.tool(
  "get_sms",
  "Check for incoming SMS on a purchased number. Poll this until you receive the code.",
  {
    api_key: z.string().describe("Your API key"),
    number_id: z.string().describe("Number ID from buy_number"),
    provider: z.string().describe("Provider name from buy_number response"),
  },
  async ({ api_key, number_id, provider: providerName }) => {
    assertAuth(api_key);

    const p = getProviderByName(providers, providerName);
    if (!p) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: `Provider '${providerName}' not found` }),
          },
        ],
      };
    }

    const result = await p.getSms(number_id);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result),
        },
      ],
    };
  }
);

// ==========================================================
// Tool: release_number
// ==========================================================
server.tool(
  "release_number",
  "Cancel/release a purchased number if SMS was not received. May refund the cost.",
  {
    api_key: z.string().describe("Your API key"),
    number_id: z.string().describe("Number ID to release"),
    provider: z.string().describe("Provider name"),
  },
  async ({ api_key, number_id, provider: providerName }) => {
    assertAuth(api_key);

    const p = getProviderByName(providers, providerName);
    if (!p) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: `Provider '${providerName}' not found` }),
          },
        ],
      };
    }

    await p.releaseNumber(number_id);

    // Refund user
    const activeNum = getActiveNumber(number_id, providerName);
    if (activeNum && activeNum.api_key === api_key) {
      addBalance(api_key, activeNum.cost_usd, `refund: release ${number_id}`);
      removeActiveNumber(number_id, providerName);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ success: true, message: "Number released and balance refunded" }),
        },
      ],
    };
  }
);

// ==========================================================
// Tool: list_services
// ==========================================================
server.tool(
  "list_services",
  "List available SMS services with prices across all providers. Shows the cheapest option for each service.",
  {
    api_key: z.string().describe("Your API key"),
    country: z.string().default("any").describe("Country filter"),
    search: z.string().optional().describe("Search/filter service name"),
  },
  async ({ api_key, country, search }) => {
    assertAuth(api_key);

    console.error(`[list_services] providers: ${providers.length}, country: ${country}, search: ${search}`);

    const allServices = await Promise.allSettled(
      providers.map((p) => p.getServices(country))
    );

    const serviceMap = new Map<
      string,
      { service: string; price_usd: number; provider: string; count: number }
    >();

    for (let i = 0; i < allServices.length; i++) {
      const result = allServices[i];
      if (result.status !== "fulfilled") {
        console.error(`[list_services] ${providers[i]?.name}: FAILED - ${result.reason?.message}`);
        continue;
      }
      console.error(`[list_services] ${providers[i]?.name}: ${result.value.length} services`);
      for (const svc of result.value) {
        if (search && !svc.service.toLowerCase().includes(search.toLowerCase())) {
          continue;
        }
        const userPrice = svc.price_usd * MARGIN;
        const existing = serviceMap.get(svc.service);
        if (!existing || userPrice < existing.price_usd) {
          serviceMap.set(svc.service, {
            service: svc.service,
            price_usd: userPrice,
            provider: svc.provider,
            count: svc.count,
          });
        }
      }
    }

    const services = Array.from(serviceMap.values())
      .sort((a, b) => a.service.localeCompare(b.service))
      .slice(0, 50);

    console.error(`[list_services] result: ${services.length} services (total unique: ${serviceMap.size})`);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ services, total: serviceMap.size }),
        },
      ],
    };
  }
);

// ==========================================================
// Tool: get_balance
// ==========================================================
server.tool(
  "get_balance",
  "Check your current balance in the SMS service.",
  {
    api_key: z.string().describe("Your API key"),
  },
  async ({ api_key }) => {
    assertAuth(api_key);
    const balance = getBalance(api_key);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ balance_usd: balance }),
        },
      ],
    };
  }
);

// ==========================================================
// Start server
// ==========================================================

import { handleLemonWebhook } from "./webhook";

function createExpressApp() {
  const app = express();

  // --- Webhook needs raw body for signature verification ---
  app.post(
    "/webhook/lemonsqueezy",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      try {
        const rawBody = req.body.toString("utf-8");
        const signature = req.headers["x-signature"] as string | undefined;
        const result = await handleLemonWebhook(rawBody, signature);

        if (!result.success) {
          res.status(400).json({ error: result.error });
          return;
        }
        res.json({ ok: true });
      } catch (err: any) {
        console.error("[webhook] Error:", err.message);
        res.status(500).json({ error: "Internal error" });
      }
    }
  );

  // --- JSON parsing for other routes ---
  app.use(express.json());

  // --- CORS ---
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // --- GET /health ---
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      providers: providers.map((p) => p.name),
    });
  });

  // --- GET /balance ---
  app.get("/balance", (req, res) => {
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (!apiKey) {
      res.status(401).json({ error: "Missing X-API-Key header" });
      return;
    }
    const { valid } = validateApiKey(apiKey);
    if (!valid) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }
    const balance = getBalance(apiKey);
    res.json({ balance_usd: balance });
  });

  // --- MCP SSE transport ---
  const sseTransports = new Map<string, SSEServerTransport>();

  app.get("/sse", async (req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    sseTransports.set(transport.sessionId, transport);
    await server.connect(transport);
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId || !sseTransports.has(sessionId)) {
      res.status(400).send("Invalid session");
      return;
    }
    const transport = sseTransports.get(sessionId)!;
    await transport.handlePostMessage(req, res);
  });

  return app;
}

async function main() {
  providers = await initProviders();
  const mode = process.env.TRANSPORT || "stdio";

  if (mode === "sse" || mode === "http") {
    const port = parseInt(process.env.PORT || "3000");
    const app = createExpressApp();

    app.listen(port, () => {
      console.log(`MCP SMS Server running on http://localhost:${port}`);
      console.log(`Endpoints: /sse /health /balance /webhook/lemonsqueezy`);
      console.log(`Providers: ${providers.map((p) => p.name).join(", ")}`);
    });
  } else {
    // stdio mode for local MCP usage
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP SMS Server started (stdio mode)");
    console.error(`Providers: ${providers.map((p) => p.name).join(", ")}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
