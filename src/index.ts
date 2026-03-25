import type { Plugin } from '@opencode-ai/plugin'
import type { Event } from '@opencode-ai/sdk'

const TERMINAL_APPS = ['Terminal', 'iTerm2', 'WezTerm', 'Alacritty', 'kitty', 'Ghostty']
const DEBOUNCE_MS = 3000
const PREVIEW_LENGTH = 30

let lastNotificationTime = 0

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = (error as { data: unknown }).data
    if (typeof data === 'object' && data !== null && 'message' in data) {
      const msg = (data as { message: unknown }).message
      if (typeof msg === 'string') return msg
    }
  }
  return '发生错误'
}

async function isTerminalFocused(): Promise<boolean> {
  try {
    const script = `
      tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        return frontApp
      end tell
    `
    const result = Bun.spawnSync(['osascript', '-e', script])
    const frontApp = result.stdout.toString().trim()
    return TERMINAL_APPS.includes(frontApp)
  } catch {
    return false
  }
}

async function sendNotification(title: string, message: string): Promise<void> {
  const escapedTitle = title.replace(/"/g, '\\"')
  const escapedMessage = message.replace(/"/g, '\\"')
  const script = `display notification "${escapedMessage}" with title "${escapedTitle}"`
  Bun.spawnSync(['osascript', '-e', script])
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<![-*])\*([^*]+)\*/g, '$1')
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTextPreview(parts: Array<{ type: string; text?: string }>): string {
  for (const part of parts) {
    if (part.type === 'text' && part.text) {
      const text = stripMarkdown(part.text)
      if (text.length > PREVIEW_LENGTH) {
        return text.slice(0, PREVIEW_LENGTH) + '...'
      }
      return text || '[此回复为空]'
    }
  }
  return '[此回复为空]'
}

export const AlarmPlugin: Plugin = async ({ client }) => {
  return {
    event: async ({ event }) => {
      if (event.type !== 'session.idle' && event.type !== 'session.error') return

      const now = Date.now()
      if (now - lastNotificationTime < DEBOUNCE_MS) return

      const focused = await isTerminalFocused()
      if (focused) return

      lastNotificationTime = now

      const sessionID = event.properties.sessionID
      if (!sessionID) return

      try {
        const [sessionRes, messagesRes] = await Promise.all([
          client.session.get({ path: { id: sessionID } }),
          client.session.messages({ path: { id: sessionID }, query: { limit: 1 } }),
        ])

        const title = sessionRes.data?.title || 'OpenCode'
        const messages = messagesRes.data || []
        const lastMessage = messages[messages.length - 1]

        let hasError = false
        let errorMessage = ''

        if (event.type === 'session.error' && event.properties.error) {
          hasError = true
          errorMessage = getErrorMessage(event.properties.error)
        } else if (lastMessage?.info.role === 'assistant' && lastMessage.info.error) {
          hasError = true
          errorMessage = getErrorMessage(lastMessage.info.error)
        }

        if (hasError) {
          await sendNotification(`❌ ${title}`, errorMessage)
        } else {
          const preview = lastMessage ? extractTextPreview(lastMessage.parts as Array<{ type: string; text?: string }>) : 'AI 回复完成'
          await sendNotification(`✅ ${title}`, preview)
        }
      } catch {
        await sendNotification('✅ OpenCode', 'AI 回复完成')
      }
    }
  }
}

export default AlarmPlugin
