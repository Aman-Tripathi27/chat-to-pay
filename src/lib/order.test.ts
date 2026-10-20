import { describe, expect, it } from "vitest";
import {
  CreateLinkSchema,
  ExtractedOrderSchema,
  fillReply,
  formatINR,
  itemsSummary,
  normalizePhone,
  orderTotal,
  whatsappLink,
} from "@/lib/order";

describe("orderTotal", () => {
  it("adds line items and delivery, then subtracts the discount", () => {
    const total = orderTotal({
      items: [
        { quantity: 2, unit_price_inr: 799 },
        { quantity: 1, unit_price_inr: 349 },
      ],
      delivery_charge_inr: 60,
      discount_inr: 100,
    });
    expect(total).toBe(1907);
  });

  it("treats unknown prices and missing charges as zero", () => {
    expect(
      orderTotal({ items: [{ quantity: 3, unit_price_inr: null }], delivery_charge_inr: null, discount_inr: null }),
    ).toBe(0);
  });

  it("never goes below zero", () => {
    expect(
      orderTotal({ items: [{ quantity: 1, unit_price_inr: 100 }], delivery_charge_inr: 0, discount_inr: 5000 }),
    ).toBe(0);
  });

  it("rounds to the nearest paisa", () => {
    expect(
      orderTotal({ items: [{ quantity: 3, unit_price_inr: 33.333 }], delivery_charge_inr: 0, discount_inr: 0 }),
    ).toBe(100);
  });
});

describe("normalizePhone", () => {
  it.each([
    ["98765 43210", "+919876543210"],
    ["098765-43210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["+44 7700 900123", "+447700900123"],
  ])("normalises %s", (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each([null, "", "12345", "55555 55555"])("rejects %s", (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });
});

describe("whatsappLink", () => {
  it("targets the customer's number and URL-encodes the message", () => {
    expect(whatsappLink("98765 43210", "Total ₹1,947")).toBe(
      "https://wa.me/919876543210?text=Total%20%E2%82%B91%2C947",
    );
  });

  it("falls back to WhatsApp's contact picker without a valid number", () => {
    expect(whatsappLink(null, "Hi")).toBe("https://wa.me/?text=Hi");
  });
});

describe("fillReply", () => {
  it("replaces every placeholder", () => {
    const reply = fillReply("Order: {{ITEMS}}. Total {{TOTAL}}. Pay: {{LINK}}", {
      items: "2× Kurti (M)",
      total: "₹1,598",
      link: "https://rzp.io/i/abc",
    });
    expect(reply).toBe("Order: 2× Kurti (M). Total ₹1,598. Pay: https://rzp.io/i/abc");
  });

  it("leaves text without placeholders unchanged", () => {
    expect(fillReply("Thank you!", { items: "x", total: "y", link: "z" })).toBe("Thank you!");
  });
});

describe("itemsSummary", () => {
  it("lists quantity, name and variant", () => {
    expect(
      itemsSummary([
        { name: "Blue kurti", variant: "M", quantity: 2 },
        { name: "Dupatta", variant: null, quantity: 1 },
      ]),
    ).toBe("2× Blue kurti (M), 1× Dupatta");
  });
});

describe("formatINR", () => {
  it("uses Indian digit grouping", () => {
    expect(formatINR(150000)).toBe("₹1,50,000");
  });

  it("shows paise only when present", () => {
    expect(formatINR(1947)).toBe("₹1,947");
    expect(formatINR(99.5)).toBe("₹99.50");
  });
});

describe("CreateLinkSchema", () => {
  const valid = {
    customer_name: "Neha Verma",
    customer_phone: "98765 43210",
    customer_email: null,
    customer_language: "Hinglish",
    items: [{ name: "Blue kurti", variant: "M", quantity: 2, unit_price_inr: 799 }],
    shipping_address: "Kothrud, Pune",
    pincode: "411038",
    delivery_charge_inr: 0,
    discount_inr: 0,
  };

  it("accepts a complete order", () => {
    expect(CreateLinkSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["no items", { items: [] }],
    ["zero quantity", { items: [{ ...valid.items[0], quantity: 0 }] }],
    ["negative price", { items: [{ ...valid.items[0], unit_price_inr: -1 }] }],
    ["negative delivery", { delivery_charge_inr: -10 }],
  ])("rejects %s", (_, patch) => {
    expect(CreateLinkSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe("ExtractedOrderSchema", () => {
  const extracted = {
    customer_name: "Neha Verma",
    customer_phone: "98765 43210",
    customer_email: null,
    customer_language: "Hinglish",
    items: [{ name: "Blue kurti", variant: "M", quantity: 2, unit_price_inr: 799, price_source: "catalog" }],
    shipping_address: null,
    pincode: null,
    delivery_charge_inr: 0,
    discount_inr: null,
    missing_info: ["Address missing"],
    clarifying_question: "Address bhej dijiye?",
    reply_template: "{{ITEMS}} {{TOTAL}} {{LINK}}",
    seller_summary: "2 kurtis for Neha",
  };

  it("accepts the shape the model is asked for", () => {
    expect(ExtractedOrderSchema.safeParse(extracted).success).toBe(true);
  });

  it("rejects an unknown price source", () => {
    const bad = { ...extracted, items: [{ ...extracted.items[0], price_source: "guess" }] };
    expect(ExtractedOrderSchema.safeParse(bad).success).toBe(false);
  });
});
