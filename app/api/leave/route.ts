import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { id }. Removes the presence row and any pending
// signals to/from this user. Called via navigator.sendBeacon on tab close, so
// the body may arrive as text — parse defensively.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    // Ignore parse errors
  }

  const { id, secret } = body;

  if (typeof id === "string" && typeof secret === "string") {
    // Only delete if the secret matches
    const deleted = await prisma.presence.deleteMany({ where: { id, secret } });
    if (deleted.count > 0) {
      await prisma.signal.deleteMany({
        where: { OR: [{ toId: id }, { fromId: id }] },
      });
    }
  }

  return Response.json({ ok: true });
}
