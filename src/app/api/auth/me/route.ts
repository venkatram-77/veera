import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { config } from "@/lib/config";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ user: await getSessionUser(), authEnabled: config.authEnabled });
}
