import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { ExtractError, extractOrder } from "@/lib/extract";

export const maxDuration = 60;

const BodySchema = z.object({
  chat: z.string().trim().min(1, "Paste a chat first.").max(20_000, "That chat is too long (20,000 characters max)."),
  shopName: z.string().max(80).default(""),
  catalog: z.string().max(10_000).default(""),
  policies: z.string().max(2_000).default(""),
});

export async function POST(request: Request) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  try {
    const order = await extractOrder(parsed.data);
    return Response.json({ order });
  } catch (error) {
    if (error instanceof ExtractError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("extract failed", error);
    return Response.json({ error: "Something went wrong reading the chat." }, { status: 500 });
  }
}
