import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";
import { POST as login } from "@/app/api/login/route";
import { POST as createLink } from "@/app/api/links/route";
import { POST as extract } from "@/app/api/extract/route";

const validOrder = {
  customer_name: "Neha Verma",
  customer_phone: "98765 43210",
  customer_email: null,
  customer_language: "Hinglish",
  items: [{ name: "Blue cotton kurti", variant: "M", quantity: 2, unit_price_inr: 799 }],
  shipping_address: "Kothrud, Pune",
  pincode: "411038",
  delivery_charge_inr: 0,
  discount_inr: 0,
};

async function post(path: string, body: unknown, signedIn = true) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signedIn) headers.cookie = `${SESSION_COOKIE}=${await sessionToken()}`;
  return new Request(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.stubEnv("APP_PASSWORD", "correct horse battery staple");
  vi.stubEnv("RAZORPAY_KEY_ID", "");
  vi.stubEnv("RAZORPAY_KEY_SECRET", "");
});

describe("POST /api/login", () => {
  it("sets an httpOnly session cookie for the right password", async () => {
    const res = await login(await post("/api/login", { password: "correct horse battery staple" }, false));
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
  });

  it("rejects a wrong password", async () => {
    const res = await login(await post("/api/login", { password: "nope" }, false));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST /api/links", () => {
  it("requires a session", async () => {
    const res = await createLink(await post("/api/links", validOrder, false));
    expect(res.status).toBe(401);
  });

  it("names the invalid field", async () => {
    const bad = { ...validOrder, items: [{ ...validOrder.items[0], quantity: 0 }] };
    const res = await createLink(await post("/api/links", bad));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^items\.0\.quantity/);
  });

  it("creates a link and charges the server-side total", async () => {
    const res = await createLink(await post("/api/links", { ...validOrder, delivery_charge_inr: 60 }));
    expect(res.status).toBe(200);
    const { order } = await res.json();
    expect(order.amount).toBe(1658);
    expect(order.items).toBe("2× Blue cotton kurti (M)");
  });
});

describe("POST /api/extract", () => {
  it("requires a session", async () => {
    const res = await extract(await post("/api/extract", { chat: "hi" }, false));
    expect(res.status).toBe(401);
  });

  it("rejects an empty chat before calling the model", async () => {
    const res = await extract(await post("/api/extract", { chat: "   " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Paste a chat first.");
  });
});
