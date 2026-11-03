import { itemsSummary, normalizePhone, orderTotal, type CreateLinkInput, type OrderRow } from "@/lib/order";

// The app talks to payments only through PaymentLinkProvider, so any payment
// gateway can be plugged in. The built-in provider simulates links.

/** A provider-neutral description of the link to create. Amounts are in paise. */
export interface PaymentRequest {
  amountMinor: number;
  currency: "INR";
  description: string;
  referenceId: string;
  expiresAt: number; // unix seconds
  customer: { name?: string; phone?: string; email?: string };
  metadata: Record<string, string>;
}

export interface PaymentLinkProvider {
  readonly mode: "live" | "test" | "simulated";
  create(request: PaymentRequest): Promise<OrderRow>;
  list(): Promise<OrderRow[]>;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const SOURCE_TAG = "chat-to-pay";
const LINK_VALIDITY_SECONDS = 7 * 24 * 60 * 60;
// Short enough for the metadata limits common to payment gateways.
const clip = (s: string, max = 250) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Validates the order and turns it into a PaymentRequest. The server, not the browser, sets the amount. */
export function buildPaymentRequest(input: CreateLinkInput): PaymentRequest {
  const amountMinor = Math.round(orderTotal(input) * 100);
  if (amountMinor < 100) throw new PaymentError("The order total must be at least ₹1.", 400);

  const phone = normalizePhone(input.customer_phone);
  const summary = itemsSummary(input.items);
  const metadata: Record<string, string> = { source: SOURCE_TAG, items: clip(summary) };
  if (input.shipping_address) metadata.address = clip(input.shipping_address);
  if (input.pincode) metadata.pincode = input.pincode;
  if (phone) metadata.phone = phone;
  if (input.customer_language) metadata.lang = clip(input.customer_language, 40);

  const customer: PaymentRequest["customer"] = {};
  if (input.customer_name) customer.name = input.customer_name;
  if (phone) customer.phone = phone;
  if (input.customer_email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.customer_email)) {
    customer.email = input.customer_email;
  }

  return {
    amountMinor,
    currency: "INR",
    description: clip(`${input.shop_name ? `${input.shop_name}: ` : ""}${summary}`, 2000),
    referenceId: `ctp_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
    expiresAt: Math.floor(Date.now() / 1000) + LINK_VALIDITY_SECONDS,
    customer,
    metadata,
  };
}

/** Keeps links in memory until the server restarts, on the reserved pay.example domain. */
export class SimulatedProvider implements PaymentLinkProvider {
  readonly mode = "simulated" as const;
  private links = new Map<string, OrderRow>();

  async create(request: PaymentRequest): Promise<OrderRow> {
    const id = `plink_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const row: OrderRow = {
      id,
      shortUrl: `https://pay.example/${id.slice(6)}`,
      status: "created",
      amount: request.amountMinor / 100,
      amountPaid: 0,
      createdAt: Math.floor(Date.now() / 1000),
      customerName: request.customer.name ?? null,
      customerPhone: request.customer.phone ?? null,
      items: request.metadata.items ?? "",
      language: request.metadata.lang ?? null,
    };
    this.links.set(id, row);
    return row;
  }

  async list(): Promise<OrderRow[]> {
    return [...this.links.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
}

// One provider per server process (kept on globalThis so dev reloads don't reset it).
const holder = globalThis as { __ctpPaymentProvider?: PaymentLinkProvider };
holder.__ctpPaymentProvider ??= new SimulatedProvider();

export function paymentProvider(): PaymentLinkProvider {
  return holder.__ctpPaymentProvider!;
}

/** Swap in a real gateway (or a test double) that implements PaymentLinkProvider. */
export function setPaymentProvider(provider: PaymentLinkProvider): void {
  holder.__ctpPaymentProvider = provider;
}

export async function createPaymentLink(input: CreateLinkInput): Promise<OrderRow> {
  return paymentProvider().create(buildPaymentRequest(input));
}

export async function listOrders(): Promise<OrderRow[]> {
  return paymentProvider().list();
}
