import { Resend } from "resend";

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY not configured");
    resend = new Resend(key);
  }
  return resend;
}

const FROM_EMAIL = process.env.FROM_EMAIL || "MCP SMS <onboarding@resend.dev>";

export async function sendApiKeyEmail(
  to: string,
  apiKey: string,
  balanceUsd: number,
  serverUrl: string
): Promise<void> {
  const r = getResend();

  await r.emails.send({
    from: FROM_EMAIL,
    to,
    subject: "Your API key for MCP SMS Server",
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Thanks for your purchase!</h2>
        <p>Your MCP SMS Server is ready to use.</p>

        <div style="background: #f4f4f5; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <p style="margin: 0 0 8px; color: #71717a; font-size: 14px;">API Key</p>
          <code style="font-size: 16px; word-break: break-all;">${apiKey}</code>
        </div>

        <p><strong>Balance:</strong> $${balanceUsd.toFixed(2)}</p>

        <h3>How to connect</h3>
        <p>Add this to your MCP client settings:</p>
        <pre style="background: #18181b; color: #e4e4e7; padding: 16px; border-radius: 8px; overflow-x: auto;">{
  "mcpServers": {
    "sms": {
      "url": "${serverUrl}/sse",
      "headers": {
        "X-API-Key": "${apiKey}"
      }
    }
  }
}</pre>

        <h3>Available tools</h3>
        <ul>
          <li><code>buy_number</code> — buy a virtual number</li>
          <li><code>get_sms</code> — check for incoming SMS</li>
          <li><code>release_number</code> — cancel and refund</li>
          <li><code>list_services</code> — browse services and prices</li>
          <li><code>get_balance</code> — check your balance</li>
        </ul>

        <p style="color: #71717a; font-size: 13px; margin-top: 30px;">
          Keep your API key safe. If you need help, reply to this email.
        </p>
      </div>
    `,
  });
}
