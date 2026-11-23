import { NextResponse } from "next/server";
import { findUserByEmail, setSessionCookie, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase() ?? "";
  const user = findUserByEmail(email);
  if (!user || !user.password_hash || !verifyPassword(body.password ?? "", user.password_hash)) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  await setSessionCookie(user);
  return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
}
