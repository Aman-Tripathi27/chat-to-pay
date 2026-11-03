import { describe, expect, it } from "vitest";
import { FIXTURES, SHOP } from "./fixtures";
import { readOrder } from "./index";

describe(`reads ${FIXTURES.length} sample chats correctly`, () => {
  it.each(FIXTURES)("$name", (f) => {
    const order = readOrder(f.chat, f.shop ?? SHOP);

    expect(order.items.map((i) => [i.name, i.variant, i.quantity, i.unit_price_inr])).toEqual(f.items);
    expect(order.delivery_charge_inr).toBe(f.delivery);
    expect(order.discount_inr).toBe(f.discount ?? 0);
    if (f.customerName !== undefined) expect(order.customer_name).toBe(f.customerName);
    if (f.phone !== undefined) expect(order.customer_phone?.replace(/\D/g, "").slice(-10) ?? null).toBe(f.phone);
    if (f.pincode !== undefined) expect(order.pincode).toBe(f.pincode);
    if (f.address !== undefined) expect(order.shipping_address).toBe(f.address);
    if (f.language) expect(order.customer_language).toBe(f.language);

    if (f.missing) {
      for (const note of f.missing) expect(order.missing_info.join("\n")).toContain(note);
    } else {
      expect(order.missing_info).toEqual([]);
    }
    for (const text of f.reply ?? []) expect(order.reply_template).toContain(text);
    for (const text of f.question ?? []) expect(order.clarifying_question ?? "").toContain(text);

    // Every reply must carry the placeholders the app fills in.
    for (const placeholder of ["{{ITEMS}}", "{{TOTAL}}", "{{LINK}}"])
      expect(order.reply_template).toContain(placeholder);
  });
});
