import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { createUser } from "./database";
import { sendApiKeyEmail } from "./email";

const CRYPTOBOT_API = process.env.CRYPTOBOT_API_URL || "https://pay.crypt.bot/api";
const CRYPTOBOT_TOKEN = () => process.env.CRYPTOBOT_API_TOKEN || "";

// --- Create Invoice ---

interface CreateInvoiceResult {
  success: boolean;
  pay_url?: string;
  invoice_id?: number;
  error?: string;
}

export async function createCryptoBotInvoice(
  amount: number,
  email: string
): Promise<CreateInvoiceResult> {
  const token = CRYPTOBOT_TOKEN();
  if (!token) {
    return { success: false, error: "CRYPTOBOT_API_TOKEN not configured" };
  }

  const res = await fetch(`${CRYPTOBOT_API}/createInvoice`, {
    method: "POST",
    headers: {
      "Crypto-Pay-API-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currency_type: "fiat",
      fiat: "USD",
      accepted_assets: "USDT,TON,BTC,ETH,LTC,BNB,TRX,USDC",
      amount: amount.toFixed(2),
      description: `MCP SMS Server — $${amount.toFixed(2)} balance top-up`,
      payload: JSON.stringify({ email, amount }),
      expires_in: 3600,
    }),
  });

  const data = (await res.json()) as {
    ok: boolean;
    result?: { pay_url?: string; mini_app_invoice_url?: string; invoice_id?: number };
    error?: { message?: string };
  };

  if (!data.ok) {
    return { success: false, error: data.error?.message || "CryptoBot API error" };
  }

  return {
    success: true,
    pay_url: data.result?.pay_url || data.result?.mini_app_invoice_url,
    invoice_id: data.result?.invoice_id,
  };
}

// --- Webhook signature verification ---

export function verifyCryptoBotSignature(
  rawBody: string,
  signature: string | undefined
): boolean {
  const token = CRYPTOBOT_TOKEN();
  if (!token || !signature) return false;

  const secret = crypto.createHash("sha256").update(token).digest();
  const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  } catch {
    return false;
  }
}

// --- Webhook handler ---

interface WebhookResult {
  success: boolean;
  api_key?: string;
  email?: string;
  balance?: number;
  error?: string;
}

export async function handleCryptoBotWebhook(
  rawBody: string,
  signatureHeader: string | undefined
): Promise<WebhookResult> {
  if (!verifyCryptoBotSignature(rawBody, signatureHeader)) {
    return { success: false, error: "Invalid signature" };
  }

  const update = JSON.parse(rawBody);

  if (update.update_type !== "invoice_paid") {
    return { success: true }; // ack but ignore
  }

  const invoice = update.payload;

  // Extract email and amount from our custom payload
  let email: string | undefined;
  let balance = 0;

  try {
    const custom = JSON.parse(invoice.payload || "{}");
    email = custom.email;
    balance = custom.amount || parseFloat(invoice.amount) || 10;
  } catch {
    balance = parseFloat(invoice.amount) || 10;
  }

  if (!email) {
    return { success: false, error: "No email in invoice payload" };
  }

  // Create user with API key
  const apiKey = `sk-sms-${uuidv4()}`;
  createUser(apiKey, balance);

  console.error(`[webhook] New user: ${email}, balance: $${balance}, key: ${apiKey.slice(0, 12)}...`);

  // Send email with API key
  const serverUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`;
  try {
    await sendApiKeyEmail(email, apiKey, balance, serverUrl);
    console.error(`[webhook] Email sent to ${email}`);
  } catch (err: any) {
    console.error(`[webhook] Email failed: ${err.message}`);
  }

  return { success: true, api_key: apiKey, email, balance };
}
