// Chat-to-Pay's order reader: a customer chat plus the shop's catalog in, a draft order out.
// Runs anywhere JavaScript runs (browser or server) and calls no external service.
//
//   1. chat.ts     split the conversation into messages and senders
//   2. catalog.ts  read products, sizes, prices, delivery rule and policies
//   3. contact.ts  find phone, pincode, address and name
//   4. items.ts    match products, quantities and sizes across the conversation
//   5. reply.ts    language, questions, and the messages to send back

import { readShop } from "./catalog";
import { parseChat } from "./chat";
import { findContact } from "./contact";
import { readItems } from "./items";
import {
  availabilityIntro,
  clarifyingQuestion,
  detectLanguage,
  findQuestions,
  replyTemplate,
  type Ask,
  type Language,
} from "./reply";
import { formatINR, titleCase } from "./text";

export type PriceSource = "catalog" | "seller_message" | "customer_claim" | "unknown";

export interface ParsedItem {
  name: string;
  variant: string | null;
  quantity: number;
  unit_price_inr: number | null;
  price_source: PriceSource;
}

export interface ParsedOrder {
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_language: Language;
  items: ParsedItem[];
  shipping_address: string | null;
  pincode: string | null;
  delivery_charge_inr: number;
  discount_inr: number;
  /** Notes for the seller on anything to sort out before charging. */
  missing_info: string[];
  /** A message to the customer, in their language, asking for what's missing. */
  clarifying_question: string | null;
  /** The confirmation message, with {{ITEMS}}, {{TOTAL}} and {{LINK}} placeholders. */
  reply_template: string;
  seller_summary: string;
}

export interface ShopInput {
  name?: string;
  catalog: string;
  policies: string;
}

export type { Language };

export function readOrder(chat: string, shop: ShopInput): ParsedOrder {
  const rules = readShop(shop.catalog, shop.policies);
  const messages = parseChat(chat, shop.name ?? "");
  const customer = messages.filter((m) => m.role === "customer");
  const contact = findContact(messages);
  const found = readItems(messages, rules.products);
  const language = detectLanguage(customer);
  const questions = findQuestions(customer);

  // Items, priced from the seller's quote, then the catalog, then the customer's word.
  const items: ParsedItem[] = found.lines.map((line) => {
    const base = { variant: line.size, quantity: line.quantity };
    if (!line.product)
      return { ...base, name: titleCase(line.candidates[0].head), unit_price_inr: null, price_source: "unknown" };
    const p = line.product;
    const quoted = found.sellerPrices.get(p);
    if (quoted !== undefined) return { ...base, name: p.name, unit_price_inr: quoted, price_source: "seller_message" };
    if (p.price !== null) return { ...base, name: p.name, unit_price_inr: p.price, price_source: "catalog" };
    const claimed = found.customerPrices.get(p);
    return claimed !== undefined
      ? { ...base, name: p.name, unit_price_inr: claimed, price_source: "customer_claim" }
      : { ...base, name: p.name, unit_price_inr: null, price_source: "unknown" };
  });

  // Delivery and discount from the shop's own rules.
  const subtotal = items.reduce((sum, i) => sum + i.quantity * (i.unit_price_inr ?? 0), 0);
  const rule = rules.delivery;
  const deliveryCharge =
    items.length && rule ? (rule.freeFrom !== null && subtotal >= rule.freeFrom ? 0 : rule.charge) : 0;
  const discount = !found.discount
    ? 0
    : "percent" in found.discount
      ? Math.round((subtotal * found.discount.percent) / 100)
      : Math.min(found.discount.amount, subtotal);

  // What the seller needs before charging, and what to ask the customer.
  const missing: string[] = [];
  const asks: Ask[] = [];
  if (!items.length) {
    missing.push(
      found.unmatched
        ? "The customer asked for something that isn't in your catalog."
        : "No item from your catalog was found in the chat.",
    );
    asks.push({ kind: "item" });
  }
  const askedSize = new Set<string>();
  for (const line of found.lines) {
    if (!line.product) {
      const options = line.candidates.map((c) => c.name);
      missing.push(`Which ${line.candidates[0].head} did they mean: ${options.join(" or ")}?`);
      asks.push({ kind: "which", noun: line.candidates[0].head, options });
      continue;
    }
    const p = line.product;
    const badSize = line.size !== null && p.sizes.length > 0 && !p.sizes.includes(line.size);
    if (p.sizes.length && (!line.size || badSize) && !askedSize.has(p.name)) {
      askedSize.add(p.name);
      missing.push(
        badSize
          ? `Size ${line.size} isn't listed for ${p.name} (${p.sizes.join(", ")})`
          : `Size not chosen for ${p.name} (${p.sizes.join(", ")})`,
      );
      asks.push({ kind: "size", item: p.name, sizes: p.sizes });
    }
    if (p.price === null && !found.sellerPrices.has(p)) missing.push(`No price for ${p.name} in your catalog`);
  }
  for (const [p, claimed] of found.customerPrices) {
    if (p.price !== null && !found.sellerPrices.has(p) && found.lines.some((l) => l.product === p)) {
      missing.push(`Customer mentions ${formatINR(claimed)} for ${p.name}; your catalog says ${formatINR(p.price)}`);
    }
  }
  if (!contact.address && !contact.pincode) {
    missing.push("Delivery address and pincode missing");
    asks.push({ kind: "address" });
  } else if (!contact.pincode) {
    missing.push("Pincode missing from the address");
    asks.push({ kind: "pincode" });
  }
  if (questions.cod && rules.policies.cod === null)
    missing.push("Customer asked about COD. Add your COD policy in Shop setup.");
  if (questions.deliveryTime && !rules.policies.dispatch)
    missing.push("Customer asked when it will arrive. Add your dispatch time in Shop setup.");
  if (questions.returns && !rules.policies.exchange)
    missing.push("Customer asked about returns. Add your return policy in Shop setup.");
  if (questions.discount && !found.discount) missing.push("Customer asked for a discount.");

  const single = items.length === 1 && found.lines[0]?.product ? found.lines[0].product : null;
  const intro =
    questions.availability && single && asks.length
      ? availabilityIntro(language, single.name, items[0].unit_price_inr)
      : null;

  // A one-line summary for the seller.
  const itemsText = items.map((i) => `${i.quantity}× ${i.name}${i.variant ? ` (${i.variant})` : ""}`).join(", ");
  const who = contact.name ? contact.name.split(" ")[0] : "a customer";
  const where = contact.city ? ` in ${contact.city}` : "";
  let summary = items.length ? `${itemsText} for ${who}${where}.` : `No items found yet for ${who}${where}.`;
  if (items.length && rule) {
    if (deliveryCharge === 0 && rule.freeFrom !== null)
      summary += ` Free delivery, since the order is above ${formatINR(rule.freeFrom)}.`;
    else if (deliveryCharge > 0) summary += ` Delivery ${formatINR(deliveryCharge)}.`;
  }
  if (discount) summary += ` Discount ${formatINR(discount)}.`;
  const waiting = [
    asks.some((a) => a.kind === "size") && "size",
    asks.some((a) => a.kind === "which") && "which item",
    asks.some((a) => a.kind === "address" || a.kind === "pincode") && "address",
  ].filter(Boolean);
  if (waiting.length && items.length) summary += ` Waiting on ${waiting.join(" and ")}.`;

  return {
    customer_name: contact.name,
    customer_phone: contact.phone,
    customer_email: contact.email,
    customer_language: language,
    items,
    shipping_address: contact.address,
    pincode: contact.pincode,
    delivery_charge_inr: deliveryCharge,
    discount_inr: discount,
    missing_info: missing,
    clarifying_question: clarifyingQuestion(language, asks, intro),
    reply_template: replyTemplate({
      language,
      name: contact.name,
      questions,
      policies: rules.policies,
      delivery: rule,
      deliveryCharge,
    }),
    seller_summary: summary,
  };
}
