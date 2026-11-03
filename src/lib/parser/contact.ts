// Stage 3: phone, pincode, email, delivery address and name, from the customer's messages.

import { speakerName, type Message } from "./chat";
import { sentences, titleCase } from "./text";

export interface Contact {
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  pincode: string | null;
  city: string | null;
}

// Indian mobile numbers: "98765 43210", "+91-98111-22233", "09876543210".
export const PHONE = /(?<![\d+])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
export const PINCODE = /(?<!\d)[1-9]\d{2}\s?\d{3}(?!\d)/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;

// "Address - …", "address: …", "deliver to …", "ship to …", "send it to …", "pata hai …", "पता: …"
export const ADDRESS_KEY =
  /(?:\b(?:address|addr)\b|\bdeliver(?:y)?\s+(?:to|at|address)\b|\bship(?:ping)?\s+(?:to|address)\b|\b(?:send|courier)\s+(?:it\s+|this\s+|them\s+)?to\b|\bpata\s*(?=[:\-–]|hai\b)|पता)\s*(?:(?:is|hai|h)(?=[\s:\-–=]))?\s*[:\-–=]?\s*/i;
const ADDRESS_WORDS =
  /\b(flat|house|h\.?\s?no|road|rd|street|st|nagar|colony|sector|apartments?|apts?|floor|near|block|lane|gali|society|tower|plot|villa|building|bldg|chowk|marg|park|layout|phase|west|east|north|south|hills?|vihar|enclave|residency|view|town|city|village|district)\b/i;
const TRAILING_FILLER =
  /\s*(?:pe|par|pr|me|mein)?\s*(?:bhej(?:o|na|dena|do|dijiye)?|deliver\s*kar(?:na|do|dena)?|send\s*it)\s*[.!]*$/i;

const CITIES = [
  "mumbai",
  "new delhi",
  "delhi",
  "bengaluru",
  "bangalore",
  "pune",
  "hyderabad",
  "chennai",
  "kolkata",
  "ahmedabad",
  "jaipur",
  "lucknow",
  "surat",
  "indore",
  "bhopal",
  "chandigarh",
  "noida",
  "gurugram",
  "gurgaon",
  "kochi",
  "nagpur",
  "patna",
  "vadodara",
  "coimbatore",
  "thane",
  "nashik",
  "ludhiana",
  "agra",
  "kanpur",
  "mysuru",
  "mysore",
  "guwahati",
  "dehradun",
  "ranchi",
  "raipur",
  "bhubaneswar",
  "goa",
  "udaipur",
  "jodhpur",
  "varanasi",
  "amritsar",
  "visakhapatnam",
];

function clean(text: string): string {
  return text
    .replace(PHONE, " ")
    .replace(TRAILING_FILLER, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.:;–-]+|[\s,.;:–-]+$/g, "")
    .trim();
}

/**
 * Splits "Neha Verma, Flat 302, …" into a name and the rest when the first part reads like a name.
 * A single word only counts when a house number follows ("Ritu, house no 55, …"), so "Kothrud, Pune" stays put.
 */
function splitName(address: string): { name: string | null; address: string } {
  const parts = address.split(",").map((p) => p.trim());
  const [first, second = ""] = parts;
  if (parts.length < 2 || ADDRESS_WORDS.test(first) || CITIES.includes(first.toLowerCase()))
    return { name: null, address };
  const fullName = /^[A-Za-z]+(?: [A-Za-z]+){1,2}$/.test(first);
  const firstName = /^[A-Za-z]{3,}$/.test(first) && /^(?:flat|house|h\.?\s?no|plot|door|#|[a-z]?-?\d)/i.test(second);
  if (!fullName && !firstName) return { name: null, address };
  return { name: titleCase(first), address: parts.slice(1).join(", ") };
}

const hasPincode = (text: string) => PINCODE.test(text.replace(PHONE, " "));
const looksLikeAddress = (text: string) => hasPincode(text) || ADDRESS_WORDS.test(text) || text.includes(",");

function findAddress(customer: Message[]): string | null {
  for (let i = 0; i < customer.length; i++) {
    const text = customer[i].text;
    const key = text.match(ADDRESS_KEY);
    if (!key || key.index === undefined) continue;
    // The address runs from the keyword to the sentence holding the pincode, and may
    // continue on the next lines or messages ("Address:" then the address below it).
    const pieces = [
      ...sentences(text.slice(key.index + key[0].length)),
      ...customer.slice(i + 1, i + 4).map((m) => m.text),
    ];
    let address = "";
    for (const piece of pieces) {
      const part = clean(piece);
      if (!part || (address && !looksLikeAddress(part))) break;
      address = address ? `${address}, ${part}` : part;
      if (hasPincode(part)) break;
    }
    if (address && looksLikeAddress(address)) return address;
  }
  // No keyword: use the sentence that holds the pincode.
  for (const m of customer) {
    for (const s of sentences(m.text)) {
      if (PINCODE.test(s.replace(PHONE, " "))) return clean(s);
    }
  }
  return null;
}

function findName(customer: Message[]): string | null {
  const text = customer.map((m) => m.text).join("\n");
  const patterns = [
    /\b(?:mera|meri)\s+(?:naam|name)\s+(?:hai\s+)?([a-z]+(?:\s+[a-z]+){0,2}?)(?=\s+(?:hai|h|he)\b|\s*[.,!\n]|$)/i,
    /\bmy name is\s+([a-z]+(?:\s+[a-z]+){0,2}?)(?=\s+(?:and|here|from)\b|\s*[.,!\n]|$)/i,
    /\b(?:this is|i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return titleCase(m[1]);
  }
  return null;
}

export function findContact(messages: Message[]): Contact {
  const customer = messages.filter((m) => m.role === "customer");
  const all = customer.map((m) => m.text).join("\n");
  const labels = customer.map((m) => m.speaker ?? "");

  const phone = all.match(PHONE)?.[0] ?? labels.join(" ").match(PHONE)?.[0] ?? null;
  let address = findAddress(customer);
  let name = findName(customer);
  if (address) {
    const split = splitName(address);
    address = split.address || null;
    name ??= split.name;
  }
  name ??= customer.map((m) => speakerName(m.speaker)).find(Boolean) ?? null;

  const pincode =
    (address ?? "").replace(PHONE, " ").match(PINCODE)?.[0]?.replace(/\s/g, "") ??
    all.replace(PHONE, " ").match(PINCODE)?.[0]?.replace(/\s/g, "") ??
    null;
  const lower = all.toLowerCase();
  const cityKey = CITIES.find((c) => new RegExp(`\\b${c}\\b`).test(lower)) ?? null;

  return {
    name,
    phone: phone?.trim() ?? null,
    email: all.match(EMAIL)?.[0] ?? null,
    address,
    pincode,
    city: cityKey ? titleCase(cityKey) : null,
  };
}
