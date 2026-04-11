import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { createUser } from "./database";
import { sendApiKeyEmail } from "./email";

// LemonSqueezy product variant → balance mapping
// Configure via LEMON_PLANS env: "variant_id1:amount1,variant_id2:amount2"
function getPlans(): Map<string, number> {
  const plans = new Map<string, number>();
  const raw = process.env.LEMON_PLANS || "";
  if (raw) {
    for (const pair of raw.split(",")) {
      const [variantId, amount] = pair.split(":");
      if (variantId && amount) {
        plans.set(variantId.trim(), parseFloat(amount));
      }
    }
  }
  // Fallback defaults based on plan doc
  if (plans.size === 0) {
    plans.set("starter", 10);
    plans.set("pro", 25);
    plans.set("unlimited", 50);
  }
  return plans;
}

export function verifyLemonSignature(
  payload: string,
  signature: string | undefined
): boolean {
  const secret = process.env.LEMON_SIGNING_SECRET;
  if (!secret) {
    console.error("[webhook] LEMON_SIGNING_SECRET not set — skipping verification");
    return false;
  }
  if (!signature) return false;

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  const digest = hmac.digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

interface WebhookResult {
  success: boolean;
  api_key?: string;
  email?: string;
  balance?: number;
  error?: string;
}

export async function handleLemonWebhook(
  rawBody: string,
  signatureHeader: string | undefined
): Promise<WebhookResult> {
  // Verify signature
  if (!verifyLemonSignature(rawBody, signatureHeader)) {
    return { success: false, error: "Invalid signature" };
  }

  const payload = JSON.parse(rawBody);
  const eventName = payload.meta?.event_name;

  // Only process successful orders
  if (eventName !== "order_created") {
    return { success: true }; // ack but ignore
  }

  const email = payload.data?.attributes?.user_email;
  if (!email) {
    return { success: false, error: "No email in webhook payload" };
  }

  // Determine balance from variant
  const variantId = String(
    payload.data?.attributes?.first_order_item?.variant_id || ""
  );
  const variantName = String(
    payload.data?.attributes?.first_order_item?.variant_name || ""
  ).toLowerCase();
  const totalUsd = parseFloat(
    payload.data?.attributes?.total_usd || "0"
  ) / 100; // LemonSqueezy sends cents

  const plans = getPlans();
  let balance = plans.get(variantId) || plans.get(variantName) || totalUsd;
  if (balance <= 0) balance = 10; // safe fallback

  // Create user
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
    // Don't fail the webhook — user is created, they can contact support
  }

  return { success: true, api_key: apiKey, email, balance };
}
