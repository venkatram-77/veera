import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }
  const file = path.join(config.uploadDir, name);
  if (!fs.existsSync(file)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const bytes = fs.readFileSync(file);
  const extension = path.extname(name).toLowerCase();
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp3": "audio/mpeg",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  const inline = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp3"].includes(extension);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": types[extension] ?? "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
    },
  });
}
