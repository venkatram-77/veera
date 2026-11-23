import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

let ttsAvailable: boolean | null = null;

export function edgeTtsAvailable(): boolean {
  if (ttsAvailable !== null) return ttsAvailable;
  if (!config.ttsEnabled) {
    ttsAvailable = false;
    return ttsAvailable;
  }
  try {
    execFileSync(config.pythonCommand, ["-m", "edge_tts", "--version"], {
      timeout: 15_000,
      stdio: "ignore",
    });
    ttsAvailable = true;
  } catch {
    ttsAvailable = false;
  }
  return ttsAvailable;
}

/** Strip Markdown syntax so spoken replies sound natural. */
export function toPlainSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code snippet ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

export type SpeechResult = { url: string; file: string };

/** Generate an MP3 with edge-tts (Microsoft's neural voices, no GPU needed). */
export function generateSpeech(text: string): SpeechResult {
  if (!config.ttsEnabled) {
    throw new Error("Neural voice is disabled. Set ENABLE_TTS=true to turn it on.");
  }
  if (!edgeTtsAvailable()) {
    throw new Error("edge-tts is not installed. Run: python -m pip install edge-tts");
  }

  const speech = toPlainSpeech(text);
  if (!speech) throw new Error("There is nothing to speak.");

  fs.mkdirSync(config.uploadDir, { recursive: true });
  const file = `speech_${Date.now()}.mp3`;
  const target = path.join(config.uploadDir, file);
  execFileSync(
    config.pythonCommand,
    ["-m", "edge_tts", "--voice", config.ttsVoice, "--text", speech, "--write-media", target],
    { timeout: 90_000, stdio: "ignore" },
  );
  if (!fs.existsSync(target) || fs.statSync(target).size < 1000) {
    throw new Error("the voice service returned an empty audio file");
  }
  return { url: `/api/files/${file}`, file: target };
}

/** Tool-friendly wrapper: returns a Markdown link to the generated audio. */
export function synthesizeSpeech(text: string): string {
  try {
    const { url, file } = generateSpeech(text);
    return `🔊 [Play voice reply](${url})\n\nSaved to \`${file}\``;
  } catch (error) {
    return `Speech generation failed: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}
