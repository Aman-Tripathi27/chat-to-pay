// Stage 5: the customer's language, their questions, and the messages to send back.

import type { Message } from "./chat";
import type { Policies } from "./catalog";
import { formatINR, tokenize } from "./text";

export type Language = "Hinglish" | "English" | "Hindi (Devanagari)";

const HINGLISH = new Set([
  "hai",
  "hain",
  "kya",
  "chahiye",
  "chaiye",
  "chahie",
  "bhej",
  "bhejo",
  "bhejna",
  "mera",
  "meri",
  "mere",
  "aap",
  "aapka",
  "aapke",
  "aapko",
  "nahi",
  "nhi",
  "kitne",
  "kitna",
  "wala",
  "wali",
  "wale",
  "aur",
  "bhi",
  "ji",
  "di",
  "bhaiya",
  "didi",
  "ka",
  "ki",
  "ke",
  "mein",
  "haan",
  "kar",
  "karo",
  "dena",
  "dijiye",
  "hoga",
  "hogi",
  "tak",
  "kab",
  "kaise",
  "accha",
  "acha",
  "theek",
  "thik",
  "se",
  "ko",
  "ye",
  "yeh",
  "wo",
  "woh",
  "kuch",
  "milega",
  "lena",
  "naam",
  "pata",
  "abhi",
]);

export function detectLanguage(customer: Message[]): Language {
  const text = customer.map((m) => m.text).join(" ");
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const devanagari = text.match(/[ऀ-ॿ]/g)?.length ?? 0;
  if (letters && devanagari / letters > 0.2) return "Hindi (Devanagari)";
  const words = tokenize(text).filter((t) => /^\p{L}+$/u.test(t.text));
  const hinglish = words.filter((t) => HINGLISH.has(t.text)).length;
  return words.length && hinglish / words.length >= 0.12 ? "Hinglish" : "English";
}

export interface Questions {
  cod: boolean;
  deliveryTime: boolean;
  returns: boolean;
  availability: boolean;
  discount: boolean;
}

export function findQuestions(customer: Message[]): Questions {
  const text = customer.map((m) => m.text).join("\n");
  return {
    cod: /\bcod\b|cash on delivery/i.test(text),
    deliveryTime:
      /kab tak|kitne din|kab (?:aayega|milega|pahunche|deliver)|when (?:will|can|would)\b.*\b(?:arrive|reach|deliver|get|come)|how (?:long|many days)|delivery time/i.test(
        text,
      ),
    returns: /\b(?:return|exchange|refund)\b/i.test(text),
    availability: /available|in stock|\bstock\b|hai kya|milega|\bprice\b|kitne ka|kitne ki|\brate\b/i.test(text),
    discount: /\bdiscount\b|\bkam\s*(?:kar|karo|kijiye|ho)\b|\bless\b|\boffer\b|\bbest price\b|\bdeal\b/i.test(text),
  };
}

export interface ReplyFacts {
  language: Language;
  name: string | null;
  questions: Questions;
  policies: Policies;
  delivery: { charge: number; freeFrom: number | null } | null;
  deliveryCharge: number;
}

/** The confirmation message, with {{ITEMS}}, {{TOTAL}} and {{LINK}} filled in after the seller's edits. */
export function replyTemplate(f: ReplyFacts): string {
  const first = f.name?.split(" ")[0] ?? null;
  const answers: string[] = [];
  const freeByRule = f.delivery?.freeFrom != null && f.deliveryCharge === 0;

  if (f.language === "Hindi (Devanagari)") {
    if (f.questions.cod && f.policies.cod === false) answers.push("COD उपलब्ध नहीं है, केवल प्रीपेड (UPI या कार्ड)।");
    if (f.questions.cod && f.policies.cod === true) answers.push("COD भी उपलब्ध है।");
    if (f.policies.dispatch) answers.push(f.policies.dispatch);
    if (f.questions.returns && f.policies.exchange) answers.push(f.policies.exchange);
    const delivery = freeByRule
      ? ", डिलीवरी मुफ़्त"
      : f.deliveryCharge > 0
        ? ` (${formatINR(f.deliveryCharge)} डिलीवरी सहित)`
        : "";
    return [
      `धन्यवाद${first ? ` ${first} जी` : ""}! 🙏 आपका ऑर्डर: {{ITEMS}}। कुल {{TOTAL}}${delivery}।`,
      ...answers,
      "यहाँ भुगतान करें: {{LINK}}",
    ].join(" ");
  }

  if (f.language === "Hinglish") {
    if (f.questions.cod && f.policies.cod === false)
      answers.push("COD available nahi hai, sirf prepaid (UPI ya card).");
    if (f.questions.cod && f.policies.cod === true) answers.push("COD bhi available hai.");
    if (f.policies.dispatch) answers.push(f.policies.dispatch);
    if (f.questions.returns && f.policies.exchange) answers.push(f.policies.exchange);
    const delivery = freeByRule
      ? ", delivery free hai"
      : f.deliveryCharge > 0
        ? ` (${formatINR(f.deliveryCharge)} delivery shamil hai)`
        : "";
    return [
      `Thank you${first ? ` ${first} ji` : ""}! 🙏 Aapka order: {{ITEMS}}. Total {{TOTAL}}${delivery}.`,
      ...answers,
      "Is link se pay kar dijiye: {{LINK}}",
    ].join(" ");
  }

  if (f.questions.cod && f.policies.cod === false)
    answers.push("We don't offer cash on delivery; it's prepaid only (UPI or card).");
  if (f.questions.cod && f.policies.cod === true) answers.push("Cash on delivery is available too.");
  if (f.policies.dispatch) answers.push(f.policies.dispatch);
  if (f.questions.returns && f.policies.exchange) answers.push(f.policies.exchange);
  const delivery = freeByRule
    ? ", with free delivery"
    : f.deliveryCharge > 0
      ? ` (including ${formatINR(f.deliveryCharge)} delivery)`
      : "";
  return [
    `Thank you${first ? `, ${first}` : ""}! Your order: {{ITEMS}}. Total {{TOTAL}}${delivery}.`,
    ...answers,
    "You can pay here: {{LINK}}",
  ].join(" ");
}

export type Ask =
  | { kind: "size"; item: string; sizes: string[] }
  | { kind: "which"; noun: string; options: string[] }
  | { kind: "address" }
  | { kind: "pincode" }
  | { kind: "item" };

/** One short message asking for everything still missing, in the customer's language. */
export function clarifyingQuestion(language: Language, asks: Ask[], intro: string | null): string | null {
  if (!asks.length) return null;
  const or = (options: string[], word: string) =>
    options.length > 1
      ? `${options.slice(0, -1).join(", ")} ${word} ${options[options.length - 1]}`
      : (options[0] ?? "");
  const lines = asks.map((a) => {
    if (language === "Hindi (Devanagari)") {
      if (a.kind === "size") return `${a.item} में कौन सा साइज़ चाहिए: ${or(a.sizes, "या")}?`;
      if (a.kind === "which") return `आपको कौन सा ${a.noun} चाहिए: ${or(a.options, "या")}?`;
      if (a.kind === "address") return "कृपया पिनकोड के साथ पूरा पता भेजें।";
      if (a.kind === "pincode") return "कृपया अपने इलाके का पिनकोड भी भेजें।";
      return "आप कौन सा आइटम ऑर्डर करना चाहेंगे?";
    }
    if (language === "Hinglish") {
      if (a.kind === "size") return `${a.item} ke liye kaunsa size chahiye: ${or(a.sizes, "ya")}?`;
      if (a.kind === "which") return `Aapko kaunsa ${a.noun} chahiye: ${or(a.options, "ya")}?`;
      if (a.kind === "address") return "Delivery ka pura address pincode ke saath bhej dijiye.";
      if (a.kind === "pincode") return "Apne area ka pincode bhi bhej dijiye.";
      return "Aap kaunsa item order karna chahenge?";
    }
    if (a.kind === "size") return `Which size would you like for the ${a.item}: ${or(a.sizes, "or")}?`;
    if (a.kind === "which") return `Which ${a.noun} would you like: ${or(a.options, "or")}?`;
    if (a.kind === "address") return "Could you share the full delivery address with the pincode?";
    if (a.kind === "pincode") return "Could you share your pincode as well?";
    return "Which item would you like to order?";
  });
  return [intro, ...lines].filter(Boolean).join(" ");
}

/** "Ji, Pink anarkali kurti available hai, ₹1,199." when the customer asked about it. */
export function availabilityIntro(language: Language, item: string, price: number | null): string {
  const cost = price !== null ? formatINR(price) : null;
  if (language === "Hindi (Devanagari)") return `जी, ${item} उपलब्ध है${cost ? `, ${cost}` : ""}। 😊`;
  if (language === "Hinglish") return `Ji, ${item} available hai${cost ? `, ${cost}` : ""}. 😊`;
  return `Yes, the ${item} is available${cost ? ` for ${cost}` : ""}.`;
}
