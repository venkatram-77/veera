import { config } from "./config";

export type ToolCall = {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown> | string;
  };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export async function ollamaReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${config.ollamaUrl}/api/version`, {
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listModels(): Promise<string[]> {
  try {
    const response = await fetch(`${config.ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((model) => model.name);
  } catch {
    return [];
  }
}

export async function resolveChatModel(): Promise<string> {
  const models = await listModels();
  const installed = (name: string) =>
    models.includes(name) || models.includes(`${name}:latest`);
  if (installed(config.chatModel)) return config.chatModel;
  if (installed(config.fallbackChatModel)) return config.fallbackChatModel;
  const candidates = models.filter(
    (model) => !/embed|nomic|mxbai|all-minilm/i.test(model),
  );
  return candidates[0] ?? config.chatModel;
}

export async function modelStatus(): Promise<{
  online: boolean;
  chatModel: string;
  embedModel: string;
  installed: string[];
}> {
  const online = await ollamaReachable();
  const installed = online ? await listModels() : [];
  return {
    online,
    chatModel: online ? await resolveChatModel() : config.chatModel,
    embedModel: config.embedModel,
    installed,
  };
}

type StreamParams = {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  model: string;
  signal?: AbortSignal;
};

export async function* streamChat({
  messages,
  tools,
  model,
  signal,
}: StreamParams): AsyncGenerator<{ content: string; toolCalls?: ToolCall[] }> {
  const response = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model,
      messages,
      ...(tools?.length ? { tools } : {}),
      stream: true,
      think: false,
      options: { temperature: config.temperature, num_ctx: config.numCtx },
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama chat failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as {
            message?: { content?: string; tool_calls?: ToolCall[] };
            error?: string;
          };
          if (chunk.error) throw new Error(chunk.error);
          yield {
            content: chunk.message?.content ?? "",
            toolCalls: chunk.message?.tool_calls,
          };
        } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function chatOnce(
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  model?: string,
): Promise<ChatMessage> {
  const activeModel = model ?? (await resolveChatModel());
  const response = await fetch(`${config.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model: activeModel,
      messages,
      ...(tools?.length ? { tools } : {}),
      stream: false,
      think: false,
      options: { temperature: 0, num_ctx: config.numCtx },
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama chat failed (${response.status})`);
  }
  const data = (await response.json()) as { message?: ChatMessage };
  if (!data.message) throw new Error("Ollama returned no message");
  return data.message;
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const response = await fetch(`${config.ollamaUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ model: config.embedModel, input: texts }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Embedding failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await response.json()) as { embeddings?: number[][] };
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error("Embedding response was incomplete");
  }
  return data.embeddings;
}
