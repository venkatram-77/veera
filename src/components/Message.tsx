"use client";

import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, ChevronDown, Download, User, Wrench } from "lucide-react";

export type ToolEvent = {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
};

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools?: ToolEvent[];
  streaming?: boolean;
  sentiment?: string;
};

type CodeProps = ComponentPropsWithoutRef<"code"> & { node?: unknown };

function Code({ className, children, node: _node, ...props }: CodeProps) {
  const isBlock = /language-/.test(className ?? "");
  if (isBlock) {
    return (
      <pre className="my-2 overflow-x-auto rounded-lg bg-zinc-900 p-3 text-xs text-zinc-100">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  }
  return (
    <code
      className="rounded bg-zinc-200/70 px-1 py-0.5 font-mono text-[0.85em] dark:bg-zinc-700/70"
      {...props}
    >
      {children}
    </code>
  );
}

type FileLink = { url: string; name: string };

function extractFileLinks(text: string): FileLink[] {
  const found = new Map<string, FileLink>();
  const patterns = [
    /\[[^\]]*\]\((\/api\/files\/[a-zA-Z0-9_.-]+)\)/g,
    /(\/api\/files\/[a-zA-Z0-9_.-]+)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const url = match[1];
      if (!found.has(url)) {
        found.set(url, {
          url,
          name: decodeURIComponent(url.split("/").pop() ?? "file"),
        });
      }
    }
  }
  return [...found.values()];
}

function DownloadLink({ url, name, children }: FileLink & { children?: ReactNode }) {
  return (
    <a
      href={url}
      download={name}
      style={{ textDecoration: "none" }}
      className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-2.5 py-1.5 font-medium !text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:!text-indigo-300 dark:hover:bg-indigo-900/50"
    >
      <Download className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-52 truncate">{children ?? name}</span>
    </a>
  );
}

type LinkProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };

function MarkdownLink({ href, children, node: _node, ...props }: LinkProps) {
  if (href?.startsWith("/api/files/")) {
    const name = decodeURIComponent(href.split("/").pop() ?? "file");
    return <DownloadLink url={href} name={name}>{children}</DownloadLink>;
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" {...props}>
      {children}
    </a>
  );
}

function ToolChip({ tool }: { tool: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const files = extractFileLinks(tool.result);
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-violet-300/60 bg-violet-50/60 text-xs dark:border-violet-700/50 dark:bg-violet-950/30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium text-violet-700 hover:bg-violet-100/60 dark:text-violet-300"
      >
        <Wrench className="h-3.5 w-3.5" />
        <span className="flex-1">Used {tool.name}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-violet-200/60 px-3 py-2 dark:border-violet-800/60">
          {files.map((file) => (
            <DownloadLink key={file.url} url={file.url} name={file.name} />
          ))}
        </div>
      )}
      {open && (
        <div className="space-y-2 border-t border-violet-200/60 px-3 py-2 dark:border-violet-800/60">
          <div className="font-mono text-[11px] text-zinc-500">
            {JSON.stringify(tool.arguments)}
          </div>
          <pre className="whitespace-pre-wrap font-sans text-zinc-700 dark:text-zinc-300">
            {tool.result}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function Message({ message }: { message: UiMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-indigo-600 text-white"
            : "bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-white"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={`max-w-[min(100%,44rem)] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
          isUser
            ? "rounded-tr-sm bg-indigo-600 text-white"
            : "rounded-tl-sm bg-white text-zinc-800 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700"
        }`}
      >
        {message.tools?.map((tool, index) => (
          <ToolChip key={`${tool.name}-${index}`} tool={tool} />
        ))}
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_a]:text-indigo-600 [&_a]:underline [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_ol_li]:list-decimal [&_p]:mb-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-zinc-300 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-zinc-300 [&_th]:px-2 [&_th]:py-1 dark:[&_a]:text-indigo-400 dark:[&_td]:border-zinc-600 dark:[&_th]:border-zinc-600">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: Code, a: MarkdownLink }}>
              {message.content || (message.streaming ? "▌" : "")}
            </ReactMarkdown>
          </div>
        )}
        {message.streaming && message.content && (
          <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-indigo-500 align-middle" />
        )}
        {message.sentiment && !isUser && (
          <div className="mt-2 text-[10px] uppercase tracking-wide text-zinc-400">
            tone adapted · {message.sentiment.toLowerCase()}
          </div>
        )}
      </div>
    </div>
  );
}
