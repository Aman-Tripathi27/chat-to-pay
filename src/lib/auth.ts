// Single-seller password gate. The session cookie holds an HMAC derived from
// APP_PASSWORD, so changing the password signs everyone out.
// Uses Web Crypto so it runs in both the proxy and route handlers.

export const SESSION_COOKIE = "ctp_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const encoder = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAuthConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export async function sessionToken(): Promise<string | null> {
  const password = process.env.APP_PASSWORD;
  if (!password) return null;
  return hmacHex(password, "chat-to-pay-session-v1");
}

export async function checkPassword(candidate: string): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password) return false;
  // Compare digests so the comparison length doesn't leak the password length.
  const [a, b] = await Promise.all([
    hmacHex("chat-to-pay-login", candidate),
    hmacHex("chat-to-pay-login", password),
  ]);
  return constantTimeEqual(a, b);
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const expected = await sessionToken();
  return expected !== null && constantTimeEqual(cookieValue, expected);
}

/** For route handlers: returns a 401 Response when the request isn't signed in. */
export async function requireSession(request: Request): Promise<Response | null> {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (await isValidSession(cookie)) return null;
  return Response.json({ error: "Not signed in" }, { status: 401 });
}
