# Veera — local AI assistant

Veera is a private, zero-cost web assistant. Chat generation and embeddings run through Ollama on this PC, and sentiment classification uses the fine-tuned DistilBERT ONNX model in `models/veera/`. No API keys are required.

## Setup

1. Start Ollama (already installed here):

   ```powershell
   ollama serve
   ```

2. The models are already registered. To recreate them:

   ```powershell
   ollama create nomic-embed-text -f models/veera/Modelfile.embed
   ollama create veera -f models/veera/Modelfile
   ollama create qwen3.5:9b -f models/veera/Modelfile
   ```

3. Start the app:

   ```powershell
   npm install
   npm run dev
   ```

4. Open <http://localhost:3000>.

## Configuration

Edit `.env.local`:

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_CHAT_MODEL` | `veera` | Main chat model |
| `OLLAMA_FALLBACK_MODEL` | `qwen3.5:9b` | Backup chat model |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Document embeddings |
| `OLLAMA_NUM_CTX` | `4096` | Context window (fits 19 tools plus a reply) |
| `AUTH_ENABLED` | `false` | Enable multi-user login |
| `AUTH_SECRET` | dev value | **Change before enabling auth** |
| `ENABLE_SCREENSHOT` | `true` | Allow the screenshot tool |
| `ENABLE_IMAGE_GEN` | `true` | Allow image generation |
| `ENABLE_PC_CONTROL` | `true` | Allow opening apps/URLs and volume control |
| `ENABLE_CODE_EXECUTION` | `true` | Allow Python creation and execution |
| `ENABLE_TTS` | `true` | Natural neural replies via edge-tts |
| `VEERA_TTS_VOICE` | `en-US-AriaNeural` | edge-tts voice name |
| `CODE_TIMEOUT_MS` | `30000` | Python execution timeout |

`edge-tts` is already installed (`python -m pip install edge-tts` to reinstall). It uses Microsoft's free online neural voices, so it needs internet but no GPU VRAM.

## Features

- Streaming chat with conversation history (SQLite)
- Sentiment-aware responses via the local ONNX classifier
- **Natural neural voice** — spoken replies use edge-tts, not Windows' robotic voice
- **Document creation** — generate `.docx`, `.pdf` and `.pptx` files that download directly in chat
- **Code generation + auto-execution** — Veera writes Python, runs it, reads the output/error and automatically fixes and retries
- **Voice PC control** — voice input plus tools to open apps, open web pages, take screenshots, set volume and search the web
- Other tools: time/date, calculator, weather, Wikipedia, notes, PC status, sentiment, image generation
- Document RAG: PDF, DOCX, PPTX, TXT/MD/CSV/JSON (toggle "Search uploaded documents")
- Optional multi-user accounts with scrypt password hashes and signed cookies

## Model note

`Qwen3.5-9B-Q4_K_M` is about 5.3 GB. On an RTX 3050 6 GB laptop GPU, `num_ctx=4096` is needed so the tool definitions and reply fit; some layers run on CPU. Lower it to `2048` if you run out of memory, but complex tool calls may then fail. Thinking mode is disabled for chat requests (`think: false`) so replies stream quickly.

Tailwind 4 is wired through `postcss.config.mjs` with `@tailwindcss/postcss`. `globals.css` uses `@source not "../../models"` so Tailwind does not try to scan the multi-gigabyte GGUF files (which caused a build crash). On the first `npm run dev`, Turbopack may take a couple of minutes to write its filesystem cache.

## Probe

```powershell
npm run probe:model
```
