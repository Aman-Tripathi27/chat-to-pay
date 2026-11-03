import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateLinkInput, OrderRow } from "@/lib/order";
import {
  PaymentError,
  SimulatedProvider,
  buildPaymentRequest,
  createPaymentLink,
  listOrders,
  paymentProvider,
  setPaymentProvider,
  type PaymentLinkProvider,
  type PaymentRequest,
} from "@/lib/payments";

const order: CreateLinkInput = {
  customer_name: "Neha Verma",
  customer_phone: "98765 43210",
  customer_email: "neha@example.com",
  customer_language: "Hinglish",
  items: [
    { name: "Blue cotton kurti", variant: "M", quantity: 2, unit_price_inr: 799 },
    { name: "Printed dupatta", variant: null, quantity: 1, unit_price_inr: 349 },
  ],
  shipping_address: "Flat 302, Shanti Apartments, Kothrud, Pune",
  pincode: "411038",
  delivery_charge_inr: 0,
  discount_inr: 0,
  shop_name: "Priya's Kurti Studio",
};

describe("buildPaymentRequest", () => {
  it("charges the server-computed total in paise", () => {
    const request = buildPaymentRequest(order);
    expect(request.amountMinor).toBe(194_700);
    expect(request.currency).toBe("INR");
  });

  it("tags the request so this app's links can be told apart", () => {
    expect(buildPaymentRequest(order).metadata).toMatchObject({
      source: "chat-to-pay",
      items: "2× Blue cotton kurti (M), 1× Printed dupatta",
      pincode: "411038",
      phone: "+919876543210",
      lang: "Hinglish",
    });
  });

  it("keeps metadata small enough for common gateway limits", () => {
    const { metadata } = buildPaymentRequest({ ...order, shipping_address: "A".repeat(500) });
    expect(Object.keys(metadata).length).toBeLessThanOrEqual(15);
    for (const value of Object.values(metadata)) expect(value.length).toBeLessThanOrEqual(256);
  });

  it("normalises the customer and drops an invalid email", () => {
    expect(buildPaymentRequest(order).customer).toEqual({
      name: "Neha Verma",
      phone: "+919876543210",
      email: "neha@example.com",
    });
    expect(buildPaymentRequest({ ...order, customer_email: "not-an-email" }).customer).not.toHaveProperty("email");
  });

  it("uses a unique, short reference id", () => {
    const a = buildPaymentRequest(order).referenceId;
    const b = buildPaymentRequest(order).referenceId;
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(40);
  });

  it("expires the link in 7 days", () => {
    const now = Math.floor(Date.now() / 1000);
    const { expiresAt } = buildPaymentRequest(order);
    expect(expiresAt - now).toBeGreaterThanOrEqual(7 * 24 * 3600 - 5);
    expect(expiresAt - now).toBeLessThanOrEqual(7 * 24 * 3600);
  });

  it("refuses totals under ₹1", () => {
    const free = { ...order, items: [{ name: "Sample", variant: null, quantity: 1, unit_price_inr: 0 }] };
    expect(() => buildPaymentRequest(free)).toThrow(PaymentError);
  });
});

describe("SimulatedProvider", () => {
  it("creates links on the reserved pay.example domain and lists them newest first", async () => {
    const provider = new SimulatedProvider();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const first = await provider.create(buildPaymentRequest(order));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    const second = await provider.create(buildPaymentRequest(order));

    expect(first).toMatchObject({ status: "created", amount: 1947, amountPaid: 0, customerName: "Neha Verma" });
    expect(first.shortUrl).toMatch(/^https:\/\/pay\.example\/[a-z0-9]{10}$/);
    expect((await provider.list()).map((r) => r.id)).toEqual([second.id, first.id]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("pluggable provider", () => {
  const original = paymentProvider();
  afterEach(() => setPaymentProvider(original));

  it("sends the validated request to whichever provider is plugged in", async () => {
    const received: PaymentRequest[] = [];
    const row: OrderRow = {
      id: "gw_1",
      shortUrl: "https://gateway.example/gw_1",
      status: "created",
      amount: 1947,
      amountPaid: 0,
      createdAt: 1,
      customerName: "Neha Verma",
      customerPhone: "+919876543210",
      items: "2× Blue cotton kurti (M), 1× Printed dupatta",
      language: "Hinglish",
    };
    const gateway: PaymentLinkProvider = {
      mode: "test",
      create: async (request) => {
        received.push(request);
        return row;
      },
      list: async () => [row],
    };
    setPaymentProvider(gateway);

    await expect(createPaymentLink(order)).resolves.toBe(row);
    expect(received[0].amountMinor).toBe(194_700);
    await expect(listOrders()).resolves.toEqual([row]);
  });
});
