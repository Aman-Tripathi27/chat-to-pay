import { connection } from "next/server";
import { requireSession } from "@/lib/auth";
import { CreateLinkSchema } from "@/lib/order";
import { RazorpayError, createPaymentLink, listOrders } from "@/lib/razorpay";

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof RazorpayError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}

export async function GET(request: Request) {
  await connection();
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  try {
    return Response.json({ orders: await listOrders() });
  } catch (error) {
    return errorResponse(error, "Couldn't load orders from Razorpay.");
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const parsed = CreateLinkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json(
      { error: issue ? `${issue.path.join(".")}: ${issue.message}` : "Invalid order" },
      { status: 400 },
    );
  }

  try {
    return Response.json({ order: await createPaymentLink(parsed.data) });
  } catch (error) {
    return errorResponse(error, "Couldn't create the payment link.");
  }
}
