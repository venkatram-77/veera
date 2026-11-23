import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { generateSpeech } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await getSessionUser())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: "Text is required" }, { status: 400 });

  try {
    return NextResponse.json(generateSpeech(text));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Speech generation failed" },
      { status: 500 },
    );
  }
}
