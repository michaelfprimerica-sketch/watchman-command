export interface ChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: string
  timestamp: Date
  isStreaming?: boolean
  /** Safe activity label only; never contains model reasoning text. */
  reasoningStatus?: 'Analyzing…' | 'Searching local knowledge…'
}

export interface ChatSession {
  id: string
  title: string
  lastMessage?: string
  timestamp: Date
}
