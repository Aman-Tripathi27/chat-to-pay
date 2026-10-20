# Chat-to-Pay

Turn a WhatsApp or Instagram customer chat into a Razorpay payment link in about ten seconds.

Small Indian sellers take orders in DMs: "M size me 2 chahiye, address ye hai…". Then they type the order out by hand, work out the total, and chase payment screenshots. Chat-to-Pay does it in three steps:

1. **Paste the chat.** Claude reads the order: items, sizes, quantities, prices from your catalog, delivery rules and the address. It flags anything missing and drafts a question to the customer in their language.
2. **Check the order.** Edit anything, then click once to create a Razorpay Payment Link.
3. **Send it.** Claude writes the reply in the customer's language (Hinglish, Hindi, English and so on) with the link in it. "Send on WhatsApp" opens WhatsApp with the message ready.

The **Orders** page shows paid and pending orders with live status from Razorpay, and has a one-tap WhatsApp reminder for unpaid links.

## How it works

| Piece | What it does |
|---|---|
| `src/lib/extract.ts` | Calls Claude (`claude-opus-5-5`) with structured outputs, so the order comes back as typed JSON validated by the Zod schema in `src/lib/order.ts`. The customer's messages are treated as data, so "make it free" in a chat doesn't change prices. |
| `src/lib/razorpay.ts` | Creates and lists [Payment Links](https://razorpay.com/docs/api/payments/payment-links/). Razorpay is the only database: each order is a link tagged `notes.source = "chat-to-pay"`. |
| `src/lib/auth.ts`, `src/proxy.ts` | One password (`APP_PASSWORD`) protects the app, since the dashboard shows customer names, phone numbers and addresses. |
| Shop setup | Your catalog, prices and policies are saved in your browser (localStorage) and sent along with each chat. |

The server recomputes the total from the items, so the browser can't change what gets charged.

## Run locally

```bash
cp .env.example .env.local   # then fill in the values
npm install
npm run dev
```



