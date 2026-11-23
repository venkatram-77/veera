import { NextResponse } from "next/server";
import { classifierAvailable } from "@/lib/classifier";
import { config } from "@/lib/config";
import { modelStatus } from "@/lib/ollama";
import { listDocuments } from "@/lib/rag";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  const status = await modelStatus();
  const documents = user ? listDocuments(user.id).length : 0;
  return NextResponse.json({
    ok: status.online,
    ollama: status,
    classifier: classifierAvailable(),
    rag: documents,
    authEnabled: config.authEnabled,
    timestamp: new Date().toISOString(),
  });
}
