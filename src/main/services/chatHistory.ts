/**
 * S21.11 — Chat history persistence service
 * Saves and loads chat conversations to/from disk in userData/chat-history/
 */
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface ChatConversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

function getChatHistoryDir(): string {
  const userDataPath = app.getPath('userData')
  const dir = path.join(userDataPath, 'chat-history')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function saveConversation(conversation: ChatConversation): void {
  const dir = getChatHistoryDir()
  const filePath = path.join(dir, `${conversation.id}.json`)
  fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2), 'utf-8')
}

export function loadConversation(id: string): ChatConversation | null {
  const dir = getChatHistoryDir()
  const filePath = path.join(dir, `${id}.json`)
  if (!fs.existsSync(filePath)) {
    return null
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as ChatConversation
  } catch {
    return null
  }
}

export function listConversations(): ChatConversation[] {
  const dir = getChatHistoryDir()
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  const conversations: ChatConversation[] = []
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8')
      const conv = JSON.parse(raw) as ChatConversation
      conversations.push(conv)
    } catch {
      // Skip corrupted files
    }
  }
  return conversations.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function deleteConversation(id: string): void {
  const dir = getChatHistoryDir()
  const filePath = path.join(dir, `${id}.json`)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

export function getLatestConversation(): ChatConversation | null {
  const conversations = listConversations()
  return conversations.length > 0 ? conversations[0] : null
}

export function createNewConversation(title?: string): ChatConversation {
  const now = Date.now()
  return {
    id: `chat-${now}`,
    title: title ?? `مکالمه ${new Date(now).toLocaleString('fa-IR')}`,
    messages: [],
    createdAt: now,
    updatedAt: now
  }
}

export function appendMessage(conversation: ChatConversation, message: ChatMessage): ChatConversation {
  conversation.messages.push(message)
  conversation.updatedAt = Date.now()
  if (conversation.messages.length === 1 && message.role === 'user') {
    conversation.title = message.content.slice(0, 40)
  }
  saveConversation(conversation)
  return conversation
}
