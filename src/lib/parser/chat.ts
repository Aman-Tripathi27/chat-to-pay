// Stage 1: split a pasted conversation into messages and work out who wrote each one.

export interface Message {
  role: "customer" | "seller";
  /** The label the chat showed for the sender, if any ("Neha Verma", "Customer"). */
  speaker: string | null;
  text: string;
}

// "12/10/26, 10:02 am - Neha: hi"  or  "[12/10/26, 10:02:11] Neha: hi"  (WhatsApp exports)
const EXPORT_LINE =
  /^\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?)?\]?\s*[-–]?\s*([^:]{1,40}?):\s?(.*)$/i;
// "[10:02] Customer: hi"
const TIME_LINE = /^\[\d{1,2}[:.]\d{2}(?:\s*[ap]\.?\s?m\.?)?\]\s*([^:]{1,40}?):\s?(.*)$/i;
// "Customer: hi"
const LABEL_LINE = /^([\p{L}][\p{L}\p{M} .'’-]{0,38}?)\s*:\s?(.*)$/u;

const SELLER_LABEL = /^(seller|me|you|shop|store|owner|admin|business)$/i;
const GENERIC_CUSTOMER = /^(customer|buyer|client|user|them|guest)$/i;
// "Address: …" and the like are field names, not senders.
const NOT_A_SENDER =
  /^(address|addr|pata|name|naam|phone|mobile|mob|number|no|contact|pincode|pin|pin code|size|qty|quantity|total|price|note|order|email|city|state|landmark|delivery|ship to|deliver to)$/i;
const SYSTEM_LINE = /end-to-end encrypted|<media omitted>|this message was deleted|missed voice call/i;

interface Line {
  label: string | null;
  body: string;
}

function readLine(line: string): Line {
  for (const pattern of [EXPORT_LINE, TIME_LINE, LABEL_LINE]) {
    const m = line.match(pattern);
    if (!m) continue;
    const label = m[1].trim();
    if (pattern === LABEL_LINE && NOT_A_SENDER.test(label)) break;
    return { label, body: m[2].trim() };
  }
  return { label: null, body: line };
}

function isSeller(label: string, shopName: string): boolean {
  return SELLER_LABEL.test(label) || (shopName.trim() !== "" && label.toLowerCase() === shopName.trim().toLowerCase());
}

/** A sender label worth using as the customer's name: not generic, not a phone number. */
export function speakerName(label: string | null): string | null {
  if (!label || GENERIC_CUSTOMER.test(label) || /\d/.test(label)) return null;
  return label;
}

export function parseChat(text: string, shopName = ""): Message[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !SYSTEM_LINE.test(l))
    .map(readLine);
  const labelled = lines.some((l) => l.label !== null);
  const messages: Message[] = [];

  for (const { label, body } of lines) {
    if (label !== null) {
      messages.push({ role: isSeller(label, shopName) ? "seller" : "customer", speaker: label, text: body });
    } else if (labelled && messages.length > 0) {
      // In a labelled chat, an unlabelled line continues the previous message.
      const last = messages[messages.length - 1];
      last.text = last.text ? `${last.text}\n${body}` : body;
    } else {
      messages.push({ role: "customer", speaker: null, text: body });
    }
  }
  return messages.filter((m) => m.text.trim() !== "" || m.role === "customer");
}
