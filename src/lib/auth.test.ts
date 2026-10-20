import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_COOKIE,
  checkPassword,
  isAuthConfigured,
  isValidSession,
  requireSession,
  sessionToken,
} from "@/lib/auth";

describe("auth", () => {
  beforeEach(() => {
    vi.stubEnv("APP_PASSWORD", "correct horse battery staple");
  });

  it("accepts only the configured password", async () => {
    expect(await checkPassword("correct horse battery staple")).toBe(true);
    expect(await checkPassword("correct horse")).toBe(false);
    expect(await checkPassword("")).toBe(false);
  });

  it("issues a session token that verifies", async () => {
    const token = await sessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await isValidSession(token!)).toBe(true);
    expect(await isValidSession("not-a-token")).toBe(false);
    expect(await isValidSession(undefined)).toBe(false);
  });

  it("signs everyone out when the password changes", async () => {
    const token = await sessionToken();
    vi.stubEnv("APP_PASSWORD", "a different password");
    expect(await isValidSession(token!)).toBe(false);
  });

  it("refuses all access when no password is configured", async () => {
    vi.stubEnv("APP_PASSWORD", "");
    expect(isAuthConfigured()).toBe(false);
    expect(await sessionToken()).toBeNull();
    expect(await checkPassword("")).toBe(false);
  });

  describe("requireSession", () => {
    it("lets a request with a valid session cookie through", async () => {
      const token = await sessionToken();
      const request = new Request("http://localhost/api/links", {
        headers: { cookie: `theme=dark; ${SESSION_COOKIE}=${token}` },
      });
      expect(await requireSession(request)).toBeNull();
    });

    it("returns 401 without a session cookie", async () => {
      const response = await requireSession(new Request("http://localhost/api/links"));
      expect(response?.status).toBe(401);
      expect(await response?.json()).toEqual({ error: "Not signed in" });
    });
  });
});
