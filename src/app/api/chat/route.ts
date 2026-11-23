import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { analyzeSentiment } from "@/lib/classifier";
import {
  addMessage,
  createConversation,
  getConversation,
  listMessages,
} from "@/lib/db";
import {
  chatOnce,
  resolveChatModel,
  streamChat,
  type ChatMessage,
  type ToolCall,
} from "@/lib/ollama";
import { searchDocuments } from "@/lib/rag";
import { executeTool, toolDefinitions } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TOOL_ROUNDS = 8;

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    conversationId?: string;
    message?: string;
    useRag?: boolean;
  };
  const text = body.message?.trim();
  if (!text) return NextResponse.json({ error: "Message is required" }, { status: 400 });

  let conversationId = body.conversationId;
  if (!conversationId || !getConversation(user.id, conversationId)) {
    conversationId = createConversation(user.id, text.slice(0, 48)).id;
  }
  addMessage(conversationId, "user", text);

  const sentiment = await analyzeSentiment(text).catch(() => null);

  const systemParts = [
    "You are Veera, a helpful, friendly local AI assistant running entirely on the user's PC.",
    "Be concise and clear. Use Markdown for formatting when helpful.",
    "You have access to tools. Use them when the user asks for live data, calculations, notes, PC status, web results, or sentiment analysis.",
    "You can create Word (.docx), PDF (.pdf) and PowerPoint (.pptx) files with create_document. Put presentation content in the slides array.",
    "You can write and run Python with run_python. If a script fails, read the error, fix the code, and call run_python again automatically until it works or you hit a clear blocker.",
    "You control the PC with open_app, open_url, set_volume and screenshot, and can search the web with web_search. Use speak for a natural neural voice reply when asked to say something aloud.",
    "If a tool result contains an error or a link, summarize it naturally. Never pretend to have used a tool you did not call.",
  ];
  if (sentiment) {
    systemParts.push(
      `The user's message sentiment is ${sentiment.label}. Adapt your tone: be extra supportive for negative sentiment, relaxed for positive sentiment.`,
    );
  }
  if (body.useRag) {
    try {
      const hits = await searchDocuments(user.id, text);
      if (hits.length) {
        systemParts.push(
          `Relevant document excerpts:\n${hits
            .map((hit, index) => `[${index + 1}] ${hit.source}\n${hit.content}`)
            .join("\n\n")}\nUse these excerpts to answer. If they do not contain the answer, say so.`,
        );
      } else {
        systemParts.push("No relevant documents were found for this question.");
      }
    } catch (error) {
      systemParts.push(
        `Document search is unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  const history = listMessages(conversationId, 30);
  const messages: ChatMessage[] = [
    { role: "system", content: systemParts.join("\n\n") },
    ...history.map((item) => {
      const message: ChatMessage = { role: item.role, content: item.content };
      if (item.role === "assistant" && item.tool_calls) {
        try {
          message.tool_calls = JSON.parse(item.tool_calls) as ToolCall[];
        } catch {
          // Ignore malformed legacy tool calls.
        }
      }
      return message;
    }),
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const close = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      try {
        const model = await resolveChatModel();
        send({ type: "meta", conversationId, model, sentiment });

        let finalContent = "";
        let finalToolCalls: ToolCall[] = [];

        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
          let content = "";
          const toolCalls: ToolCall[] = [];
          for await (const chunk of streamChat({
            messages,
            tools: toolDefinitions,
            model,
            signal: request.signal,
          })) {
            if (chunk.content) {
              content += chunk.content;
              send({ type: "delta", text: chunk.content });
            }
            if (chunk.toolCalls?.length) toolCalls.push(...chunk.toolCalls);
          }

          if (!toolCalls.length) {
            finalContent = content.trim();
            break;
          }

          finalToolCalls = toolCalls;
          messages.push({ role: "assistant", content, tool_calls: toolCalls });
          for (const call of toolCalls) {
            const name = call.function?.name ?? "unknown";
            const raw = call.function?.arguments ?? {};
            let args: Record<string, unknown> = {};
            if (typeof raw === "string") {
              try {
                args = JSON.parse(raw) as Record<string, unknown>;
              } catch {
                args = {};
              }
            } else {
              args = raw;
            }
            const result = await executeTool(name, args, user.id);
            send({ type: "tool", name, arguments: args, result });
            messages.push({
              role: "tool",
              content: result,
              tool_name: name,
            });
          }

          if (round === MAX_TOOL_ROUNDS - 1) {
            const answer = await chatOnce(messages, undefined, model);
            finalContent = answer.content ?? "";
            send({ type: "delta", text: finalContent });
          }
        }

        if (!finalContent) {
          finalContent = "I couldn't generate a response. Please try again.";
          send({ type: "delta", text: finalContent });
        }

        addMessage(conversationId, "assistant", finalContent, finalToolCalls);
        send({ type: "done", conversationId, content: finalContent });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        send({ type: "error", message });
      } finally {
        close();
      }
    },
    cancel() {
      // The abort signal from the request propagates to streamChat.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
