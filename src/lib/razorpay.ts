import {
  itemsSummary,
  normalizePhone,
  orderTotal,
  type CreateLinkInput,
  type OrderRow,
} from "@/lib/order";

// Razorpay is the database: each order is a Payment Link, tagged via notes so
// the dashboard can tell our links apart from the merchant's other links.
const API = "https://api.razorpay.com/v1";
const SOURCE_TAG = "chat-to-pay";
const LINK_VALIDITY_SECONDS = 7 * 24 * 60 * 60;

export type RazorpayMode = "live" | "test" | "demo";

export function razorpayMode(): RazorpayMode {
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  if (!keyId || !process.env.RAZORPAY_KEY_SECRET) return "demo";
  return keyId.startsWith("rzp_live_") ? "live" : "test";
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

interface PaymentLink {
  id: string;
  short_url: string;
  status: OrderRow["status"];
  amount: number;
  amount_paid: number;
  created_at: number;
  customer?: { name?: string; contact?: string } | null;
  notes?: Record<string, string> | unknown[] | null;
}

function notesOf(link: PaymentLink): Record<string, string> {
  // Razorpay returns [] instead of {} when a link has no notes.
  return link.notes && !Array.isArray(link.notes) ? (link.notes as Record<string, string>) : {};
}

function toRow(link: PaymentLink): OrderRow {
  const notes = notesOf(link);
  return {
    id: link.id,
    shortUrl: link.short_url,
    status: link.status,
    amount: link.amount / 100,
    amountPaid: link.amount_paid / 100,
    createdAt: link.created_at,
    customerName: link.customer?.name || null,
    customerPhone: link.customer?.contact || notes.phone || null,
    items: notes.items ?? "",
    language: notes.lang ?? null,
  };
}

async function razorpayFetch(path: string, init?: RequestInit): Promise<Response> {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  return fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
}

async function errorFrom(res: Response): Promise<RazorpayError> {
  let description = res.statusText;
  try {
    const body = await res.json();
    description = body?.error?.description ?? description;
  } catch {
    // keep statusText
  }
  if (res.status === 401) {
    return new RazorpayError("Razorpay rejected the API keys. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.", 500);
  }
  return new RazorpayError(`Razorpay: ${description}`, res.status >= 500 ? 502 : 400);
}

const clip = (s: string, max = 250) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function buildRequest(input: CreateLinkInput) {
  const total = orderTotal(input);
  const amountPaise = Math.round(total * 100);
  if (amountPaise < 100) throw new RazorpayError("The order total must be at least ₹1.", 400);

  const phone = normalizePhone(input.customer_phone);
  const summary = itemsSummary(input.items);
  const notes: Record<string, string> = { source: SOURCE_TAG, items: clip(summary) };
  if (input.shipping_address) notes.address = clip(input.shipping_address);
  if (input.pincode) notes.pincode = input.pincode;
  if (phone) notes.phone = phone;
  if (input.customer_language) notes.lang = clip(input.customer_language, 40);

  const customer: Record<string, string> = {};
  if (input.customer_name) customer.name = input.customer_name;
  if (phone) customer.contact = phone;
  if (input.customer_email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.customer_email)) {
    customer.email = input.customer_email;
  }

  return {
    amount: amountPaise,
    currency: "INR",
    accept_partial: false,
    description: clip(`${input.shop_name ? `${input.shop_name}: ` : ""}${summary}`, 2000),
    reference_id: `ctp_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
    expire_by: Math.floor(Date.now() / 1000) + LINK_VALIDITY_SECONDS,
    ...(Object.keys(customer).length ? { customer } : {}),
    // The seller sends the link on WhatsApp, so Razorpay doesn't need to.
    notify: { sms: false, email: false },
    reminder_enable: false,
    notes,
  };
}

// ---- Demo mode: no keys configured. Links live in memory and reset on restart.
const demoStore: Map<string, PaymentLink> = ((globalThis as Record<string, unknown>).__ctpDemo ??= new Map()) as Map<
  string,
  PaymentLink
>;

export async function createPaymentLink(input: CreateLinkInput): Promise<OrderRow> {
  const body = buildRequest(input);

  if (razorpayMode() === "demo") {
    const id = `plink_demo_${crypto.randomUUID().slice(0, 10)}`;
    const link: PaymentLink = {
      id,
      // .invalid is a reserved TLD, so a demo link can never be mistaken for a real one.
      short_url: `https://demo-link.invalid/${id}`,
      status: "created",
      amount: body.amount,
      amount_paid: 0,
      created_at: Math.floor(Date.now() / 1000),
      customer: body.customer ?? null,
      notes: body.notes,
    };
    demoStore.set(id, link);
    return toRow(link);
  }

  const res = await razorpayFetch("/payment_links/", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw await errorFrom(res);
  return toRow((await res.json()) as PaymentLink);
}

export async function listOrders(): Promise<OrderRow[]> {
  let links: PaymentLink[];

  if (razorpayMode() === "demo") {
    links = [...demoStore.values()];
  } else {
    // `count` isn't in the documented query params, so fall back if Razorpay rejects it.
    let res = await razorpayFetch("/payment_links/?count=100");
    if (res.status === 400) res = await razorpayFetch("/payment_links/");
    if (!res.ok) throw await errorFrom(res);
    const body = (await res.json()) as { payment_links?: PaymentLink[]; items?: PaymentLink[] };
    links = body.payment_links ?? body.items ?? [];
  }

  return links
    .filter((l) => notesOf(l).source === SOURCE_TAG)
    .map(toRow)
    .sort((a, b) => b.createdAt - a.createdAt);
}
