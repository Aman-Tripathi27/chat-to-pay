// Text helpers shared by every stage: tokens, Hinglish spellings, number words.

export interface Token {
  /** Lowercased text. */
  text: string;
  /** Text as written, used where case matters (an "M" size vs "m"). */
  raw: string;
}

/** Splits into words and numbers. Keeps Devanagari vowel signs with their letters. */
export function tokenize(text: string): Token[] {
  return Array.from(text.normalize("NFC").matchAll(/[\p{L}\p{M}\p{N}]+/gu), (m) => ({
    text: m[0].toLowerCase(),
    raw: m[0],
  }));
}

// Spellings customers use for the same word, and Hindi colour words.
const SYNONYMS: Record<string, string> = {
  sari: "saree",
  saari: "saree",
  saaree: "saree",
  kurtha: "kurta",
  chunni: "dupatta",
  chunri: "dupatta",
  odhni: "dupatta",
  tee: "tshirt",
  neela: "blue",
  neeli: "blue",
  nila: "blue",
  nili: "blue",
  laal: "red",
  lal: "red",
  hara: "green",
  hari: "green",
  peela: "yellow",
  peeli: "yellow",
  pila: "yellow",
  pili: "yellow",
  kala: "black",
  kaala: "black",
  kaali: "black",
  safed: "white",
  gulabi: "pink",
  bhura: "brown",
  sunehra: "golden",
  sunheri: "golden",
  // Devanagari spellings
  कुर्ती: "kurti",
  कुर्तियां: "kurti",
  कुर्तियाँ: "kurti",
  कुर्ता: "kurta",
  दुपट्टा: "dupatta",
  दुपट्टे: "dupatta",
  चुन्नी: "dupatta",
  साड़ी: "saree",
  साड़ियां: "saree",
  अनारकली: "anarkali",
  सूती: "cotton",
  कॉटन: "cotton",
  प्रिंटेड: "printed",
  नीली: "blue",
  नीला: "blue",
  गुलाबी: "pink",
  लाल: "red",
  हरी: "green",
  हरा: "green",
  पीली: "yellow",
  पीला: "yellow",
  काली: "black",
  काला: "black",
  सफ़ेद: "white",
  सफेद: "white",
};

/** A canonical form for matching: synonyms, then English and Hindi plurals. */
export function canon(word: string): string {
  let w = word.toLowerCase();
  w = SYNONYMS[w] ?? w;
  if (w.length > 5 && /iy(a|aa)n$/.test(w)) return w.replace(/iy(a|aa)n$/, "i"); // kurtiyan → kurti
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1); // kurtis → kurti
  return w;
}

/** Optimal string alignment distance (Levenshtein plus adjacent swaps). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Same word, allowing plurals and Hindi -a/-e forms (dupatta, dupatte). */
export function sameWord(a: string, b: string): boolean {
  const x = canon(a);
  const y = canon(b);
  if (x === y) return true;
  return (
    x.length > 3 && x.length === y.length && x.slice(0, -1) === y.slice(0, -1) && /[ae]$/.test(x) && /[ae]$/.test(y)
  );
}

/** Close enough to be a typo: one edit for 5+ letters, two for 7+. */
export function nearWord(a: string, b: string): boolean {
  const x = canon(a);
  const y = canon(b);
  const len = Math.min(x.length, y.length);
  if (len < 5 || !/^\p{L}+$/u.test(x) || !/^\p{L}+$/u.test(y)) return false;
  return editDistance(x, y) <= (len >= 7 ? 2 : 1);
}

/** Words that carry no product meaning. Skipped when reading product names. */
export const FILLER = new Set([
  "wali",
  "wala",
  "wale",
  "waali",
  "waala",
  "vali",
  "vala",
  "ye",
  "yeh",
  "ya",
  "wo",
  "woh",
  "vo",
  "the",
  "a",
  "an",
  "ka",
  "ki",
  "ke",
  "me",
  "mein",
  "bhi",
  "aur",
  "and",
  "of",
  "for",
  "my",
  "mera",
  "meri",
  "please",
  "pls",
  "plz",
  "one",
  "more",
  "this",
  "that",
  "jo",
  "is",
  "it",
  "in",
  "with",
  "ek",
  "do",
]);

/** Words too generic to identify a product on their own. */
export const WEAK = new Set([
  "set",
  "pack",
  "combo",
  "piece",
  "pcs",
  "size",
  "new",
  "style",
  "design",
  "plain",
  "free",
  "item",
]);

export const NUMBER_WORDS: Record<string, number> = {
  ek: 1,
  one: 1,
  do: 2,
  two: 2,
  teen: 3,
  three: 3,
  char: 4,
  chaar: 4,
  four: 4,
  paanch: 5,
  panch: 5,
  five: 5,
  chhe: 6,
  six: 6,
  saat: 7,
  seven: 7,
  aath: 8,
  eight: 8,
  nau: 9,
  nine: 9,
  das: 10,
  dus: 10,
  ten: 10,
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पांच: 5,
  पाँच: 5,
};

/** Parses "1,500" or "1500.00" into a number. */
export function parseAmount(text: string): number {
  return Number(text.replace(/,/g, ""));
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function titleCase(text: string): string {
  return text.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

// Abbreviations whose full stop doesn't end a sentence ("Flat No. 7", "Rs. 799").
const ABBREVIATION = /(?:^|\s)(?:no|h|st|rd|dr|mr|mrs|ms|opp|nr|rs|sec|apt|bldg|[a-z])\.$/i;

/** Splits a message into sentences without breaking addresses like "Flat No. 7". */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of text.matchAll(/[.?!।]+(?=\s)|\n+/g)) {
    const end = m.index + m[0].length;
    const chunk = text.slice(start, end);
    if (m[0] === "." && ABBREVIATION.test(chunk.trimEnd())) continue;
    out.push(chunk);
    start = end;
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}
