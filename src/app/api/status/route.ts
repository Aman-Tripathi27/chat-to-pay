import { connection } from "next/server";
import { requireSession } from "@/lib/auth";
import { razorpayMode } from "@/lib/razorpay";

// Tells the UI which mode it's in, without exposing any secrets.
export async function GET(request: Request) {
  await connection();
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  return Response.json({
    razorpay: razorpayMode(),
    claudeConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  });
}
