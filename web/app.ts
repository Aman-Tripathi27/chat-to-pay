// The Chat-to-Pay web app. Everything runs in the browser: the chat is read by the
// built-in order reader (src/lib/parser), and the shop setup and orders live in localStorage.

import { readOrder, type ParsedOrder, type PriceSource } from "../src/lib/parser";

interface Shop {
  name: string;
  catalog: string;
  policies: string;
}

interface DraftItem {
  name: string;
  variant: string | null;
  quantity: number;
  unit_price_inr: number | null;
  price_source: PriceSource;
}

interface Draft {
  customer_name: string | null;
  customer_phone: string | null;
  customer_language: string;
  items: DraftItem[];
  shipping_address: string | null;
  delivery_charge_inr: number;
  discount_inr: number;
}

interface Meta {
  missing: string[];
  question: string | null;
  template: string;
  summary: string | null;
}

interface Order {
  id: string;
  link: string;
  status: "created" | "paid";
  amount: number;
  createdAt: number;
  customerName: string | null;
  customerPhone: string | null;
  items: string;
  language: string;
  slip: number;
  paidAt?: number;
}

type Phase = "idle" | "review" | "done";

const SAMPLE_SHOP: Shop = {
  name: "Priya's Kurti Studio",
  catalog:
    "Blue cotton kurti - ₹799 (sizes S, M, L, XL)\nPink anarkali kurti - ₹1,199 (sizes M, L)\nPrinted dupatta - ₹349\nDelivery: ₹60 per order, free above ₹1,500",
  policies:
    "No COD, prepaid only (UPI or card).\nDispatch within 2 days of payment, delivery 4-6 days.\nExchange within 7 days for size issues, no returns.",
};
const SAMPLE_CHAT = [
  "[10:02] Customer: Hi di, ye blue wali kurti available hai?",
  "[10:05] Seller: Haan ji available hai 😊",
  "[10:06] Customer: M size me 2 chahiye. Aur wo printed dupatta bhi 1 bhej do jo story me tha",
  "[10:07] Customer: Address - Neha Verma, Flat 302, Shanti Apartments, Kothrud, Pune 411038",
  "[10:07] Customer: Mera number 98765 43210",
  "[10:08] Customer: COD hai kya?",
].join("\n");
const DEFAULT_REPLY = "Thank you! Your order: {{ITEMS}}. Total {{TOTAL}}. You can pay here: {{LINK}}";
const AVATAR_COLORS = ["#0071e3", "#5e5ce6", "#a550a7", "#d6336c", "#c45500", "#0f7d8c", "#248a3d"];

const ICON = {
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 4z"/></svg>',
  slip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6M9 12h6M9 16h3.5"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5h.01"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
};

// ---- Per-viewer storage (may be unavailable: falls back to memory)

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // memory only
    }
  },
};

let shop: Shop = store.get<Shop | null>("ctp.shop", null) ?? { ...SAMPLE_SHOP };
let orders: Order[] = store.get<Order[]>("ctp.orders", []);
if (!Array.isArray(orders)) orders = [];
let nextSlip = Number(store.get("ctp.slip", 42)) || 42;

const state = {
  phase: "idle" as Phase,
  draft: null as Draft | null,
  meta: null as Meta | null,
  slipNo: nextSlip,
  created: null as Order | null,
  reply: "",
  clearArmed: false,
  enterItem: -1,
  stats: null as { collected: number; pending: number; rate: number } | null,
  statsSeen: false,
};

// ---- Helpers

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector(selector) as T;
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
const lineTotal = (it: DraftItem) => it.quantity * (it.unit_price_inr ?? 0);
const subtotalOf = (d: Draft) => d.items.reduce((s, it) => s + lineTotal(it), 0);
const totalOf = (d: Draft) =>
  Math.max(0, Math.round((subtotalOf(d) + (d.delivery_charge_inr || 0) - (d.discount_inr || 0)) * 100) / 100);
const summaryOf = (items: DraftItem[]) =>
  items.map((i) => `${i.quantity}× ${i.name}${i.variant ? ` (${i.variant})` : ""}`).join(", ");
const fillReply = (tpl: string, v: { items: string; total: string; link: string }) =>
  tpl.split("{{ITEMS}}").join(v.items).split("{{TOTAL}}").join(v.total).split("{{LINK}}").join(v.link);
const rand = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
const today = () => new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const slipLabel = (n: number) => `No. ${String(n).padStart(4, "0")}`;
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const blankItem = (): DraftItem => ({
  name: "",
  variant: null,
  quantity: 1,
  unit_price_inr: null,
  price_source: "unknown",
});

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, "");
  if (d.length === 10 && /^[6-9]/.test(d)) return `+91${d}`;
  if (d.length === 11 && d.startsWith("0")) return `+91${d.slice(1)}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  return String(raw).trim().startsWith("+") && d.length >= 7 && d.length <= 13 ? `+${d}` : null;
}
const waLink = (phone: string | null, text: string) =>
  `https://wa.me/${(normalizePhone(phone) ?? "").replace("+", "")}?text=${encodeURIComponent(text)}`;

function timeAgo(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function avatarColor(name: string | null): string {
  let h = 0;
  for (const ch of name ?? "?") h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string): void {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1700);
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    toast(ok ? "Copied" : "Select the text to copy it");
  }
}

function countTo(el: HTMLElement, to: number, format: (v: number) => string, from = 0): void {
  if (reduceMotion() || from === to) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / 1000);
    el.textContent = format(from + (to - from) * (1 - Math.pow(1 - t, 4)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function restartAnimation(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function scrollToId(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const top = id === "overview" ? 0 : el.getBoundingClientRect().top + window.scrollY - $(".gnav").offsetHeight;
  window.scrollTo({ top, behavior: reduceMotion() ? "auto" : "smooth" });
}

/** Brings the result card into view. On phones it sits below the chat, so glide down to it. */
function revealRight(force = false): void {
  const navHeight = $(".gnav").offsetHeight;
  const top = $("#right").getBoundingClientRect().top;
  if (!force && top > navHeight && top < window.innerHeight * 0.75) return;
  window.scrollTo({ top: top + window.scrollY - navHeight - 16, behavior: reduceMotion() ? "auto" : "smooth" });
}

// ---- Reading a chat

function toDraft(order: ParsedOrder): Draft {
  return {
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    customer_language: order.customer_language,
    items: order.items.length ? order.items.map((i) => ({ ...i, quantity: Math.max(1, i.quantity) })) : [blankItem()],
    shipping_address: order.shipping_address,
    delivery_charge_inr: order.delivery_charge_inr,
    discount_inr: order.discount_inr,
  };
}

function readChat(): void {
  const chat = $<HTMLTextAreaElement>("#chat").value.trim();
  if (!chat) {
    toast("Paste a chat first");
    return;
  }
  const order = readOrder(chat.slice(0, 20000), shop);
  state.draft = toDraft(order);
  state.meta = {
    missing: order.missing_info,
    question: order.clarifying_question,
    template: order.reply_template || DEFAULT_REPLY,
    summary: order.seller_summary,
  };
  state.slipNo = nextSlip;
  state.phase = "review";
  render();
  revealRight();
}

function fillByHand(): void {
  state.draft = {
    customer_name: null,
    customer_phone: null,
    customer_language: "English",
    items: [blankItem()],
    shipping_address: null,
    delivery_charge_inr: 0,
    discount_inr: 0,
  };
  state.meta = { missing: [], question: null, template: DEFAULT_REPLY, summary: "Filled in by hand." };
  state.slipNo = nextSlip;
  state.phase = "review";
  render();
}

function blockers(): string[] {
  const d = state.draft;
  if (!d) return [];
  const out: string[] = [];
  if (!d.items.length) out.push("Add at least one item.");
  if (d.items.some((i) => !i.name.trim())) out.push("Every item needs a name.");
  if (d.items.some((i) => i.unit_price_inr === null)) out.push("Every item needs a price.");
  if (totalOf(d) < 1) out.push("The total must be at least ₹1.");
  return out;
}

function createLink(): void {
  const d = state.draft;
  const meta = state.meta;
  if (!d || !meta || blockers().length) return;
  const id = `plink_${rand(10)}`;
  const order: Order = {
    id,
    link: `https://pay.example/${id.slice(6)}`,
    status: "created",
    amount: totalOf(d),
    createdAt: Date.now(),
    customerName: d.customer_name,
    customerPhone: normalizePhone(d.customer_phone) ?? d.customer_phone,
    items: summaryOf(d.items),
    language: d.customer_language,
    slip: state.slipNo,
  };
  orders = [order, ...orders].slice(0, 100);
  store.set("ctp.orders", orders);
  nextSlip = state.slipNo + 1;
  store.set("ctp.slip", nextSlip);
  const filled = fillReply(meta.template, { items: order.items, total: inr(order.amount), link: order.link });
  state.reply = filled.includes(order.link) ? filled : `${filled}\n\n${order.link}`;
  state.created = order;
  state.phase = "done";
  render();
  renderOrders(false);
  revealRight(true);
}

// ---- Rendering: result card

const SRC_LABEL: Record<PriceSource, [string, boolean]> = {
  catalog: ["From your catalog", false],
  seller_message: ["Price set by you", false],
  customer_claim: ["Customer's price, please confirm", true],
  unknown: ["Check the price", true],
};
const srcOf = (it: DraftItem): [string, boolean] =>
  it.unit_price_inr === null ? ["Add a price", true] : SRC_LABEL[it.price_source];

function emptyHTML(cls: string): string {
  const steps: [string, string, string][] = [
    [ICON.chat, "Paste the chat", "Hinglish, Hindi or English. A sample is already loaded."],
    [ICON.slip, "Check the order", "Items, sizes, prices, delivery and the address are filled in for you."],
    [ICON.send, "Send the link", "A payment link and a WhatsApp reply in the customer's language."],
  ];
  return `<div class="card ${cls}">
    <h3 class="big-title">Your order appears here.</h3>
    <p class="sub">Three steps, no retyping.</p>
    <ol class="steps">${steps.map(([icon, t, b]) => `<li><span class="step-icon">${icon}</span><div><strong>${t}</strong><span>${b}</span></div></li>`).join("")}</ol>
    <p class="empty-foot">Prefer typing? <button class="textlink" data-act="manual" type="button">Fill in an order by hand</button></p>
  </div>`;
}

function itemHTML(it: DraftItem, i: number, enter: boolean): string {
  const [srcText, warn] = srcOf(it);
  const animate = enter || i === state.enterItem;
  return `<div class="item${animate ? " row-enter" : ""}" data-i="${i}"${enter ? ` style="animation-delay:${120 + i * 70}ms"` : ""}>
    <input class="input" id="item-${i}-name" data-f="name" value="${esc(it.name)}" placeholder="Item name" autocomplete="off" aria-label="Item ${i + 1} name">
    <button class="x" data-act="remove-item" data-i="${i}" type="button" aria-label="Remove item ${i + 1}">${ICON.x}</button>
    <div class="item-row">
      <input class="input" id="item-${i}-variant" data-f="variant" value="${esc(it.variant)}" placeholder="Size" autocomplete="off" aria-label="Item ${i + 1} size or variant">
      <div class="stepper" role="group" aria-label="Quantity">
        <button type="button" data-act="qty-dec" data-i="${i}" aria-label="Decrease quantity">−</button>
        <input id="item-${i}-qty" data-f="quantity" type="number" min="1" inputmode="numeric" value="${it.quantity}" aria-label="Item ${i + 1} quantity">
        <button type="button" data-act="qty-inc" data-i="${i}" aria-label="Increase quantity">+</button>
      </div>
      <span class="money"><input class="input${it.unit_price_inr === null ? " need" : ""}" id="item-${i}-price" data-f="unit_price_inr" type="number" min="0" inputmode="decimal" value="${it.unit_price_inr ?? ""}" placeholder="Price" aria-label="Item ${i + 1} price each in rupees"></span>
    </div>
    <p class="item-foot"><span class="src${warn ? " warn" : ""}" data-src>${srcText}</span><span class="line" data-line>${inr(lineTotal(it))}</span></p>
  </div>`;
}

function reviewHTML(d: Draft, m: Meta, cls: string, enter: boolean): string {
  const missing =
    m.missing.length || m.question
      ? `<div class="missing">
      ${m.missing.length ? `<p class="missing-title">${ICON.warn}Before you charge</p><ul>${m.missing.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${
        m.question
          ? `<div class="ask"><span class="label">Ask the customer</span><p class="msg">${esc(m.question)}</p>
        <div class="btns"><a class="btn green sm" href="${esc(waLink(d.customer_phone, m.question))}" target="_blank" rel="noreferrer">${ICON.send}Ask on WhatsApp</a>
        <button class="btn gray sm" data-act="copy-question" type="button">${ICON.copy}Copy</button></div></div>`
          : ""
      }
    </div>`
      : "";
  return `<article class="card slip ${cls}" aria-labelledby="order-title">
    <div class="order-head">
      <h3 class="big-title" id="order-title">Check the order</h3>
      <span class="meta">${slipLabel(state.slipNo)} · ${esc(today())}</span>
    </div>
    ${m.summary ? `<p class="summary">${esc(m.summary)}</p>` : ""}
    ${missing}
    <div class="fields">
      <label class="f" for="f-name"><span class="cap">Customer</span><input class="input" id="f-name" data-k="customer_name" value="${esc(d.customer_name)}" autocomplete="off"></label>
      <label class="f" for="f-phone"><span class="cap">Phone</span><input class="input" id="f-phone" data-k="customer_phone" inputmode="tel" value="${esc(d.customer_phone)}" autocomplete="off"></label>
      <label class="f wide" for="f-addr"><span class="cap">Delivery address</span><input class="input" id="f-addr" data-k="shipping_address" value="${esc(d.shipping_address)}" autocomplete="off"></label>
    </div>
    <div class="items-head"><span class="label">Items</span><span class="meta">${esc(d.customer_language)}</span></div>
    <div class="items" id="items">${d.items.map((it, i) => itemHTML(it, i, enter)).join("")}</div>
    <button class="add" data-act="add-item" type="button">${ICON.plus}Add item</button>
    <dl class="totals">
      <div><dt>Subtotal</dt><dd id="t-sub"></dd></div>
      <div><dt><label for="f-del">Delivery</label></dt><dd><span class="money"><input class="input" id="f-del" data-k="delivery_charge_inr" type="number" min="0" inputmode="decimal" value="${d.delivery_charge_inr}"></span></dd></div>
      <div><dt><label for="f-disc">Discount</label></dt><dd><span class="money"><input class="input" id="f-disc" data-k="discount_inr" type="number" min="0" inputmode="decimal" value="${d.discount_inr}"></span></dd></div>
      <div class="grand"><dt>Total</dt><dd id="t-total"></dd></div>
    </dl>
    <p class="warn-text" id="blocker" hidden></p>
    <button class="btn primary block lg" id="create" data-act="create" type="button">Create payment link</button>
  </article>`;
}

function doneHTML(o: Order, cls: string): string {
  return `<div class="card ${cls}">
    <div class="done-head">
      <svg class="check" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28"/><path d="M20 33l8 8 16-17"/></svg>
      <h3 class="big-title">Payment link ready</h3>
      <p class="sub">${inr(o.amount)} for ${esc(o.customerName ?? "your customer")} · ${slipLabel(o.slip)}</p>
    </div>
    <div class="linkbox"><code>${esc(o.link)}</code><button class="btn gray sm" data-act="copy-link" type="button">${ICON.copy}Copy</button></div>
    <p class="note-sm">Simulated link. Connect a payment provider to send real payment links.</p>
    <label class="label reply-label" for="reply">Reply to the customer</label>
    <textarea id="reply" class="input">${esc(state.reply)}</textarea>
    <div class="split">
      <a class="btn green" id="send-wa" href="${esc(waLink(o.customerPhone, state.reply))}" target="_blank" rel="noreferrer">${ICON.send}Send on WhatsApp</a>
      <button class="btn gray" data-act="copy-reply" type="button">${ICON.copy}Copy message</button>
    </div>
    <div class="foot">
      <button class="textlink" data-scroll="orders" type="button">See all orders ›</button>
      <button class="textlink muted-link" data-act="new" type="button">Start a new order</button>
    </div>
  </div>`;
}

let shownPhase: Phase | null = null;
function renderRight(): void {
  const enter = shownPhase !== null && state.phase !== shownPhase;
  shownPhase = state.phase;
  const cls = enter ? "enter" : "";
  const { draft, meta, created } = state;
  let html: string;
  if (state.phase === "review" && draft && meta) html = reviewHTML(draft, meta, cls, enter);
  else if (state.phase === "done" && created) html = doneHTML(created, cls);
  else html = emptyHTML(cls);
  $("#right").innerHTML = html;
  state.enterItem = -1;
  if (state.phase === "review") updateTotals(true);
}

function updateTotals(initial = false): void {
  const d = state.draft;
  if (!d) return;
  $("#t-sub").textContent = inr(subtotalOf(d));
  const totalEl = $("#t-total");
  const totalText = inr(totalOf(d));
  if (!initial && totalEl.textContent !== totalText) restartAnimation(totalEl, "pop");
  totalEl.textContent = totalText;
  document.querySelectorAll<HTMLElement>("#items .item").forEach((row) => {
    const it = d.items[Number(row.dataset.i)];
    if (!it) return;
    row.querySelector<HTMLElement>("[data-line]")!.textContent = inr(lineTotal(it));
    const [text, warn] = srcOf(it);
    const src = row.querySelector<HTMLElement>("[data-src]")!;
    src.textContent = text;
    src.className = warn ? "src warn" : "src";
    row.querySelector<HTMLElement>('[data-f="unit_price_inr"]')!.classList.toggle("need", it.unit_price_inr === null);
  });
  const b = blockers();
  const blocker = $("#blocker");
  blocker.hidden = b.length === 0;
  blocker.textContent = b[0] ?? "";
  const btn = $<HTMLButtonElement>("#create");
  btn.disabled = b.length > 0;
  btn.textContent = `Create payment link · ${totalText}`;
}

// ---- Rendering: orders

function renderOrders(animateFromZero: boolean): void {
  const paid = orders.filter((o) => o.status === "paid");
  const open = orders.filter((o) => o.status === "created");
  const next = {
    collected: paid.reduce((s, o) => s + o.amount, 0),
    pending: open.reduce((s, o) => s + o.amount, 0),
    rate: orders.length ? Math.round((paid.length / orders.length) * 100) : 0,
  };
  const prev = animateFromZero ? { collected: 0, pending: 0, rate: 0 } : (state.stats ?? next);
  state.stats = next;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  $("#stats").innerHTML = (
    [
      ["Collected", "collected", plural(paid.length, "paid order"), "good"],
      ["Pending", "pending", plural(open.length, "open link"), ""],
      ["Paid rate", "rate", "of links sent", ""],
    ] as const
  )
    .map(
      ([k, key, h, c]) =>
        `<div class="stat"><p class="k">${k}</p><p class="v ${c}" data-stat="${key}"></p><p class="h">${h}</p></div>`,
    )
    .join("");
  const rupees = (v: number) => inr(Math.round(v));
  countTo($('[data-stat="collected"]'), next.collected, rupees, prev.collected);
  countTo($('[data-stat="pending"]'), next.pending, rupees, prev.pending);
  countTo($('[data-stat="rate"]'), next.rate, (v) => `${Math.round(v)}%`, prev.rate);

  const clear = $<HTMLButtonElement>("#clear");
  clear.hidden = orders.length === 0;
  clear.textContent = state.clearArmed ? "Click again to clear" : "Clear orders";
  $("#nav-orders").textContent = orders.length ? `Orders (${orders.length})` : "Orders";

  if (!orders.length) {
    $("#orders-list").innerHTML = `<div class="empty-list">
      <h3 class="big-title">No orders yet.</h3>
      <p class="sub" style="margin-bottom:18px">Payment links you make from chats show up here.</p>
      <button class="btn primary" data-scroll="try" type="button">Make the first one</button></div>`;
    return;
  }
  $("#orders-list").innerHTML = `<ul class="list">${orders
    .map((o) => {
      const isOpen = o.status === "created";
      const first = o.customerName ? o.customerName.split(" ")[0] : "";
      const remind = /hinglish|hindi/i.test(o.language)
        ? `Hi${first ? " " + first : ""}! Aapka order (${o.items}) abhi payment pending hai. Yahan se pay kar sakte hain: ${o.link} 🙏`
        : `Hi${first ? " " + first : ""}! A quick reminder that your order (${o.items}) is awaiting payment. You can pay here: ${o.link}`;
      return `<li>
      <span class="avatar" style="background:${avatarColor(o.customerName)}" aria-hidden="true">${esc(initials(o.customerName))}</span>
      <div class="who-col">
        <p class="name">${esc(o.customerName ?? "Customer")}<span class="status ${isOpen ? "created" : "paid"}">${isOpen ? "Awaiting payment" : "Paid"}</span></p>
        <p class="items-line">${esc(o.items)}</p>
        <p class="meta-line">${timeAgo(o.createdAt)} · ${slipLabel(o.slip)}${o.customerPhone ? " · " + esc(o.customerPhone) : ""}</p>
      </div>
      <span class="amt">${inr(o.amount)}</span>
      <div class="btns">
        <button class="btn gray sm" data-act="copy-order" data-id="${esc(o.id)}" type="button">${ICON.copy}Copy link</button>
        ${
          isOpen
            ? `<a class="btn green sm" href="${esc(waLink(o.customerPhone, remind))}" target="_blank" rel="noreferrer">Remind</a>
        <button class="btn gray sm" data-act="mark-paid" data-id="${esc(o.id)}" type="button">Mark paid</button>`
            : ""
        }
      </div>
    </li>`;
    })
    .join("")}</ul>`;
}

function shopSubtitle(): string {
  return shop.catalog.trim() ? shop.name || "Catalog saved" : "Add your products and prices";
}

function render(): void {
  $("#read-label").textContent = state.draft && state.phase === "review" ? "Read again" : "Read order";
  $("#shop-sub").textContent = shopSubtitle();
  renderRight();
}

function syncShopInputs(): void {
  $<HTMLInputElement>("#shop-name").value = shop.name;
  $<HTMLTextAreaElement>("#shop-catalog").value = shop.catalog;
  $<HTMLTextAreaElement>("#shop-policies").value = shop.policies;
}

function setQuantity(i: number, quantity: number): void {
  const it = state.draft?.items[i];
  if (!it) return;
  it.quantity = Math.max(1, Math.min(999, quantity));
  const input = document.querySelector<HTMLInputElement>(`#item-${i}-qty`);
  if (input) input.value = String(it.quantity);
  updateTotals();
}

// ---- Events

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const jump = target.closest<HTMLElement>("[data-scroll]");
  if (jump) {
    e.preventDefault();
    scrollToId(jump.dataset.scroll ?? "");
    return;
  }
  const act = target.closest<HTMLElement>("[data-act]");
  if (!act) return;
  const d = state.draft;
  const i = Number(act.dataset.i);
  switch (act.dataset.act) {
    case "manual":
      fillByHand();
      break;
    case "qty-dec":
      if (d) setQuantity(i, d.items[i].quantity - 1);
      break;
    case "qty-inc":
      if (d) setQuantity(i, d.items[i].quantity + 1);
      break;
    case "add-item":
      if (!d) break;
      d.items.push(blankItem());
      state.enterItem = d.items.length - 1;
      renderRight();
      document.querySelector<HTMLInputElement>(`#item-${d.items.length - 1}-name`)?.focus();
      break;
    case "remove-item":
      d?.items.splice(i, 1);
      renderRight();
      break;
    case "create":
      createLink();
      break;
    case "copy-question":
      if (state.meta?.question) void copyText(state.meta.question);
      break;
    case "copy-link":
      if (state.created) void copyText(state.created.link);
      break;
    case "copy-reply":
      void copyText(state.reply);
      break;
    case "copy-order": {
      const o = orders.find((x) => x.id === act.dataset.id);
      if (o) void copyText(o.link);
      break;
    }
    case "mark-paid": {
      const o = orders.find((x) => x.id === act.dataset.id);
      if (o) {
        o.status = "paid";
        o.paidAt = Date.now();
        store.set("ctp.orders", orders);
        renderOrders(false);
        toast("Marked as paid");
      }
      break;
    }
    case "new":
      state.draft = null;
      state.meta = null;
      state.created = null;
      state.reply = "";
      state.phase = "idle";
      $<HTMLTextAreaElement>("#chat").value = "";
      render();
      $("#chat").focus();
      break;
  }
});

$("#clear").addEventListener("click", () => {
  if (!state.clearArmed) {
    state.clearArmed = true;
    renderOrders(false);
    return;
  }
  orders = [];
  store.set("ctp.orders", orders);
  state.clearArmed = false;
  renderOrders(false);
});

$("#right").addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "reply") {
    state.reply = t.value;
    const wa = document.querySelector<HTMLAnchorElement>("#send-wa");
    if (wa && state.created) wa.href = waLink(state.created.customerPhone, state.reply);
    return;
  }
  const d = state.draft;
  if (!d || state.phase !== "review") return;
  const key = t.dataset.k;
  if (key === "delivery_charge_inr" || key === "discount_inr") d[key] = Math.max(0, Number(t.value) || 0);
  else if (key === "customer_name" || key === "customer_phone" || key === "shipping_address")
    d[key] = t.value.trim() ? t.value : null;
  const row = t.closest<HTMLElement>(".item");
  const field = t.dataset.f;
  if (row && field) {
    const it = d.items[Number(row.dataset.i)];
    if (field === "quantity") it.quantity = Math.max(1, Math.min(999, Math.floor(Number(t.value) || 1)));
    else if (field === "unit_price_inr") {
      it.unit_price_inr = t.value.trim() === "" ? null : Math.max(0, Number(t.value) || 0);
      it.price_source = "seller_message";
    } else if (field === "variant") it.variant = t.value.trim() ? t.value : null;
    else it.name = t.value;
  }
  updateTotals();
});

$("#read").addEventListener("click", readChat);
$("#load-sample").addEventListener("click", () => {
  $<HTMLTextAreaElement>("#chat").value = SAMPLE_CHAT;
  if (!shop.catalog.trim()) {
    shop = { ...SAMPLE_SHOP };
    store.set("ctp.shop", shop);
    syncShopInputs();
    render();
  }
  toast("Sample chat loaded");
});
for (const [id, key] of [
  ["#shop-name", "name"],
  ["#shop-catalog", "catalog"],
  ["#shop-policies", "policies"],
] as const) {
  $(id).addEventListener("input", (e) => {
    shop = { ...shop, [key]: (e.target as HTMLInputElement).value };
    store.set("ctp.shop", shop);
    $("#shop-sub").textContent = shopSubtitle();
  });
}

// ---- Start

$<HTMLTextAreaElement>("#chat").value = SAMPLE_CHAT;
syncShopInputs();
render();
renderOrders(false);
// Count the stats up once, the first time the orders section scrolls into view (they're already shown at rest).
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((en) => en.isIntersecting) && !state.statsSeen) {
        state.statsSeen = true;
        renderOrders(true);
        io.disconnect();
      }
    },
    { threshold: 0.3 },
  );
  io.observe($("#stats"));
}
if (["#orders", "#try", "#how"].includes(location.hash)) setTimeout(() => scrollToId(location.hash.slice(1)), 50);
