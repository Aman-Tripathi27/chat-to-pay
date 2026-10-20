import { z } from "zod";

// What Claude extracts from a customer chat. Every field is required (nullable
// where unknown) so structured outputs always returns the full shape.
export const ItemSchema = z.object({
  name: z.string().describe("Product name, using the catalog's wording when it matches"),
  variant: z
    .string()
    .nullable()
    .describe("Size, colour or flavour. Null when not applicable or not yet known."),
  quantity: z.number().int().describe("Number of units, at least 1"),
  unit_price_inr: z
    .number()
    .nullable()
    .describe("Price per unit in rupees. Null when neither the catalog nor the seller gave one."),
  price_source: z
    .enum(["catalog", "seller_message", "customer_claim", "unknown"])
    .describe("Where unit_price_inr came from"),
});

export const ExtractedOrderSchema = z.object({
  customer_name: z.string().nullable(),
  customer_phone: z.string().nullable().describe("Digits as written, with country code if given"),
  customer_email: z.string().nullable(),
  customer_language: z
    .string()
    .describe("How the customer writes, e.g. 'Hinglish', 'Hindi (Devanagari)', 'English', 'Tamil'"),
  items: z.array(ItemSchema),
  shipping_address: z.string().nullable().describe("Full delivery address on one line"),
  pincode: z.string().nullable(),
  delivery_charge_inr: z.number().nullable().describe("Delivery fee per the shop's rules; 0 if free"),
  discount_inr: z.number().nullable().describe("Only a discount the seller offered in the chat"),
  missing_info: z
    .array(z.string())
    .describe("Short notes for the seller on anything needed before charging; empty if complete"),
  clarifying_question: z
    .string()
    .nullable()
    .describe("If something is missing: a short message to the customer, in their language, asking for it"),
  reply_template: z
    .string()
    .describe(
      "Message to the customer in their language confirming the order. Must contain {{ITEMS}}, {{TOTAL}} and {{LINK}} placeholders.",
    ),
  seller_summary: z.string().describe("One line for the seller summarising the order"),
});

export type ExtractedOrder = z.infer<typeof ExtractedOrderSchema>;
export type OrderItem = z.infer<typeof ItemSchema>;

// What the browser sends when creating a payment link (after the seller edits).
export const CreateLinkSchema = z.object({
  customer_name: z.string().max(100).nullable(),
  customer_phone: z.string().max(20).nullable(),
  customer_email: z.string().max(200).nullable(),
  customer_language: z.string().max(40),
  items: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        variant: z.string().max(60).nullable(),
        quantity: z.number().int().min(1).max(999),
        unit_price_inr: z.number().min(0).max(10_000_000),
      }),
    )
    .min(1)
    .max(30),
  shipping_address: z.string().max(500).nullable(),
  pincode: z.string().max(10).nullable(),
  delivery_charge_inr: z.number().min(0).max(100_000),
  discount_inr: z.number().min(0).max(10_000_000),
  shop_name: z.string().max(80).optional(),
});

export type CreateLinkInput = z.infer<typeof CreateLinkSchema>;

export interface OrderRow {
  id: string;
  shortUrl: string;
  status: "created" | "partially_paid" | "paid" | "expired" | "cancelled";
  amount: number; // rupees
  amountPaid: number; // rupees
  createdAt: number; // unix seconds
  customerName: string | null;
  customerPhone: string | null;
  items: string;
  language: string | null;
}

export function lineTotal(item: { quantity: number; unit_price_inr: number | null }): number {
  return item.quantity * (item.unit_price_inr ?? 0);
}

export function orderTotal(order: {
  items: { quantity: number; unit_price_inr: number | null }[];
  delivery_charge_inr: number | null;
  discount_inr: number | null;
}): number {
  const subtotal = order.items.reduce((sum, i) => sum + lineTotal(i), 0);
  const total = subtotal + (order.delivery_charge_inr ?? 0) - (order.discount_inr ?? 0);
  return Math.max(0, Math.round(total * 100) / 100);
}

export function itemsSummary(items: { name: string; variant: string | null; quantity: number }[]): string {
  return items.map((i) => `${i.quantity}× ${i.name}${i.variant ? ` (${i.variant})` : ""}`).join(", ");
}

export function formatINR(rupees: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
  }).format(rupees);
}

/**
 * Normalises an Indian mobile number to +91XXXXXXXXXX. Other numbers with a
 * country code are kept if Razorpay would accept them (8–14 chars).
 */
export function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  const withPlus = `+${digits}`;
  return raw.trim().startsWith("+") && withPlus.length >= 8 && withPlus.length <= 14 ? withPlus : null;
}

/** wa.me link that opens WhatsApp with the message pre-filled. */
export function whatsappLink(phone: string | null, message: string): string {
  const normalized = normalizePhone(phone);
  const target = normalized ? normalized.replace("+", "") : "";
  return `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
}

export function fillReply(template: string, values: { items: string; total: string; link: string }): string {
  return template
    .replaceAll("{{ITEMS}}", values.items)
    .replaceAll("{{TOTAL}}", values.total)
    .replaceAll("{{LINK}}", values.link);
}
