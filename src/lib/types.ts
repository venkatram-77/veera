export type User = {
  id: string;
  email: string;
  name: string;
};

export type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls: string | null;
  created_at: string;
};

export type Sentiment = {
  label: "POSITIVE" | "NEGATIVE";
  confidence: number;
};
