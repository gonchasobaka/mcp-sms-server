# MCP SMS Server

> SMS verification for AI agents. Buy virtual phone numbers and receive codes — autonomously.

[![MCP](https://img.shields.io/badge/MCP-compatible-00ffe0?style=flat-square)](https://modelcontextprotocol.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square)](https://www.typescriptlang.org)
[![Railway](https://img.shields.io/badge/hosted-Railway-7c3aed?style=flat-square)](https://railway.app)
[![License](https://img.shields.io/badge/license-ISC-gray?style=flat-square)](#)

---

## What is this?

An MCP server that gives AI agents the ability to buy virtual phone numbers and receive SMS verification codes — without any human involvement.

Your agent calls `buy_number`, gets a phone number, enters it on a website, then calls `get_sms` to retrieve the code. The whole flow runs autonomously.

Works with **Claude Desktop**, **Cursor**, **Windsurf**, and any MCP-compatible client.

---

## Quick Start

**1. Get an API key**

Top up your balance at [mcp-sms.up.railway.app](https://mcp-sms.up.railway.app) — pay with crypto via CryptoBot (USDT, TON, BTC, ETH). Your API key is sent to your email after payment.

**2. Add to your MCP client**

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sms": {
      "url": "https://mcp-sms.up.railway.app/sse"
    }
  }
}
```

Cursor / Windsurf (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "sms": {
      "url": "https://mcp-sms.up.railway.app/sse"
    }
  }
}
```

**3. Use it**

```
You: "Register a new GitHub account and verify the phone number"

→ buy_number({ api_key: "...", service: "github", country: "any" })
← { phone: "+14155552671", number_id: "abc123", price: "$0.30" }

→ get_sms({ api_key: "...", number_id: "abc123", provider: "5sim" })
← { status: "received", code: "847291" }
```

---

## Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `buy_number` | Purchase a virtual number. Auto-picks cheapest provider. | `api_key`, `service`, `country`, `provider?` |
| `get_sms` | Poll for incoming SMS. Returns code when received. | `api_key`, `number_id`, `provider` |
| `release_number` | Cancel a number. Refunds balance automatically. | `api_key`, `number_id`, `provider` |
| `list_services` | Browse 500+ services with live prices. | `api_key`, `country?`, `search?` |
| `get_balance` | Check your current balance. | `api_key` |

---

## Usage examples

### Bulk account creation

```python
for service in target_services:
    num = buy_number(api_key=KEY, service="twitter", country="any")
    code = get_sms(api_key=KEY, number_id=num["number_id"], provider=num["provider"])
    # submit code on the website
    release_number(api_key=KEY, number_id=num["number_id"], provider=num["provider"])
```

### Automated QA pipeline

```python
# Test your app's SMS verification flow end-to-end
num = buy_number(api_key=KEY, service="your_app", country="us")
trigger_verification(num["phone"])
result = get_sms(api_key=KEY, number_id=num["number_id"], provider=num["provider"])
assert result["code"] is not None
```

### Claude Desktop (natural language)

```
You: "Create a Telegram account for the project"

Claude calls buy_number → enters phone on Telegram → calls get_sms → enters code
Done. No copy-pasting, no phone needed.
```

---

## Pricing

Pay as you go. Top up any amount. Prices vary by service and country.

| Service | Country | Per SMS |
|---------|---------|---------|
| Telegram | Russia | ~$0.18 |
| GitHub | USA | ~$0.30 |
| WhatsApp | India | ~$0.12 |
| Google | any | ~$0.16 |
| Twitter / X | UK | ~$0.44 |

SMS not received? Balance is not charged. Call `release_number` to get a full refund.

---

## Providers

The server queries all providers in parallel and routes to the cheapest available option:

- [5sim](https://5sim.net)
- [SMS-Activate](https://sms-activate.io)
- [OnlineSim](https://onlinesim.io)

---

## Self-hosting

### Prerequisites

- Node.js 20+
- API keys from at least one SMS provider

### Setup

```bash
git clone https://github.com/gonchasobaka/mcp-sms-server
cd mcp-sms-server
npm install
cp .env.example .env
# fill in your keys
npm run build
npm start
```

### Environment variables

```env
# SMS providers (at least one required)
FIVESIM_API_KEY=
SMSACTIVATE_API_KEY=
ONLINESIM_API_KEY=

# Server
PORT=3000
TRANSPORT=sse
SERVER_URL=https://your-domain.com

# Payments
CRYPTOBOT_TOKEN=

# Email (Resend)
RESEND_API_KEY=
FROM_EMAIL=noreply@yourdomain.com
```

### Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

1. Fork this repo
2. Connect to Railway → Deploy from GitHub
3. Add environment variables
4. Done — Railway gives you a public URL

---

## HTTP API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Server status |
| `GET` | `/balance` | Balance check (`X-API-Key` header) |
| `POST` | `/create-invoice` | Create CryptoBot payment (`amount`, `email`) |
| `POST` | `/webhook/cryptobot` | Payment webhook |
| `GET` | `/sse` | MCP SSE transport |

---

## License

ISC
