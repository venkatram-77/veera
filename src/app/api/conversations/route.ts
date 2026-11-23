import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createConversation, listConversations } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ conversations: listConversations(user.id) });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { title?: string };
  const conversation = createConversation(user.id, body.title?.trim() || "New chat");
  return NextResponse.json({ conversation }, { status: 201 });
}
