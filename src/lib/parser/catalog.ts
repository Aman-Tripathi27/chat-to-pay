// Stage 2: read the seller's catalog and policies, written in plain text.

import { FILLER, canon, parseAmount, sentences, tokenize } from "./text";

export interface Product {
  name: string;
  price: number | null;
  /** Sizes offered, e.g. ["S", "M", "L"]. Empty when the product has no sizes. */
  sizes: string[];
  /** Canonical words of the name, used for matching. */
  words: string[];
  /** The noun the name ends with ("kurti", "dupatta"). */
  head: string;
}

export interface DeliveryRule {
  charge: number;
  /** Orders at or above this subtotal ship free. */
  freeFrom: number | null;
}

export interface Policies {
  cod: boolean | null;
  dispatch: string | null;
  exchange: string | null;
}

export interface ShopRules {
  products: Product[];
  delivery: DeliveryRule | null;
  policies: Policies;
}

const CURRENCY = String.raw`(?:₹|rs\.?|inr)`;
// "Blue cotton kurti - ₹799 (sizes S, M, L)" · "Silk saree: Rs 2,499" · "Gift wrap ₹50"
const PRODUCT_LINE = new RegExp(
  String.raw`^(.+?)(?:\s*[-–—:|=@]\s*${CURRENCY}?\s*|\s+${CURRENCY}\s*)([\d,]+(?:\.\d{1,2})?)\s*(?:\/-)?(.*)$`,
  "i",
);
const LETTER_SIZE = /\b(xxxl|xxl|xl|xs|[2-5]xl|s|m|l)\b/gi;

function readSizes(rest: string): string[] {
  if (!/size|\(|\[/i.test(rest)) return [];
  if (/free\s*size/i.test(rest)) return ["FREE SIZE"];
  const letters = Array.from(rest.matchAll(LETTER_SIZE), (m) => m[1].toUpperCase());
  if (letters.length) return [...new Set(letters)];
  return /size/i.test(rest) ? [...new Set(rest.match(/\b\d{2}\b/g) ?? [])] : [];
}

function readDelivery(line: string): DeliveryRule {
  const free =
    line.match(new RegExp(String.raw`free[^\d₹]*?(?:above|over|from|upar)\s*${CURRENCY}?\s*([\d,]+)`, "i")) ??
    line.match(new RegExp(String.raw`(?:above|over)\s*${CURRENCY}?\s*([\d,]+)[^.]*free`, "i"));
  const freeFrom = free ? parseAmount(free[1]) : null;
  const amounts = Array.from(line.matchAll(/(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/gi), (m) => parseAmount(m[1]));
  const charge = amounts.find((a) => a !== freeFrom && a > 0) ?? 0;
  return { charge, freeFrom };
}

export function parseCatalog(text: string): { products: Product[]; delivery: DeliveryRule | null } {
  const products: Product[] = [];
  let delivery: DeliveryRule | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-•*·]\s*/, "");
    if (!line) continue;
    if (/\b(delivery|shipping|courier)\b/i.test(line)) {
      delivery = readDelivery(line);
      continue;
    }
    const m = line.match(PRODUCT_LINE);
    if (!m) continue;
    const name = m[1].trim();
    const words = tokenize(name)
      .map((t) => canon(t.text))
      .filter((w) => !FILLER.has(w) && !/^\d+$/.test(w));
    if (!words.length) continue;
    products.push({
      name,
      price: parseAmount(m[2]),
      sizes: readSizes(m[3]),
      words,
      head: words[words.length - 1],
    });
  }
  return { products, delivery };
}

export function parsePolicies(text: string): Policies {
  const lines = sentences(text);
  const find = (re: RegExp) => lines.find((s) => re.test(s) && !/\bcod\b|cash on delivery/i.test(s)) ?? null;
  let cod: boolean | null = null;
  if (
    /\bno\s*cod\b|\bcod\s*(?:is\s*)?(?:not|nahi|na)\b|\bwithout\s*cod\b|\bprepaid\s*only\b|\bonly\s*prepaid\b/i.test(
      text,
    )
  ) {
    cod = false;
  } else if (
    /\bcod\s*(?:is\s*)?(?:available|hai|accepted|yes)\b|\bcash on delivery\s*(?:is\s*)?(?:available|accepted)\b/i.test(
      text,
    )
  ) {
    cod = true;
  }
  return {
    cod,
    dispatch: find(/dispatch|ship|deliver|days/i),
    exchange: find(/exchange|return|refund/i),
  };
}

export function readShop(catalog: string, policies: string): ShopRules {
  return { ...parseCatalog(catalog), policies: parsePolicies(policies) };
}
