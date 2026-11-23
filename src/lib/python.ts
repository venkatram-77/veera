import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

const MAX_DISPLAY = 8000;

function display(value: string): string {
  const text = value.replace(/\r\n/g, "\n").trim();
  return text.length > MAX_DISPLAY ? `${text.slice(0, MAX_DISPLAY)}\n… (output truncated)` : text;
}

export function runPython(code: string, filename?: string): string {
  if (!config.codeExecutionEnabled) {
    return "Code execution is disabled. Set ENABLE_CODE_EXECUTION=true to enable it.";
  }
  const source = code.replace(/\r\n/g, "\n").trim();
  if (!source) return "No Python code was provided.";
  if (source.length > 50_000) return "The script is too long (50,000 character limit).";

  try {
    fs.mkdirSync(config.scriptDir, { recursive: true });
    const safe = String(filename ?? "veera_script")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 48) || "veera_script";
    const file = path.join(config.scriptDir, `${safe}_${Date.now()}.py`);
    fs.writeFileSync(file, source, "utf8");

    const stdout = execFileSync(config.pythonCommand, [file], {
      cwd: config.scriptDir,
      timeout: config.codeTimeoutMs,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    return `Ran \`${path.basename(file)}\` successfully.\n\n**Output:**\n\`\`\`\n${
      display(stdout) || "(no output)"
    }\n\`\`\``;
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      status?: number | null;
      signal?: string | null;
      message?: string;
    };
    const reason = failure.signal
      ? `timed out after ${config.codeTimeoutMs}ms`
      : `exit code ${failure.status ?? "unknown"}`;
    const stdout = display(failure.stdout ?? "");
    const stderr = display(failure.stderr ?? "");
    const parts = [`Script failed (${reason}).`];
    if (stdout) parts.push(`**Output before the error:**\n\`\`\`\n${stdout}\n\`\`\``);
    if (stderr) parts.push(`**Error:**\n\`\`\`\n${stderr}\n\`\`\``);
    if (!stdout && !stderr) parts.push(failure.message ?? "Unknown failure.");
    parts.push(`Script saved at \`${config.scriptDir}\` so it can be corrected and rerun.`);
    return parts.join("\n\n");
  }
}
