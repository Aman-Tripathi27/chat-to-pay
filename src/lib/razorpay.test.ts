import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateLinkInput } from "@/lib/order";
import { RazorpayError, buildPaymentLinkRequest, createPaymentLink, listOrders, razorpayMode } from "@/lib/razorpay";

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function useTestKeys() {
  vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_abc123");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "s3cret");
}

describe("razorpayMode", () => {
  it.each([
    ["", "", "demo"],
    ["rzp_test_abc", "", "demo"],
    ["rzp_test_abc", "secret", "test"],
    ["rzp_live_abc", "secret", "live"],
  ])("key %j with secret %j → %s", (id, secret, mode) => {
    vi.stubEnv("RAZORPAY_KEY_ID", id);
    vi.stubEnv("RAZORPAY_KEY_SECRET", secret);
    expect(razorpayMode()).toBe(mode);
  });
});

describe("buildPaymentLinkRequest", () => {
  it("charges the server-computed total in paise", () => {
    const body = buildPaymentLinkRequest(order);
    expect(body.amount).toBe(194_700);
    expect(body.currency).toBe("INR");
    expect(body.accept_partial).toBe(false);
  });

  it("tags the link so the dashboard can find it", () => {
    const { notes } = buildPaymentLinkRequest(order);
    expect(notes).toMatchObject({
      source: "chat-to-pay",
      items: "2× Blue cotton kurti (M), 1× Printed dupatta",
      pincode: "411038",
      phone: "+919876543210",
      lang: "Hinglish",
    });
  });

  it("keeps every note within Razorpay's 256-character limit", () => {
    const { notes } = buildPaymentLinkRequest({ ...order, shipping_address: "A".repeat(500) });
    expect(Object.keys(notes).length).toBeLessThanOrEqual(15);
    for (const value of Object.values(notes)) expect(value.length).toBeLessThanOrEqual(256);
  });

  it("sends a normalised customer and drops an invalid email", () => {
    expect(buildPaymentLinkRequest(order).customer).toEqual({
      name: "Neha Verma",
      contact: "+919876543210",
      email: "neha@example.com",
    });
    expect(buildPaymentLinkRequest({ ...order, customer_email: "not-an-email" }).customer).not.toHaveProperty("email");
  });

  it("uses a unique reference id within Razorpay's 40-character limit", () => {
    const a = buildPaymentLinkRequest(order).reference_id;
    const b = buildPaymentLinkRequest(order).reference_id;
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(40);
  });

  it("expires the link in 7 days, inside Razorpay's allowed window", () => {
    const now = Math.floor(Date.now() / 1000);
    const { expire_by } = buildPaymentLinkRequest(order);
    expect(expire_by - now).toBeGreaterThanOrEqual(7 * 24 * 3600 - 5);
    expect(expire_by - now).toBeLessThan(180 * 24 * 3600);
  });

  it("leaves notifying the customer to the seller", () => {
    const body = buildPaymentLinkRequest(order);
    expect(body.notify).toEqual({ sms: false, email: false });
    expect(body.reminder_enable).toBe(false);
  });

  it("refuses totals under ₹1", () => {
    const free = { ...order, items: [{ name: "Sample", variant: null, quantity: 1, unit_price_inr: 0 }] };
    expect(() => buildPaymentLinkRequest(free)).toThrow(RazorpayError);
  });
});

describe("createPaymentLink against the Razorpay API", () => {
  beforeEach(useTestKeys);

  it("posts the link with basic auth and maps the response", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "plink_Exjp",
        short_url: "https://rzp.io/i/nxrHnLJ",
        status: "created",
        amount: 194_700,
        amount_paid: 0,
        created_at: 1_790_000_000,
        customer: { name: "Neha Verma", contact: "+919876543210" },
        notes: { source: "chat-to-pay", items: "2× Blue cotton kurti (M)", lang: "Hinglish" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const row = await createPaymentLink(order);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.razorpay.com/v1/payment_links/");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("rzp_test_abc123:s3cret").toString("base64")}`,
    );
    expect(JSON.parse(init.body as string).amount).toBe(194_700);
    expect(row).toMatchObject({
      id: "plink_Exjp",
      shortUrl: "https://rzp.io/i/nxrHnLJ",
      amount: 1947,
      status: "created",
    });
  });

  it("explains rejected API keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { description: "Authentication failed" } }, 401)),
    );
    await expect(createPaymentLink(order)).rejects.toThrow(/rejected the API keys/);
  });

  it("passes Razorpay's validation message through", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { description: "The contact format is invalid" } }, 400)),
    );
    await expect(createPaymentLink(order)).rejects.toMatchObject({
      message: "Razorpay: The contact format is invalid",
      status: 400,
    });
  });
});

describe("listOrders against the Razorpay API", () => {
  beforeEach(useTestKeys);

  const link = (id: string, created_at: number, notes: unknown) => ({
    id,
    short_url: `https://rzp.io/i/${id}`,
    status: "paid",
    amount: 10_000,
    amount_paid: 10_000,
    created_at,
    customer: null,
    notes,
  });

  it("returns only this app's links, newest first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          payment_links: [
            link("plink_old", 100, { source: "chat-to-pay", items: "1× A" }),
            link("plink_other_app", 300, { source: "invoices" }),
            link("plink_no_notes", 400, []),
            link("plink_new", 200, { source: "chat-to-pay", items: "1× B" }),
          ],
        }),
      ),
    );

    const rows = await listOrders();
    expect(rows.map((r) => r.id)).toEqual(["plink_new", "plink_old"]);
    expect(rows[0]).toMatchObject({ amount: 100, amountPaid: 100, items: "1× B" });
  });

  it("retries without the page-size parameter if Razorpay rejects it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { description: "count is not required" } }, 400))
      .mockResolvedValueOnce(jsonResponse({ payment_links: [] }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await listOrders()).toEqual([]);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "https://api.razorpay.com/v1/payment_links/?count=100",
      "https://api.razorpay.com/v1/payment_links/",
    ]);
  });
});

describe("demo mode (no API keys)", () => {
  beforeEach(() => {
    vi.stubEnv("RAZORPAY_KEY_ID", "");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "");
  });

  it("creates links on a reserved domain and never calls Razorpay", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const row = await createPaymentLink(order);
    expect(row.shortUrl).toMatch(/^https:\/\/demo-link\.invalid\/plink_demo_/);
    expect(row.amount).toBe(1947);
    expect((await listOrders()).some((r) => r.id === row.id)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
