import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { readOrder } from "@/lib/parser";

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

  const { chat, shopName, catalog, policies } = parsed.data;
  return Response.json({ order: readOrder(chat, { name: shopName, catalog, policies }) });
}
