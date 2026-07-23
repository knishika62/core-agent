export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // raw JSON string, as returned by the API
}

export interface Message {
  role: Role;
  content: string;
  toolCalls?: ToolCall[]; // present on assistant messages that call tools
  toolCallId?: string; // present on tool result messages
  name?: string; // tool name, present on tool result messages
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface ChatCompletionDelta {
  content?: string;
  toolCallDeltas?: {
    index: number;
    id?: string;
    name?: string;
    argumentsChunk?: string;
  }[];
  finishReason?: string;
}
