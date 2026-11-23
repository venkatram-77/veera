import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { deleteDocument } from "@/lib/rag";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const deleted = deleteDocument(user.id, id);
  return NextResponse.json({ ok: deleted }, { status: deleted ? 200 : 404 });
}
