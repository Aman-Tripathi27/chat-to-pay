"use client";

import Link from "next/link";
import { useState } from "react";
import {
  fillReply,
  formatINR,
  itemsSummary,
  lineTotal,
  orderTotal,
  whatsappLink,
  type ExtractedOrder,
  type OrderRow,
} from "@/lib/order";
import { SAMPLE_CHAT, SAMPLE_SHOP } from "@/lib/sample";
import { useCopy } from "@/components/useCopy";
import { saveShop, useStoredShop } from "@/components/useStoredShop";

type DraftItem = {
  name: string;
  variant: string | null;
  quantity: number;
  unit_price_inr: number | null;
  price_source: ExtractedOrder["items"][number]["price_source"];
};

type Draft = {
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_language: string;
  items: DraftItem[];
  shipping_address: string | null;
  pincode: string | null;
  delivery_charge_inr: number;
  discount_inr: number;
};

type Meta = Pick<ExtractedOrder, "missing_info" | "clarifying_question" | "reply_template" | "seller_summary">;

type Phase = "idle" | "reading" | "review" | "creating" | "done";

const numberOrNull = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
const orNull = (v: string) => (v.trim() === "" ? null : v);

export function NewOrder() {
  const shop = useStoredShop();
  const { copied, copy } = useCopy();

  const [chat, setChat] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [created, setCreated] = useState<OrderRow | null>(null);
  const [reply, setReply] = useState("");
  const [shopOpen, setShopOpen] = useState(false);

  const shopIsEmpty = !shop.catalog.trim();

  function loadSample() {
    setChat(SAMPLE_CHAT);
    if (shopIsEmpty) saveShop(SAMPLE_SHOP);
  }

  async function readChat() {
    setPhase("reading");
    setError(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat, shopName: shop.name, catalog: shop.catalog, policies: shop.policies }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't read the chat.");
      const order = body.order as ExtractedOrder;
      setDraft({
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        customer_email: order.customer_email,
        customer_language: order.customer_language,
        items: order.items.map((i) => ({ ...i, quantity: Math.max(1, i.quantity) })),
        shipping_address: order.shipping_address,
        pincode: order.pincode,
        delivery_charge_inr: order.delivery_charge_inr ?? 0,
        discount_inr: order.discount_inr ?? 0,
      });
      setMeta({
        missing_info: order.missing_info,
        clarifying_question: order.clarifying_question,
        reply_template: order.reply_template,
        seller_summary: order.seller_summary,
      });
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the chat.");
      setPhase("idle");
    }
  }

  async function createLink() {
    if (!draft || !meta) return;
    setPhase("creating");
    setError(null);
    try {
      const res = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          items: draft.items.map(({ name, variant, quantity, unit_price_inr }) => ({
            name,
            variant,
            quantity,
            unit_price_inr: unit_price_inr ?? 0,
          })),
          shop_name: shop.name || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't create the payment link.");
      const order = body.order as OrderRow;
      const values = { items: itemsSummary(draft.items), total: formatINR(order.amount), link: order.shortUrl };
      const filled = fillReply(meta.reply_template, values);
      setReply(filled.includes(order.shortUrl) ? filled : `${filled}\n\n${order.shortUrl}`);
      setCreated(order);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the payment link.");
      setPhase("review");
    }
  }

  function reset() {
    setChat("");
    setDraft(null);
    setMeta(null);
    setCreated(null);
    setReply("");
    setError(null);
    setPhase("idle");
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setDraft((d) => d && { ...d, items: d.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) });
  }

  const total = draft ? orderTotal(draft) : 0;
  const subtotal = draft ? draft.items.reduce((s, i) => s + lineTotal(i), 0) : 0;
  const blockers: string[] = [];
  if (draft) {
    if (draft.items.length === 0) blockers.push("Add at least one item.");
    if (draft.items.some((i) => !i.name.trim())) blockers.push("Every item needs a name.");
    if (draft.items.some((i) => i.unit_price_inr === null)) blockers.push("Every item needs a price.");
    if (total < 1) blockers.push("The total must be at least ₹1.");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Left: chat input + shop setup */}
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Turn a chat into a payment</h1>
          <p className="mt-1 text-sm text-muted">
            Paste the WhatsApp or Instagram conversation. Claude reads the order, you check it, and the customer gets a
            Razorpay link.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="chat" className="text-sm font-medium">
              Customer chat
            </label>
            <button onClick={loadSample} className="text-sm font-medium text-accent hover:underline">
              Try a sample chat
            </button>
          </div>
          <textarea
            id="chat"
            rows={11}
            className="field resize-y font-mono text-[13px] leading-relaxed"
            placeholder={"Customer: Hi, is the blue kurti available in M?\nSeller: Yes!\nCustomer: Send 2, address is…"}
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            disabled={phase === "reading" || phase === "creating"}
          />
          <button
            onClick={readChat}
            disabled={!chat.trim() || phase === "reading" || phase === "creating"}
            className="mt-3 w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {phase === "reading" ? "Reading the chat…" : draft ? "Read again" : "Read order"}
          </button>
        </div>

        <div className="rounded-2xl border border-border bg-surface shadow-sm">
          <button
            onClick={() => setShopOpen((o) => !o)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
            aria-expanded={shopOpen}
          >
            <span>
              <span className="text-sm font-medium">Shop setup</span>
              <span className="ml-2 text-xs text-muted">
                {shopIsEmpty ? "Add your prices so Claude can fill them in" : shop.name || "Catalog saved"}
              </span>
            </span>
            <span className="text-muted">{shopOpen ? "−" : "+"}</span>
          </button>
          {shopOpen && (
            <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Shop name</span>
                <input
                  className="field"
                  value={shop.name}
                  placeholder="Priya's Kurti Studio"
                  onChange={(e) => saveShop({ ...shop, name: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Catalog and prices</span>
                <textarea
                  rows={5}
                  className="field text-[13px]"
                  value={shop.catalog}
                  placeholder={"Blue cotton kurti - ₹799 (S, M, L, XL)\nDelivery ₹60, free above ₹1,500"}
                  onChange={(e) => saveShop({ ...shop, catalog: e.target.value })}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Policies</span>
                <textarea
                  rows={3}
                  className="field text-[13px]"
                  value={shop.policies}
                  placeholder={"No COD. Dispatch in 2 days. Exchange within 7 days."}
                  onChange={(e) => saveShop({ ...shop, policies: e.target.value })}
                />
              </label>
              <p className="text-xs text-muted">Saved in this browser only.</p>
            </div>
          )}
        </div>
      </section>

      {/* Right: review / result */}
      <section className="space-y-4">
        {error && (
          <div role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {!draft && phase !== "reading" && <EmptyState />}
        {phase === "reading" && !draft && <ReadingState />}

        {draft && meta && phase !== "done" && (
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Check the order</h2>
              <p className="text-sm text-muted">{meta.seller_summary}</p>
            </div>

            {meta.missing_info.length > 0 && (
              <div className="mb-4 rounded-xl bg-warn-soft p-3 text-sm text-warn">
                <p className="font-medium">Before you charge</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {meta.missing_info.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
                {meta.clarifying_question && (
                  <div className="mt-3 rounded-lg bg-surface p-3 text-text">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted">Ask the customer</p>
                    <p className="mt-1 whitespace-pre-wrap">{meta.clarifying_question}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <a
                        href={whatsappLink(draft.customer_phone, meta.clarifying_question)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg bg-wa px-3 py-1.5 text-xs font-medium text-wa-ink"
                      >
                        Ask on WhatsApp
                      </a>
                      <button
                        onClick={() => copy("question", meta.clarifying_question!)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium"
                      >
                        {copied === "question" ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer name">
                <input
                  className="field"
                  value={draft.customer_name ?? ""}
                  onChange={(e) => setDraft({ ...draft, customer_name: orNull(e.target.value) })}
                />
              </Field>
              <Field label="Phone">
                <input
                  className="field"
                  inputMode="tel"
                  value={draft.customer_phone ?? ""}
                  onChange={(e) => setDraft({ ...draft, customer_phone: orNull(e.target.value) })}
                />
              </Field>
              <Field label="Address" className="sm:col-span-2">
                <input
                  className="field"
                  value={draft.shipping_address ?? ""}
                  onChange={(e) => setDraft({ ...draft, shipping_address: orNull(e.target.value) })}
                />
              </Field>
            </div>

            <h3 className="mb-2 mt-5 text-sm font-medium">Items</h3>
            <div className="space-y-2">
              {draft.items.map((item, i) => (
                <div key={i} className="rounded-xl border border-border p-3">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input
                      aria-label="Item name"
                      className="field"
                      value={item.name}
                      onChange={(e) => updateItem(i, { name: e.target.value })}
                    />
                    <button
                      aria-label="Remove item"
                      onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}
                      className="rounded-lg px-2 text-muted hover:bg-danger-soft hover:text-danger"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <input
                      aria-label="Size or variant"
                      placeholder="Size"
                      className="field"
                      value={item.variant ?? ""}
                      onChange={(e) => updateItem(i, { variant: orNull(e.target.value) })}
                    />
                    <input
                      aria-label="Quantity"
                      type="number"
                      min={1}
                      className="field"
                      value={item.quantity}
                      onChange={(e) =>
                        updateItem(i, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })
                      }
                    />
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">₹</span>
                      <input
                        aria-label="Unit price in rupees"
                        type="number"
                        min={0}
                        placeholder="Price"
                        className={`field pl-7 ${item.unit_price_inr === null ? "border-warn" : ""}`}
                        value={item.unit_price_inr ?? ""}
                        onChange={(e) =>
                          updateItem(i, {
                            unit_price_inr: numberOrNull(e.target.value),
                            price_source: "seller_message",
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <PriceSource source={item.price_source} hasPrice={item.unit_price_inr !== null} />
                    <span className="font-medium tabular-nums">{formatINR(lineTotal(item))}</span>
                  </div>
                </div>
              ))}
              <button
                onClick={() =>
                  setDraft({
                    ...draft,
                    items: [
                      ...draft.items,
                      { name: "", variant: null, quantity: 1, unit_price_inr: null, price_source: "unknown" },
                    ],
                  })
                }
                className="w-full rounded-xl border border-dashed border-border py-2 text-sm text-muted hover:text-text"
              >
                + Add item
              </button>
            </div>

            <dl className="mt-5 space-y-2 text-sm">
              <Row label="Subtotal" value={formatINR(subtotal)} />
              <Row
                label="Delivery"
                value={
                  <MoneyInput
                    value={draft.delivery_charge_inr}
                    onChange={(v) => setDraft({ ...draft, delivery_charge_inr: v })}
                  />
                }
              />
              <Row
                label="Discount"
                value={
                  <MoneyInput value={draft.discount_inr} onChange={(v) => setDraft({ ...draft, discount_inr: v })} />
                }
              />
              <div className="flex items-center justify-between border-t border-border pt-3 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatINR(total)}</dd>
              </div>
            </dl>

            {blockers.length > 0 && <p className="mt-3 text-sm text-warn">{blockers[0]}</p>}
            <button
              onClick={createLink}
              disabled={blockers.length > 0 || phase === "creating"}
              className="mt-4 w-full rounded-lg bg-accent px-4 py-3 font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {phase === "creating" ? "Creating link…" : `Create payment link for ${formatINR(total)}`}
            </button>
          </div>
        )}

        {phase === "done" && created && draft && (
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-ok-soft text-lg text-ok">✓</span>
              <div>
                <h2 className="text-lg font-semibold">Payment link ready</h2>
                <p className="text-sm text-muted">
                  {formatINR(created.amount)} for {draft.customer_name ?? "your customer"}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-xl bg-surface-2 p-2 pl-3">
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{created.shortUrl}</span>
              <button
                onClick={() => copy("link", created.shortUrl)}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium"
              >
                {copied === "link" ? "Copied" : "Copy link"}
              </button>
            </div>
            {created.id.startsWith("plink_demo_") && (
              <p className="mt-2 text-xs text-muted">
                Demo link. Add your Razorpay test keys to create real, payable links.
              </p>
            )}

            <label htmlFor="reply" className="mb-1.5 mt-5 block text-sm font-medium">
              Reply to the customer
            </label>
            <textarea
              id="reply"
              rows={6}
              className="field text-sm leading-relaxed"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <a
                href={whatsappLink(draft.customer_phone, reply)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-wa px-4 py-2.5 text-center font-medium text-wa-ink"
              >
                Send on WhatsApp
              </a>
              <button
                onClick={() => copy("reply", reply)}
                className="rounded-lg border border-border px-4 py-2.5 font-medium"
              >
                {copied === "reply" ? "Copied" : "Copy message"}
              </button>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm">
              <Link href="/orders" className="font-medium text-accent hover:underline">
                See all orders →
              </Link>
              <button onClick={reset} className="font-medium text-muted hover:text-text">
                Start a new order
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block text-muted">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function MoneyInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="relative inline-block w-28">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">₹</span>
      <input
        type="number"
        min={0}
        className="field py-1 pl-7 text-right"
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </span>
  );
}

function PriceSource({ source, hasPrice }: { source: DraftItem["price_source"]; hasPrice: boolean }) {
  if (!hasPrice) return <span className="font-medium text-warn">Add a price</span>;
  const labels: Record<DraftItem["price_source"], { text: string; className: string }> = {
    catalog: { text: "From your catalog", className: "text-muted" },
    seller_message: { text: "Price set by you", className: "text-muted" },
    customer_claim: { text: "Customer's price, please confirm", className: "font-medium text-warn" },
    unknown: { text: "Check the price", className: "font-medium text-warn" },
  };
  return <span className={labels[source].className}>{labels[source].text}</span>;
}

function EmptyState() {
  const steps = [
    ["Paste the chat", "Hinglish, Hindi, English: whatever your customer writes in."],
    ["Check the order", "Claude fills in items, sizes, prices and address, and flags anything missing."],
    ["Send the link", "One tap creates a Razorpay link and a WhatsApp reply in the customer's language."],
  ];
  return (
    <div className="rounded-2xl border border-dashed border-border p-6">
      <ol className="space-y-5">
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
              {i + 1}
            </span>
            <div>
              <p className="font-medium">{title}</p>
              <p className="text-sm text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ReadingState() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm" aria-live="polite">
      <p className="font-medium">Reading the chat…</p>
      <p className="mt-1 text-sm text-muted">Finding items, sizes, prices and the delivery address.</p>
      <div className="mt-4 space-y-2">
        {[80, 60, 70].map((w) => (
          <div key={w} className="h-3 animate-pulse rounded bg-surface-2" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
