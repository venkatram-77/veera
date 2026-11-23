import path from "node:path";

const root = process.cwd();

export const config = {
  ollamaUrl: (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, ""),
  chatModel: process.env.OLLAMA_CHAT_MODEL ?? "veera",
  fallbackChatModel: process.env.OLLAMA_FALLBACK_MODEL ?? "qwen3.5:9b",
  embedModel: process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
  onnxPath:
    process.env.VEERA_ONNX_PATH ?? path.join(root, "models", "veera", "veera_quantized.onnx"),
  vocabPath:
    process.env.VEERA_VOCAB_PATH ??
    path.join(root, "models", "veera", "tokenizer", "vocab.txt"),
  dbPath: process.env.VEERA_DB_PATH ?? path.join(root, "data", "veera.db"),
  uploadDir: path.join(root, "data", "uploads"),
  authEnabled: process.env.AUTH_ENABLED === "true",
  authSecret: process.env.AUTH_SECRET ?? "veera-dev-secret-change-me",
  numCtx: Number(process.env.OLLAMA_NUM_CTX ?? 2048),
  temperature: Number(process.env.OLLAMA_TEMPERATURE ?? 0.7),
  screenshotEnabled: process.env.ENABLE_SCREENSHOT === "true",
  imageEnabled: process.env.ENABLE_IMAGE_GEN !== "false",
  pcControlEnabled: process.env.ENABLE_PC_CONTROL !== "false",
  codeExecutionEnabled: process.env.ENABLE_CODE_EXECUTION !== "false",
  ttsEnabled: process.env.ENABLE_TTS !== "false",
  ttsVoice: process.env.VEERA_TTS_VOICE ?? "en-US-AriaNeural",
  pythonCommand: process.env.VEERA_PYTHON ?? "python",
  scriptDir: path.join(root, "data", "scripts"),
  codeTimeoutMs: Number(process.env.CODE_TIMEOUT_MS ?? 30_000),
};

export type AppConfig = typeof config;
