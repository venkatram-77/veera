import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { z } from "zod";
import { config } from "./config";
import { analyzeSentiment, classifierAvailable } from "./classifier";
import { createDocument } from "./documents";
import { db } from "./db";
import type { ToolDefinition } from "./ollama";
import { openApp, openUrl, screenshot, setVolume } from "./pc";
import { runPython } from "./python";
import { synthesizeSpeech } from "./voice";

// Some networks here resolve IPv6 first, which breaks outbound fetches.
dns.setDefaultResultOrder?.("ipv4first");

export type ToolExecution = {
  name: string;
  content: string;
};

type Tool = {
  definition: ToolDefinition;
  run: (args: Record<string, unknown>, userId: string) => Promise<string> | string;
};

const str = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : value == null ? fallback : String(value);

function calculate(expression: string): string {
  const clean = expression.replace(/[^0-9+\-*/^().\s]/g, "");
  if (!clean.trim()) return "I couldn't find a valid arithmetic expression.";
  let position = 0;

  const skip = () => {
    while (position < clean.length && /\s/.test(clean[position])) position += 1;
  };
  const peek = () => clean[position];

  function parseExpression(): number {
    let value = parseTerm();
    while (true) {
      skip();
      const op = peek();
      if (op !== "+" && op !== "-") break;
      position += 1;
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parsePower();
    while (true) {
      skip();
      const op = peek();
      if (op !== "*" && op !== "/" ) break;
      position += 1;
      const right = parsePower();
      if (op === "/" && right === 0) throw new Error("division by zero");
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }

  function parsePower(): number {
    const base = parseAtom();
    skip();
    if (peek() === "^") {
      position += 1;
      return Math.pow(base, parsePower());
    }
    return base;
  }

  function parseAtom(): number {
    skip();
    if (peek() === "(") {
      position += 1;
      const value = parseExpression();
      skip();
      if (peek() === ")") position += 1;
      return value;
    }
    if (peek() === "-") {
      position += 1;
      return -parseAtom();
    }
    const match = /^(?:\d+\.?\d*|\.\d+)/.exec(clean.slice(position));
    if (!match) throw new Error("invalid number");
    position += match[0].length;
    return Number(match[0]);
  }

  try {
    const result = parseExpression();
    if (!Number.isFinite(result)) return "The calculation produced an invalid number.";
    return `${clean.trim()} = ${Number(result.toPrecision(12))}`;
  } catch (error) {
    return `Calculation failed: ${error instanceof Error ? error.message : "invalid expression"}`;
  }
}

async function webSearch(query: string): Promise<string> {
  try {
    const { search } = await import("duck-duck-scrape");
    const results = await search(query, { locale: "en-us" });
    if (!results.results.length) return `No DuckDuckGo results found for "${query}".`;
    return results.results
      .slice(0, 5)
      .map(
        (item, index) =>
          `${index + 1}. [${item.title}](${item.url})\n   ${item.description.replace(/<[^>]+>/g, "")}`,
      )
      .join("\n");
  } catch (error) {
    const q = encodeURIComponent(query);
    return `Live search is unavailable (${error instanceof Error ? error.message : "network error"}). Search links:\n- https://duckduckgo.com/?q=${q}\n- https://www.google.com/search?q=${q}`;
  }
}

async function wikipedia(subject: string): Promise<string> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(subject.replace(/ /g, "_"))}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Veera/1.0 (local assistant)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return `Wikipedia has no summary for "${subject}".`;
    const data = (await response.json()) as {
      title?: string;
      extract?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    if (!data.extract) return `Wikipedia has no summary for "${subject}".`;
    return `**${data.title ?? subject}**\n\n${data.extract}\n\n${
      data.content_urls?.desktop?.page ?? ""
    }`;
  } catch (error) {
    return `Wikipedia lookup failed: ${error instanceof Error ? error.message : "network error"}`;
  }
}

async function weather(city: string): Promise<string> {
  try {
    const geoResponse = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
      { signal: AbortSignal.timeout(12000) },
    );
    const geo = (await geoResponse.json()) as {
      results?: { latitude: number; longitude: number; name: string }[];
    };
    const place = geo.results?.[0];
    if (!place) return `I couldn't find a city named "${city}".`;

    const forecastResponse = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`,
      { signal: AbortSignal.timeout(12000) },
    );
    const data = (await forecastResponse.json()) as {
      current?: {
        temperature_2m: number;
        relative_humidity_2m: number;
        apparent_temperature: number;
        weather_code: number;
        wind_speed_10m: number;
      };
    };
    const current = data.current;
    if (!current) return `Weather data is unavailable for ${place.name}.`;
    const codes: Record<number, string> = {
      0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Fog", 51: "Light drizzle", 61: "Rain", 63: "Heavy rain",
      71: "Snow", 80: "Rain showers", 95: "Thunderstorm",
    };
    return `**Weather in ${place.name}**\n- ${codes[current.weather_code] ?? "Mixed conditions"}\n- Temperature: ${current.temperature_2m}°C (feels like ${current.apparent_temperature}°C)\n- Humidity: ${current.relative_humidity_2m}%\n- Wind: ${current.wind_speed_10m} km/h`;
  } catch (error) {
    return `Weather lookup failed: ${error instanceof Error ? error.message : "network error"}`;
  }
}

async function pcStatus(kind: string): Promise<string> {
  try {
    const si = await import("systeminformation");
    const os = await import("node:os");
    const lines: string[] = [];
    if (kind === "battery") {
      const battery = await si.battery();
      if (!battery || battery.percent == null) return "This PC doesn't report a battery.";
      const state = battery.isCharging ? "charging" : battery.acConnected ? "plugged in" : "on battery";
      return `Battery: **${Math.round(battery.percent)}%** (${state})`;
    }
    if (kind === "cpu" || kind === "status") {
      const cpu = await si.currentLoad();
      lines.push(`CPU usage: **${cpu.currentLoad.toFixed(1)}%** on ${os.cpus().length} threads`);
    }
    if (kind === "ram" || kind === "memory" || kind === "status") {
      const mem = await si.mem();
      lines.push(
        `RAM: **${Math.round((mem.used / mem.total) * 100)}%** used (${(mem.used / 1e9).toFixed(1)} / ${(mem.total / 1e9).toFixed(1)} GB)`,
      );
    }
    if (kind === "disk" || kind === "status") {
      const disk = await si.fsSize();
      const drive = disk.find((item) => item.mount === "C:") ?? disk[0];
      if (drive) {
        lines.push(
          `Disk ${drive.mount}: **${Math.round(drive.use)}%** used (${(drive.available / 1e9).toFixed(1)} GB free)`,
        );
      }
    }
    return lines.join("\n") || "No PC status available.";
  } catch (error) {
    return `PC status failed: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

async function generateImage(prompt: string): Promise<string> {
  if (!config.imageEnabled) return "Image generation is disabled.";
  try {
    const dir = config.uploadDir;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `image_${Date.now()}.png`);
    const query = encodeURIComponent(`${prompt}, ultra detailed, sharp focus, high quality`);
    const response = await fetch(
      `https://image.pollinations.ai/prompt/${query}?width=1024&height=1024&model=flux&nologo=true&private=true`,
      { signal: AbortSignal.timeout(120000) },
    );
    if (!response.ok) throw new Error(`provider returned ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 5000) throw new Error("provider returned an empty image");
    fs.writeFileSync(file, bytes);
    return `![Generated image](/api/files/${path.basename(file)})\n\nSaved to \`${file}\``;
  } catch (error) {
    return `Image generation failed: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

const tools: Tool[] = [
  {
    definition: {
      type: "function",
      function: {
        name: "get_time",
        description: "Get the current local time and weekday.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    run: () =>
      `It is **${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}** (${new Date().toLocaleDateString([], { weekday: "long" })})`,
  },
  {
    definition: {
      type: "function",
      function: {
        name: "get_date",
        description: "Get today's local date.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    run: () => `Today is **${new Date().toLocaleDateString([], { dateStyle: "full" })}**.`,
  },
  {
    definition: {
      type: "function",
      function: {
        name: "calculate",
        description: "Evaluate an arithmetic expression with + - * / ^ and parentheses.",
        parameters: {
          type: "object",
          properties: { expression: { type: "string", description: "e.g. (12+8)*3" } },
          required: ["expression"],
        },
      },
    },
    run: (args) => calculate(str(args.expression)),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "weather",
        description: "Get current weather for a city using the free Open-Meteo API.",
        parameters: {
          type: "object",
          properties: { city: { type: "string", description: "City name, e.g. Chennai" } },
          required: ["city"],
        },
      },
    },
    run: (args) => weather(str(args.city, "Chennai")),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "wikipedia",
        description: "Look up a topic on Wikipedia and return its summary.",
        parameters: {
          type: "object",
          properties: { subject: { type: "string", description: "Topic to look up" } },
          required: ["subject"],
        },
      },
    },
    run: (args) => wikipedia(str(args.subject)),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "web_search",
        description: "Search the live web using DuckDuckGo (no API key required).",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "Search query" } },
          required: ["query"],
        },
      },
    },
    run: (args) => webSearch(str(args.query)),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "notes_add",
        description: "Save a note for the user.",
        parameters: {
          type: "object",
          properties: { text: { type: "string", description: "Note text" } },
          required: ["text"],
        },
      },
    },
    run: (args, userId) => {
      const text = z.string().min(1).parse(args.text);
      db().prepare("INSERT INTO notes (id, user_id, text, created_at) VALUES (?, ?, ?, ?)").run(
        crypto.randomUUID(),
        userId,
        text,
        new Date().toISOString(),
      );
      return `Noted: *${text}*`;
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "notes_list",
        description: "List the user's saved notes.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    run: (_args, userId) => {
      const rows = db()
        .prepare("SELECT text, created_at FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 15")
        .all(userId) as { text: string; created_at: string }[];
      if (!rows.length) return "You have no saved notes yet.";
      return `**Your notes:**\n${rows.map((row, index) => `${index + 1}. ${row.text}`).join("\n")}`;
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "notes_clear",
        description: "Delete all of the user's saved notes.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    run: (_args, userId) => {
      const result = db().prepare("DELETE FROM notes WHERE user_id = ?").run(userId);
      return `Deleted ${result.changes} note(s).`;
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "pc_status",
        description: "Get battery, CPU, RAM or disk status of this PC.",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["battery", "cpu", "ram", "disk", "status"] },
          },
          required: ["kind"],
        },
      },
    },
    run: (args) => pcStatus(str(args.kind, "status")),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "analyze_sentiment",
        description: "Classify the sentiment of text using Veera's fine-tuned DistilBERT ONNX model.",
        parameters: {
          type: "object",
          properties: { text: { type: "string", description: "Text to classify" } },
          required: ["text"],
        },
      },
    },
    run: async (args) => {
      if (!classifierAvailable()) return "The sentiment model is not installed.";
      const sentiment = await analyzeSentiment(str(args.text));
      return sentiment
        ? `Sentiment: ${sentiment.label} (${(sentiment.confidence * 100).toFixed(1)}% confidence)`
        : "Sentiment analysis failed.";
    },
  },
  {
    definition: {
      type: "function",
      function: {
        name: "screenshot",
        description: "Capture the PC screen and save it locally.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    run: () => screenshot(),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "generate_image",
        description: "Generate an image from a text prompt using the free Pollinations service.",
        parameters: {
          type: "object",
          properties: { prompt: { type: "string", description: "Image description" } },
          required: ["prompt"],
        },
      },
    },
    run: (args) => generateImage(str(args.prompt)),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "speak",
        description:
          "Generate a natural-sounding neural voice (edge-tts) audio reply. Use when the user asks you to say or speak something aloud.",
        parameters: {
          type: "object",
          properties: { text: { type: "string", description: "Text to speak" } },
          required: ["text"],
        },
      },
    },
    run: (args) => synthesizeSpeech(str(args.text)),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "create_document",
        description:
          "Create a downloadable Word (.docx), PDF (.pdf) or PowerPoint (.pptx) document. Use slides for presentations.",
        parameters: {
          type: "object",
          properties: {
            format: { type: "string", enum: ["docx", "pdf", "pptx"] },
            title: { type: "string", description: "Document title" },
            content: {
              type: "string",
              description:
                "Document content in Markdown (headings, paragraphs and bullet points). Used for docx and pdf.",
            },
            filename: { type: "string", description: "Optional file name without extension" },
            slides: {
              type: "array",
              description: "Optional slide list for pptx",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  bullets: { type: "array", items: { type: "string" } },
                },
                required: ["title"],
              },
            },
          },
          required: ["format", "title", "content"],
        },
      },
    },
    run: (args) => createDocument(args),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "run_python",
        description:
          "Write and run a Python script locally, then return its output or error. Use this for code generation and auto-execution. If the script fails, read the error, fix the code and call this tool again until it succeeds.",
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "Complete Python program to execute" },
            filename: { type: "string", description: "Optional short script name" },
          },
          required: ["code"],
        },
      },
    },
    run: (args) => runPython(str(args.code), str(args.filename, "veera_script")),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "open_app",
        description: "Open an application on this PC (e.g. notepad, calculator, chrome, vscode).",
        parameters: {
          type: "object",
          properties: { app: { type: "string", description: "Application name" } },
          required: ["app"],
        },
      },
    },
    run: (args) => openApp(str(args.app)),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "open_url",
        description: "Open a web address in the default browser.",
        parameters: {
          type: "object",
          properties: { url: { type: "string", description: "Full http/https URL" } },
          required: ["url"],
        },
      },
    },
    run: (args) => openUrl(str(args.url)),
  },
  {
    definition: {
      type: "function",
      function: {
        name: "set_volume",
        description: "Set the PC system volume (0-100), or pass 'mute' / 'unmute'.",
        parameters: {
          type: "object",
          properties: {
            level: {
              description: "Volume percentage, or the word mute/unmute",
              oneOf: [{ type: "integer" }, { type: "string" }],
            },
          },
          required: ["level"],
        },
      },
    },
    run: (args) => setVolume(args.level),
  },
];

export const toolDefinitions: ToolDefinition[] = tools.map((tool) => tool.definition);

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<string> {
  const tool = tools.find((item) => item.definition.function.name === name);
  if (!tool) return `Unknown tool: ${name}`;
  try {
    return await tool.run(args, userId);
  } catch (error) {
    return `Tool "${name}" failed: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}
