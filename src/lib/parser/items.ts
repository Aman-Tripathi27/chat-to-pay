// Stage 4: which products the customer wants, how many, and in which size.

import type { Message } from "./chat";
import type { Product } from "./catalog";
import { ADDRESS_KEY, PHONE, PINCODE } from "./contact";
import {
  FILLER,
  NUMBER_WORDS,
  WEAK,
  canon,
  nearWord,
  parseAmount,
  sameWord,
  sentences,
  tokenize,
  type Token,
} from "./text";

export interface Line {
  /** The matched product, or null while the customer hasn't said which of several. */
  product: Product | null;
  /** The products an unclear mention could mean ("kurti" when there are two kurtis). */
  candidates: Product[];
  size: string | null;
  quantity: number;
}

export interface ItemsResult {
  lines: Line[];
  /** Prices the seller quoted in the chat, overriding the catalog. */
  sellerPrices: Map<Product, number>;
  /** Prices the customer stated that differ from the catalog. */
  customerPrices: Map<Product, number>;
  discount: { percent: number } | { amount: number } | null;
  /** The customer asked for something, but nothing matched the catalog. */
  unmatched: boolean;
}

interface Mention {
  products: Product[];
  start: number;
  end: number;
}

interface Hit {
  at: number;
  value: number;
  /** Written after the product: "dupatta x2", "dupatta 4 pcs". */
  postfix?: boolean;
}

interface SizeHit {
  at: number;
  value: string;
}

const UNIT = /^(piece|pieces|pc|pcs|nos|qty|set|sets|pair|pairs|units?)$/;
const WANT = /^(chahiye|chaiye|chahie|chahiyen|chaahiye|bhejo|bhejna|bhej|dena|dedo|lena|order|want|need|send|चाहिए)$/;
// Verbs that make "do" mean "please do it": "bhej do", "kar do".
const DO_VERB = /^(bhej|kar|de|le|rehne|bata|dikha|chhod|chod|hata|rakh|bol|likh|dal|daal|pack|confirm|send)$/;
const NOT_A_QUANTITY_AFTER =
  /^(din|days?|baje|bje|hrs?|hours?|mins?|minutes?|weeks?|mahine|months?|saal|years?|percent|off|tak|am|pm)$/;
const SIZE_WORD = /^(size|sz|saiz|साइज़|साइज)$/;
const NAMED_SIZE: Record<string, string> = { small: "S", medium: "M", large: "L" };
const LETTER_SIZES = new Set(["xs", "xl", "xxl", "xxxl", "2xl", "3xl", "4xl", "5xl"]);
const CANCEL =
  /\bnahi\s*(?:chahiye|chaiye|lena|bhejna)\b|\bmat\s*bhej|\bcancel\b|\bremove\b|\bhata\s*(?:do|dijiye)\b|\brehne\s*do\b|\bdon'?t\s*(?:want|need|send)\b|\bno\s*need\b/i;
const THATS_ALL = /\baur\s*kuch\b|\bkuch\s*aur\b|\banything\s*else\b|\bbas\b/i;
// Words around a bare number that make it a price: "699 wali", "rate 799".
const PRICE_AFTER = /^(wali|wala|wale|ka|ki|ke|only|tha|thi|bola|bataya|kaha|said|rs|rupees?|rupaye|kar|me|mein)$/;
const PRICE_BEFORE = /^(price|rate|for|at|only|was|tha|bola|mrp|cost|liye)$/;
const QUOTE =
  /\b(aapke liye|for you|special|only|kar\s*(?:dungi|dunga|denge)|de\s*(?:dungi|dunga|denge)|final|discounted)\b/i;
const TOTAL_TALK = /\b(total|delivery|shipping|courier)\b/i;
// Parts of an address with a number in them: "Flat 7", "12 MG Road", "Sector 18", "3rd floor".
const ADDRESS_NUMBER =
  /\b(?:flat|house|plot|sector|sec|block|floor|room|gali|lane|wing|door|apt|phase|tower|building|bldg|h\.?\s?no|no\.?)\s*[-#:.]?\s*[a-z]?-?\d|\b\d+\s*(?:st|nd|rd|th)?\s*(?:floor|cross|main|road|rd|street|st|lane|block)\b|\b\d+[a-z]?\s+(?:[a-z]+\s+){1,2}(?:road|rd|street|st|marg|lane|nagar|colony|layout|vihar|enclave|avenue)\b/i;

// ---- Recognising words

function matchesProductWord(word: string, products: Product[], fuzzy: boolean): boolean {
  return products.some((p) => p.words.some((w) => sameWord(word, w) || (fuzzy && nearWord(word, w))));
}

function isProductWord(token: Token | undefined, products: Product[]): boolean {
  if (!token || FILLER.has(token.text) || /^\d/.test(token.text)) return false;
  return matchesProductWord(token.text, products, false) || matchesProductWord(token.text, products, true);
}

function wordScore(product: Product, words: string[]): number {
  let exact = 0;
  for (const w of product.words) if (words.some((x) => sameWord(x, w))) exact++;
  if (exact) return exact;
  return product.words.some((w) => words.some((x) => nearWord(x, w))) ? 0.5 : 0;
}

/** Finds product mentions. A run of product words picks the product sharing the most of them. */
function findMentions(tokens: Token[], products: Product[]): Mention[] {
  const mentions: Mention[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (!isProductWord(tokens[i], products)) {
      i++;
      continue;
    }
    let end = i;
    for (let j = i + 1; j < tokens.length && j - end <= 2; j++) {
      if (isProductWord(tokens[j], products)) end = j;
      else if (!FILLER.has(tokens[j].text)) break;
    }
    const words = tokens.slice(i, end + 1).map((t) => t.text);
    const scored = products.map((p) => ({ p, score: wordScore(p, words) })).filter((s) => s.score > 0);
    const best = Math.max(0, ...scored.map((s) => s.score));
    const winners = words.every((w) => FILLER.has(w) || WEAK.has(canon(w)))
      ? []
      : scored.filter((s) => s.score === best).map((s) => s.p);
    if (winners.length) mentions.push({ products: winners, start: i, end });
    i = end + 1;
  }
  return mentions;
}

function nextMeaningful(tokens: Token[], i: number): number {
  for (let j = i + 1; j < tokens.length && j <= i + 3; j++) {
    if (!FILLER.has(tokens[j].text) || NUMBER_WORDS[tokens[j].text] !== undefined) return j;
  }
  return -1;
}

function sizeAt(tokens: Token[], i: number): string | null {
  const t = tokens[i];
  if (!t) return null;
  const before = tokens[i - 1]?.text ?? "";
  const after = tokens[i + 1]?.text ?? "";
  if (LETTER_SIZES.has(t.text)) return t.text.toUpperCase();
  if (["s", "m", "l"].includes(t.text)) {
    return t.raw === t.raw.toUpperCase() || SIZE_WORD.test(before) || SIZE_WORD.test(after)
      ? t.text.toUpperCase()
      : null;
  }
  if (NAMED_SIZE[t.text]) return NAMED_SIZE[t.text];
  if (t.text === "extra" && after === "large") return "XL";
  if (t.text === "free" && SIZE_WORD.test(after)) return "FREE SIZE";
  if (/^\d{2}$/.test(t.text) && (SIZE_WORD.test(before) || before === "waist")) return t.text;
  return null;
}

function quantityAt(tokens: Token[], i: number, products: Product[]): Hit | null {
  const t = tokens[i].text;
  const before = tokens[i - 1]?.text ?? "";
  const digits = t.match(/^(x)?(\d{1,2})(x|pc|pcs|nos)?$/);
  if (digits) {
    const n = Number(digits[2]);
    if (n < 1 || NOT_A_QUANTITY_AFTER.test(tokens[i + 1]?.text ?? "")) return null;
    if (SIZE_WORD.test(before) || before === "waist") return null;
    const postfix = Boolean(digits[1] || digits[3]) || UNIT.test(tokens[i + 1]?.text ?? "");
    return { at: i, value: n, postfix };
  }
  const word = NUMBER_WORDS[t];
  if (word === undefined || DO_VERB.test(before)) return null;
  const j = nextMeaningful(tokens, i);
  if (j < 0) return null;
  const counts =
    UNIT.test(tokens[j].text) ||
    WANT.test(tokens[j].text) ||
    sizeAt(tokens, j) !== null ||
    isProductWord(tokens[j], products);
  return counts ? { at: i, value: word } : null;
}

// ---- Reading one sentence

interface Scanned {
  tokens: Token[];
  mentions: Mention[];
  quantities: Hit[];
  sizes: SizeHit[];
  amounts: Hit[];
}

function scan(text: string, products: Product[], sellerQuote: boolean): Scanned {
  // Mask phone numbers, pincodes and times so their digits aren't read as quantities,
  // and turn amounts with a currency sign into marker words so their position is kept.
  const marked: number[] = [];
  const masked = text
    .replace(PHONE, " ")
    .replace(new RegExp(PINCODE.source, "g"), " ")
    .replace(/\b\d{1,2}[:.]\d{2}\s*(?:am|pm)?\b/gi, " ")
    .replace(/(?:₹|\brs\.?|\binr)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+)\s*(?:\/-|rs\b|rupees?\b|rupaye\b)/gi, (_, a, b) => {
      marked.push(parseAmount(a ?? b));
      return ` zzamount${marked.length - 1} `;
    })
    .replace(/(\d)\s*%/g, "$1 percent");
  const tokens = tokenize(masked);
  const mentions = findMentions(tokens, products);
  const quantities: Hit[] = [];
  const sizes: SizeHit[] = [];
  const amounts: Hit[] = [];
  tokens.forEach((t, i) => {
    const marker = t.text.match(/^zzamount(\d+)$/);
    if (marker) return void amounts.push({ at: i, value: marked[Number(marker[1])] });
    if (/^\d{3,6}$/.test(t.text)) {
      const priceLike =
        PRICE_AFTER.test(tokens[i + 1]?.text ?? "") || PRICE_BEFORE.test(tokens[i - 1]?.text ?? "") || sellerQuote;
      if (priceLike) amounts.push({ at: i, value: Number(t.text) });
      return;
    }
    const size = sizeAt(tokens, i);
    if (size) return void sizes.push({ at: i, value: size });
    const q = quantityAt(tokens, i, products);
    if (q) quantities.push(q);
  });
  return { tokens, mentions, quantities, sizes, amounts };
}

function distance(at: number, m: Mention): number {
  if (at < m.start) return m.start - at - 0.5; // "2 kurti" slightly beats "kurti 2"
  if (at > m.end) return at - m.end;
  return 0;
}

function nearest(at: number, mentions: Mention[]): Mention | null {
  let best: Mention | null = null;
  for (const m of mentions) if (!best || distance(at, m) < distance(at, best)) best = m;
  return best;
}

/** The message's sentences with address text removed, so house numbers and pincodes aren't read as quantities. */
function orderSentences(text: string): string[] {
  const key = text.match(ADDRESS_KEY);
  const before = key && key.index !== undefined ? text.slice(0, key.index) : text;
  const after = key && key.index !== undefined ? sentences(text.slice(key.index)).slice(1).join("\n") : "";
  return sentences(`${before}\n${after}`)
    .map((s) =>
      s
        .split(",")
        .filter((part) => !PINCODE.test(part.replace(PHONE, " ")) && !ADDRESS_NUMBER.test(part))
        .join(","),
    )
    .filter((s) => s.trim());
}

/** Pairs sizes with quantities: "M me 2 aur L me 1" → (M, 2), (L, 1). */
function pair(sizes: SizeHit[], quantities: Hit[]): { size: string | null; quantity: number | null }[] {
  if (!sizes.length)
    return [{ size: null, quantity: quantities.length ? quantities[quantities.length - 1].value : null }];
  if (sizes.length === 1)
    return [{ size: sizes[0].value, quantity: quantities.length ? quantities[quantities.length - 1].value : null }];
  const unused = [...quantities];
  return sizes.map((s) => {
    let best = -1;
    unused.forEach((q, k) => {
      if (Math.abs(q.at - s.at) <= 4 && (best < 0 || Math.abs(q.at - s.at) < Math.abs(unused[best].at - s.at)))
        best = k;
    });
    return { size: s.value, quantity: best >= 0 ? unused.splice(best, 1)[0].value : null };
  });
}

// ---- Building the order

export function readItems(messages: Message[], products: Product[]): ItemsResult {
  const lines: Line[] = [];
  const sellerPrices = new Map<Product, number>();
  const customerPrices = new Map<Product, number>();
  let discount: ItemsResult["discount"] = null;
  let unmatched = false;
  let focus: Product[] = []; // what the conversation is currently about
  let lastTouched: Line | null = null;

  const linesFor = (p: Product) => lines.filter((l) => l.product === p);

  /** A specific product resolves an earlier unclear mention that could have meant it. */
  function resolve(p: Product) {
    const open = lines.find((l) => !l.product && l.candidates.includes(p));
    if (open && !linesFor(p).length) {
      open.product = p;
      open.candidates = [];
      lastTouched = open;
    }
  }

  function apply(target: Product[], entries: { size: string | null; quantity: number | null }[]) {
    focus = target;
    if (target.length > 1) {
      // Unclear which product: keep one placeholder line until the customer says.
      let line = lines.find(
        (l) => !l.product && l.candidates.length === target.length && target.every((c) => l.candidates.includes(c)),
      );
      if (!line) {
        line = { product: null, candidates: target, size: null, quantity: 1 };
        lines.push(line);
      }
      for (const { size, quantity } of entries) {
        if (size) line.size = size;
        if (quantity !== null) line.quantity = quantity;
      }
      lastTouched = line;
      return;
    }
    const p = target[0];
    resolve(p);
    for (const { size, quantity } of entries) {
      const own = linesFor(p);
      if (size) {
        const line = own.find((l) => l.size === size) ?? own.find((l) => l.size === null);
        if (line) {
          line.size = size;
          if (quantity !== null) line.quantity = quantity;
          lastTouched = line;
        } else {
          lastTouched = { product: p, candidates: [], size, quantity: quantity ?? 1 };
          lines.push(lastTouched);
        }
      } else if (quantity !== null) {
        const line = own.length === 1 ? own[0] : (own.find((l) => l === lastTouched) ?? own[own.length - 1]);
        if (line) {
          line.quantity = quantity;
          lastTouched = line;
        } else {
          lastTouched = { product: p, candidates: [], size: null, quantity };
          lines.push(lastTouched);
        }
      } else if (!own.length) {
        lastTouched = { product: p, candidates: [], size: null, quantity: 1 };
        lines.push(lastTouched);
      }
    }
  }

  for (const message of messages) {
    if (message.role === "seller") {
      const quote = QUOTE.test(message.text) && !TOTAL_TALK.test(message.text);
      const { mentions, amounts } = scan(message.text, products, quote);
      if (mentions.length) focus = mentions[mentions.length - 1].products;
      for (const a of amounts) {
        const near = nearest(a.at, mentions);
        const target = near && distance(a.at, near) <= 3 ? near.products : quote ? focus : [];
        if (target.length === 1) sellerPrices.set(target[0], a.value);
      }
      const percent = message.text.match(/(\d{1,2})\s*%/);
      const flat = message.text.match(
        /(?:₹|rs\.?)\s*([\d,]+)\s*(?:off|discount|kam|less)|(?:discount|off)\s*(?:of\s*)?(?:₹|rs\.?)\s*([\d,]+)/i,
      );
      if (percent && /off|discount|kam|chhoot|chhut|less/i.test(message.text))
        discount = { percent: Number(percent[1]) };
      else if (flat) discount = { amount: parseAmount(flat[1] ?? flat[2]) };
      continue;
    }

    for (const sentence of orderSentences(message.text)) {
      const { mentions, quantities, sizes, amounts, tokens } = scan(sentence, products, false);

      if (CANCEL.test(sentence) && !THATS_ALL.test(sentence)) {
        const targets = mentions.length ? mentions.flatMap((m) => m.products) : focus;
        for (let k = lines.length - 1; k >= 0; k--) {
          const l = lines[k];
          if (
            (l.product && targets.includes(l.product)) ||
            (!l.product && l.candidates.some((c) => targets.includes(c)))
          )
            lines.splice(k, 1);
        }
        continue;
      }

      // Prices the customer states next to a product ("blue kurti 699 wali").
      for (const a of amounts) {
        const near = nearest(a.at, mentions);
        const target = near && distance(a.at, near) <= 3 ? near.products : !mentions.length ? focus : [];
        if (target.length === 1 && target[0].price !== a.value) customerPrices.set(target[0], a.value);
      }

      if (!mentions.length) {
        if (quantities.length || sizes.length) {
          if (focus.length) apply(focus, pair(sizes, quantities));
          else unmatched = true;
        } else if (tokens.some((t) => WANT.test(t.text)) && !focus.length) {
          unmatched = true;
        }
        continue;
      }

      // Attach each quantity and size to the nearest mention. Sizes only go to products that come in sizes.
      const hits = new Map<Mention, { sizes: SizeHit[]; quantities: Hit[] }>(
        mentions.map((m) => [m, { sizes: [], quantities: [] }]),
      );
      for (const q of quantities) {
        const before = q.postfix ? [...mentions].reverse().find((m) => m.end < q.at && q.at - m.end <= 3) : undefined;
        const m = before ?? nearest(q.at, mentions);
        if (m && distance(q.at, m) <= 5) hits.get(m)!.quantities.push(q);
      }
      const sized = mentions.filter((m) => m.products.some((p) => p.sizes.length));
      const loose: SizeHit[] = [];
      for (const s of sizes) {
        const m = nearest(s.at, sized);
        if (m) hits.get(m)!.sizes.push(s);
        else loose.push(s);
      }
      for (const m of mentions) {
        const h = hits.get(m)!;
        apply(m.products, pair(h.sizes, h.quantities));
      }
      // A size with no sized product in the sentence belongs to the sized product being discussed.
      const sizedFocus = [...lines].reverse().find((l) => l.product?.sizes.length);
      if (loose.length && sizedFocus?.product) apply([sizedFocus.product], pair(loose, []));
    }
  }

  return { lines, sellerPrices, customerPrices, discount, unmatched };
}
