"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  Bot,
  FileText,
  LogOut,
  Menu,
  Mic,
  MicOff,
  MoreHorizontal,
  Paperclip,
  Plus,
  Send,
  Settings,
  Trash2,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import Message, { type ToolEvent, type UiMessage } from "./Message";

type Conversation = { id: string; title: string; created_at: string; updated_at: string };
type DocumentInfo = { id: string; name: string; created_at: string; chunks: number };
type AppUser = { id: string; email: string; name: string };
type Health = {
  ok: boolean;
  ollama: { online: boolean; chatModel: string; embedModel: string; installed: string[] };
  classifier: boolean;
  rag: number;
  authEnabled: boolean;
};

type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const api = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
};

export default function ChatApp() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authName, setAuthName] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [useRag, setUseRag] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const data = await api<{ conversations: Conversation[] }>("/api/conversations");
      setConversations(data.conversations);
    } catch {
      // Auth screen handles unauthorized state.
    }
  }, []);

  const loadDocuments = useCallback(async () => {
    try {
      const data = await api<{ documents: DocumentInfo[] }>("/api/docs");
      setDocuments(data.documents);
    } catch {
      // Ignore when unauthorized.
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      setHealth(await api<Health>("/api/health"));
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ user: AppUser | null; authEnabled: boolean }>("/api/auth/me");
        setUser(me.user);
        setAuthEnabled(me.authEnabled);
      } catch {
        setUser(null);
      }
      setAuthReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!authReady || (authEnabled && !user)) return;
    loadConversations();
    loadDocuments();
    loadHealth();
  }, [authReady, authEnabled, user, loadConversations, loadDocuments, loadHealth]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const openConversation = async (id: string) => {
    if (busy) return;
    setActiveId(id);
    setSidebarOpen(false);
    try {
      const data = await api<{ messages: Array<{ id: string; role: "user" | "assistant"; content: string; tool_calls: string | null }> }>(
        `/api/conversations/${id}`,
      );
      setMessages(
        data.messages
          .filter((item) => item.role === "user" || item.role === "assistant")
          .map((item) => ({
            id: item.id,
            role: item.role,
            content: item.content,
            tools: item.tool_calls ? (JSON.parse(item.tool_calls) as ToolEvent[]) : undefined,
          })),
      );
    } catch {
      setError("Could not load that conversation.");
    }
  };

  const newChat = () => {
    if (busy) return;
    setActiveId(null);
    setMessages([]);
    setError("");
    setSidebarOpen(false);
  };

  const deleteConversation = async (id: string) => {
    await api(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    loadConversations();
  };

  const uploadDocument = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("Uploading and indexing document…");
    const form = new FormData();
    form.append("file", file);
    try {
      await api("/api/docs", { method: "POST", body: form });
      setError("");
      loadDocuments();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    }
  };

  const deleteDocument = async (id: string) => {
    await api(`/api/docs/${id}`, { method: "DELETE" }).catch(() => null);
    loadDocuments();
  };

  const submitAuth = async () => {
    setAuthError("");
    try {
      const data = await api<{ user: AppUser }>(`/api/auth/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail,
          name: authName,
          password: authPassword,
        }),
      });
      setUser(data.user);
      setAuthPassword("");
    } catch (authError) {
      setAuthError(authError instanceof Error ? authError.message : "Authentication failed");
    }
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => null);
    setUser(null);
    setMessages([]);
    setConversations([]);
  };

  const toggleMic = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const speechWindow = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const RecognitionClass = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!RecognitionClass) {
      setError("Voice input is not supported in this browser. Try Chrome or Edge.");
      return;
    }
    const recognition = new RecognitionClass();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      setInput(transcript);
    };
    recognition.onerror = () => {
      setListening(false);
      setError("Voice input failed. Check your microphone permission.");
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      setError("");
    } catch {
      setError("Could not start voice input.");
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError("");
    setBusy(true);

    const userMessage: UiMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantId = crypto.randomUUID();
    const assistantMessage: UiMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ conversationId: activeId, message: text, useRag }),
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Chat failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let tools: ToolEvent[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          let event: {
            type: string;
            text?: string;
            conversationId?: string;
            model?: string;
            sentiment?: { label: string };
            name?: string;
            arguments?: Record<string, unknown>;
            result?: string;
            message?: string;
            content?: string;
          };
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (event.type === "meta") {
            if (event.conversationId && !activeId) setActiveId(event.conversationId);
            if (event.sentiment?.label) {
              setMessages((current) =>
                current.map((item) =>
                  item.id === assistantId
                    ? { ...item, sentiment: event.sentiment?.label }
                    : item,
                ),
              );
            }
          } else if (event.type === "delta" && event.text) {
            answer += event.text;
            setMessages((current) =>
              current.map((item) =>
                item.id === assistantId ? { ...item, content: answer } : item,
              ),
            );
          } else if (event.type === "tool" && event.name) {
            tools = [
              ...tools,
              {
                name: event.name,
                arguments: event.arguments ?? {},
                result: event.result ?? "",
              },
            ];
            setMessages((current) =>
              current.map((item) => (item.id === assistantId ? { ...item, tools } : item)),
            );
          } else if (event.type === "sentiment") {
            setMessages((current) =>
              current.map((item) =>
                item.id === assistantId
                  ? { ...item, sentiment: event.sentiment?.label }
                  : item,
              ),
            );
          } else if (event.type === "done") {
            if (event.content && !answer) answer = event.content;
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Generation failed");
          }
        }
      }

      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId ? { ...item, content: answer, streaming: false } : item,
        ),
      );
      if (speak && answer) {
        // Use edge-tts on the server for a natural neural voice (no GPU use).
        void fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: answer }),
        })
          .then((response) => response.json())
          .then((data: { url?: string; error?: string }) => {
            if (data.url) void new Audio(data.url).play().catch(() => {});
            else if (data.error) setError(data.error);
          })
          .catch(() => setError("Could not generate the voice reply."));
      }
      loadConversations();
      loadHealth();
    } catch (sendError) {
      if ((sendError as Error).name !== "AbortError") {
        setError(sendError instanceof Error ? sendError.message : "Something went wrong");
      }
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? { ...item, content: item.content || "Stopped.", streaming: false }
            : item,
        ),
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  if (!authReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="animate-pulse text-sm text-zinc-500">Loading Veera…</div>
      </main>
    );
  }

  if (authEnabled && !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-fuchsia-50 p-4 dark:from-zinc-950 dark:via-zinc-900 dark:to-indigo-950">
        <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-white">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Veera</h1>
              <p className="text-xs text-zinc-500">Your private local assistant</p>
            </div>
          </div>
          <div className="space-y-3">
            {authMode === "register" && (
              <input
                value={authName}
                onChange={(event) => setAuthName(event.target.value)}
                placeholder="Your name"
                className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700"
              />
            )}
            <input
              type="email"
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
              placeholder="Email"
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700"
            />
            <input
              type="password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && submitAuth()}
              placeholder="Password"
              className="w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700"
            />
            {authError && <p className="text-xs text-red-500">{authError}</p>}
            <button
              onClick={submitAuth}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              {authMode === "login" ? "Sign in" : "Create account"}
            </button>
            <button
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setAuthError("");
              }}
              className="w-full text-center text-xs text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {authMode === "login" ? "Need an account? Register" : "Already registered? Sign in"}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-dvh overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {sidebarOpen && (
        <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between px-4 py-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-white">
                <Bot className="h-4 w-4" />
              </div>
              <span className="font-semibold">Veera</span>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Close sidebar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={newChat}
            className="mx-3 mb-3 flex items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            <Plus className="h-4 w-4" /> New chat
          </button>

          <div className="flex-1 overflow-y-auto px-3">
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Conversations
            </p>
            {conversations.length === 0 && (
              <p className="px-1 py-2 text-xs text-zinc-400">No chats yet</p>
            )}
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`group mb-0.5 flex items-center rounded-lg px-2 py-2 text-sm ${
                  activeId === conversation.id
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                <button
                  onClick={() => openConversation(conversation.id)}
                  className="flex-1 truncate text-left"
                >
                  {conversation.title}
                </button>
                <button
                  onClick={() => deleteConversation(conversation.id)}
                  className="hidden text-zinc-400 hover:text-red-500 group-hover:block"
                  aria-label="Delete conversation"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            <p className="mb-1 mt-5 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
              Documents
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <Paperclip className="h-3.5 w-3.5" /> Upload document
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.pdf,.docx,.pptx,.csv,.json"
              hidden
              onChange={uploadDocument}
            />
            {documents.map((document) => (
              <div
                key={document.id}
                className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-zinc-600 dark:text-zinc-400"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate" title={document.name}>
                  {document.name}
                </span>
                <button
                  onClick={() => deleteDocument(document.id)}
                  className="hidden text-zinc-400 hover:text-red-500 group-hover:block"
                  aria-label="Delete document"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            <button
              onClick={() => setSettingsOpen((value) => !value)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <Settings className="h-4 w-4" /> Settings
            </button>
            {settingsOpen && (
              <div className="mt-2 space-y-3 rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-800">
                <div className="flex items-center gap-2">
                  {health?.ollama.online ? (
                    <Wifi className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <WifiOff className="h-3.5 w-3.5 text-red-500" />
                  )}
                  <span>Ollama {health?.ollama.online ? "online" : "offline"}</span>
                </div>
                <div className="truncate text-zinc-500">Model: {health?.ollama.chatModel}</div>
                <div className="text-zinc-500">
                  Sentiment: {health?.classifier ? "ready" : "missing"}
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={useRag}
                    onChange={(event) => setUseRag(event.target.checked)}
                  />
                  Search uploaded documents
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={speak}
                    onChange={(event) => setSpeak(event.target.checked)}
                  />
                  Speak replies aloud
                </label>
                {authEnabled && (
                  <button
                    onClick={logout}
                    className="flex items-center gap-1 text-red-500 hover:underline"
                  >
                    <LogOut className="h-3 w-3" /> Sign out
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-zinc-200 px-4 dark:border-zinc-800">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Open sidebar"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <div>
            <h1 className="text-sm font-semibold">Veera</h1>
            <p className="text-[11px] text-zinc-500">
              {health?.ollama.chatModel ?? "Connecting…"} · 100% local
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {health && (
              <span
                className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] ${
                  health.ollama.online
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                }`}
              >
                {health.ollama.online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                {health.ollama.online ? "Online" : "Offline"}
              </span>
            )}
            {user && <span className="hidden text-xs text-zinc-500 sm:block">{user.name}</span>}
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
          {messages.length === 0 ? (
            <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-white shadow-lg">
                <Bot className="h-8 w-8" />
              </div>
              <h2 className="text-2xl font-semibold">Hi, I&apos;m Veera</h2>
              <p className="mt-2 text-sm text-zinc-500">
                Your private AI assistant. Everything runs on this PC — no API keys, no cloud.
              </p>
              <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                {[
                  "What time is it?",
                  "What's the weather in Chennai?",
                  "Search the web for local AI news",
                  "Check my PC status",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-xs text-zinc-600 hover:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              {messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="mx-4 mb-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {error}
          </div>
        )}

        <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Message Veera…"
              rows={1}
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-zinc-400"
            />
            <button
              onClick={toggleMic}
              className={`rounded-lg p-2 ${
                listening
                  ? "bg-red-100 text-red-600 dark:bg-red-950"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              aria-label={listening ? "Stop listening" : "Voice input"}
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setSpeak((value) => !value)}
              className={`rounded-lg p-2 ${
                speak
                  ? "text-indigo-600 dark:text-indigo-400"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              aria-label="Toggle spoken replies"
            >
              {speak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button
              onClick={() => (busy ? abortRef.current?.abort() : send())}
              disabled={!busy && !input.trim()}
              className="rounded-lg bg-indigo-600 p-2 text-white hover:bg-indigo-500 disabled:opacity-40"
              aria-label={busy ? "Stop generating" : "Send message"}
            >
              {busy ? <MoreHorizontal className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-2 text-center text-[10px] text-zinc-400">
            Veera runs locally via Ollama · sentiment via your ONNX model
          </p>
        </div>
      </section>
    </main>
  );
}
