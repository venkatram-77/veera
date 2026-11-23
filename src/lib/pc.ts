import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

const APP_TARGETS: Record<string, string> = {
  notepad: "notepad.exe",
  texteditor: "notepad.exe",
  calculator: "calc.exe",
  calc: "calc.exe",
  explorer: "explorer.exe",
  files: "explorer.exe",
  filemanager: "explorer.exe",
  chrome: "chrome.exe",
  googlechrome: "chrome.exe",
  edge: "msedge.exe",
  msedge: "msedge.exe",
  vscode: "code.cmd",
  code: "code.cmd",
  spotify: "spotify.exe",
  word: "winword.exe",
  excel: "excel.exe",
  powerpoint: "powerpnt.exe",
  outlook: "outlook.exe",
  teams: "ms-teams.exe",
  settings: "ms-settings:",
  store: "ms-windows-store:",
  taskmanager: "taskmgr.exe",
  photos: "ms-photos:",
  camera: "microsoft.windows.camera:",
  terminal: "wt.exe",
  cmd: "cmd.exe",
  powershell: "powershell.exe",
};

const psQuote = (value: string) => value.replace(/'/g, "''");

function runPowerShell(command: string, timeout = 20_000): string {
  return execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
    timeout,
    encoding: "utf8",
  });
}

export function openApp(requested: string): string {
  if (!config.pcControlEnabled) {
    return "PC control is disabled. Set ENABLE_PC_CONTROL=true to enable it.";
  }
  const key = requested.trim().toLowerCase().replace(/\s+/g, "");
  const target =
    APP_TARGETS[key] ??
    (/^[a-z0-9_.-]+\.exe$/.test(key) || /^ms-[a-z0-9-]+:$/.test(key) ? key : null);

  if (!target) {
    return `I don't have a launcher for "${requested}". Available apps: ${Object.keys(
      APP_TARGETS,
    )
      .filter((name, index, list) => list.indexOf(name) === index)
      .slice(0, 24)
      .join(", ")}.`;
  }

  try {
    runPowerShell(`Start-Process -FilePath '${psQuote(target)}'`);
    return `Opened \`${target}\`.`;
  } catch (error) {
    return `Could not open ${target}: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

export function openUrl(url: string): string {
  if (!config.pcControlEnabled) {
    return "PC control is disabled. Set ENABLE_PC_CONTROL=true to enable it.";
  }
  if (!/^https?:\/\/[^\s]+$/i.test(url)) {
    return "Please provide a valid http:// or https:// URL.";
  }
  try {
    runPowerShell(`Start-Process '${psQuote(url)}'`);
    return `Opened ${url} in your browser.`;
  } catch (error) {
    return `Could not open the URL: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

export function setVolume(level: unknown): string {
  if (!config.pcControlEnabled) {
    return "PC control is disabled. Set ENABLE_PC_CONTROL=true to enable it.";
  }

  const command = String(level ?? "").trim().toLowerCase();
  const script: string = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VeeraVolumeKeys {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void Tap(byte key) {
    keybd_event(key, 0, 0, UIntPtr.Zero);
    keybd_event(key, 0, 2, UIntPtr.Zero);
  }
}
'@
function Tap-Times([byte]$key, [int]$count) {
  for ($i = 0; $i -lt $count; $i++) {
    [VeeraVolumeKeys]::Tap($key)
    Start-Sleep -Milliseconds 8
  }
}
`;

  try {
    if (command === "mute" || command === "unmute") {
      runPowerShell(`${script}\n[VeeraVolumeKeys]::Tap(0xAD)`);
      return command === "mute" ? "System audio muted." : "Audio mute toggled.";
    }

    const value = Number(command);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return "Volume must be a number from 0 to 100, or the word mute.";
    }
    const target = Math.round(value);
    // Normalize to 0 first, then step up. Windows changes volume in ~2% steps.
    runPowerShell(
      `${script}\nTap-Times -key 0xAE -count 50\nTap-Times -key 0xAF -count ${Math.floor(
        target / 2,
      )}`,
    );
    return `System volume set to about ${target}%.`;
  } catch (error) {
    return `Volume control failed: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

export function screenshot(): string {
  if (!config.screenshotEnabled) {
    return "Screenshots are disabled. Set ENABLE_SCREENSHOT=true to enable them.";
  }
  try {
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const file = `screenshot_${Date.now()}.png`;
    const target = path.join(config.uploadDir, file);
    const ps = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${psQuote(
      target,
    )}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()`;
    runPowerShell(ps);
    return `![Screenshot](/api/files/${file})\n\nSaved to \`${target}\``;
  } catch (error) {
    return `Screenshot failed: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}
