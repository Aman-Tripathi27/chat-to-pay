"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatINR, whatsappLink, type OrderRow } from "@/lib/order";
import { useCopy } from "@/components/useCopy";

const STATUS: Record<OrderRow["status"], { text: string; className: string }> = {
  paid: { text: "Paid", className: "bg-ok-soft text-ok" },
  partially_paid: { text: "Part paid", className: "bg-warn-soft text-warn" },
  created: { text: "Awaiting payment", className: "bg-accent-soft text-accent" },
  expired: { text: "Expired", className: "bg-surface-2 text-muted" },
  cancelled: { text: "Cancelled", className: "bg-surface-2 text-muted" },
};

function reminderText(order: OrderRow): string {
  const name = order.customerName ? ` ${order.customerName.split(" ")[0]}` : "";
  const hindiStyle = /hinglish|hindi/i.test(order.language ?? "");
  return hindiStyle
    ? `Hi${name}! Aapka order (${order.items}) abhi payment pending hai. Yahan se pay kar sakte hain: ${order.shortUrl} 🙏`
    : `Hi${name}! A quick reminder that your order (${order.items}) is awaiting payment. You can pay here: ${order.shortUrl}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function timeAgo(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function OrdersDashboard() {
  const { copied, copy } = useCopy();
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/links", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't load orders.");
      setOrders(body.orders);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load orders.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Refresh when the seller comes back to the tab (e.g. after sending a link).
    const onFocus = () => void load();
    const initial = setTimeout(onFocus, 0);
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(initial);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const paid = orders?.filter((o) => o.status === "paid" || o.status === "partially_paid") ?? [];
  const waiting = orders?.filter((o) => o.status === "created") ?? [];
  const collected = paid.reduce((s, o) => s + o.amountPaid, 0);
  const waitingAmount = waiting.reduce((s, o) => s + o.amount - o.amountPaid, 0);
  const counted = orders?.filter((o) => o.status !== "cancelled").length ?? 0;
  const paidRate = counted ? Math.round((paid.length / counted) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="mt-1 text-sm text-muted">Every link created from a chat, with live status from Razorpay.</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={refreshing}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat
          label="Collected"
          value={orders ? formatINR(collected) : "—"}
          hint={plural(paid.length, "paid order")}
          tone="ok"
        />
        <Stat
          label="Pending"
          value={orders ? formatINR(waitingAmount) : "—"}
          hint={plural(waiting.length, "open link")}
        />
        <Stat label="Paid rate" value={orders ? `${paidRate}%` : "—"} hint="of links sent" />
      </div>

      {error && (
        <div role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {orders === null && !error && <p className="text-sm text-muted">Loading orders…</p>}

      {orders?.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <p className="font-medium">No orders yet</p>
          <p className="mt-1 text-sm text-muted">Links you create from chats show up here.</p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
          >
            Create the first one
          </Link>
        </div>
      )}

      {orders && orders.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          {orders.map((order) => {
            const open = order.status === "created" || order.status === "partially_paid";
            return (
              <li key={order.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{order.customerName ?? "Customer"}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[order.status].className}`}>
                      {STATUS[order.status].text}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted">{order.items || "—"}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {timeAgo(order.createdAt)}
                    {order.customerPhone ? ` · ${order.customerPhone}` : ""}
                  </p>
                </div>
                <p className="font-semibold tabular-nums sm:w-24 sm:text-right">{formatINR(order.amount)}</p>
                <div className="ml-auto flex gap-2 sm:ml-0">
                  <button
                    onClick={() => copy(order.id, order.shortUrl)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium"
                  >
                    {copied === order.id ? "Copied" : "Copy link"}
                  </button>
                  {open && (
                    <a
                      href={whatsappLink(order.customerPhone, reminderText(order))}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-wa px-3 py-1.5 text-xs font-medium text-wa-ink"
                    >
                      Remind
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "ok" }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-surface p-3 shadow-sm sm:p-4">
      <p className="truncate text-xs text-muted sm:text-sm">{label}</p>
      <p className={`mt-1 truncate text-lg font-semibold tabular-nums sm:text-2xl ${tone === "ok" ? "text-ok" : ""}`}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted">{hint}</p>
    </div>
  );
}
