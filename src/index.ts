import type { Plugin } from '@opencode-ai/plugin'
import type { Event } from '@opencode-ai/sdk'
import path from 'path'
import fs from 'fs'

const TERMINAL_APPS = ['Terminal', 'iTerm2', 'WezTerm', 'Alacritty', 'kitty', 'Ghostty', 'Electron', 'Code']
const TERMINAL_BUNDLE_IDS: Record<string, string> = {
  'vscode': 'com.microsoft.VSCode',
  'Apple_Terminal': 'com.apple.Terminal',
}
const DEBOUNCE_MS = 3000
const PREVIEW_LENGTH = 30

let lastNotificationTime = 0
let cachedNotifierPath: string | null = null

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

function detectTerminalBundleId(): string {
  const termProgram = process.env.TERM_PROGRAM || ''
  return TERMINAL_BUNDLE_IDS[termProgram] || 'com.apple.Terminal'
}

function getTerminalNotifierPath(): string | null {
  if (cachedNotifierPath !== null) {
    return cachedNotifierPath
  }

  const homeDir = process.env.HOME || ''
  if (!homeDir) {
    cachedNotifierPath = null
    return null
  }

  const notifierPath = path.join(
    homeDir,
    '.config',
    'opencode',
    'plugins',
    'bin',
    'terminal-notifier.app',
    'Contents',
    'MacOS',
    'terminal-notifier'
  )

  if (fs.existsSync(notifierPath)) {
    cachedNotifierPath = notifierPath
    return notifierPath
  }

  cachedNotifierPath = null
  return null
}

async function isTerminalFocused(): Promise<boolean> {
  try {
    const script = `
      tell application "System Events"
        set frontApp to name of first application process whose frontmost is true
        set frontAppProcess to first application process whose name is frontApp
        try
          set windowList to every window of frontAppProcess
          set windowCount to count of windowList
        on error
          set windowCount to 0
        end try
        return {frontApp, windowCount}
      end tell
    `
    const result = Bun.spawnSync(['osascript', '-e', script])
    const output = result.stdout.toString().trim()
    
    const parts = output.split(', ')
    if (parts.length < 2) return false
    
    const frontApp = parts[0]
    const windowCount = parseInt(parts[1], 10)
    
    if (windowCount === 0) return false
    
    if (TERMINAL_APPS.includes(frontApp)) return true
    
    if (frontApp === 'Electron' || frontApp === 'Code') {
      return process.env.TERM_PROGRAM === 'vscode'
    }
    
    return false
  } catch {
    return false
  }
}

async function sendNotificationWithTerminalNotifier(title: string, message: string, bundleId: string): Promise<boolean> {
  const notifierPath = getTerminalNotifierPath()
  if (!notifierPath) {
    return false
  }

  try {
    const args = [
      '-title', title,
      '-message', message,
      '-activate', bundleId,
      '-sound', 'default',
    ]

    const result = Bun.spawnSync([notifierPath, ...args], {
      timeout: 5000,
    })

    return result.exitCode === 0
  } catch {
    return false
  }
}

async function sendNotificationWithOsascript(title: string, message: string): Promise<void> {
  const escapedTitle = title.replace(/"/g, '\\"')
  const escapedMessage = message.replace(/"/g, '\\"')
  const script = `display notification "${escapedMessage}" with title "${escapedTitle}"`
  Bun.spawnSync(['osascript', '-e', script])
}

async function sendNotification(title: string, message: string): Promise<void> {
  const bundleId = detectTerminalBundleId()
  const success = await sendNotificationWithTerminalNotifier(title, message, bundleId)
  
  if (!success) {
    await sendNotificationWithOsascript(title, message)
  }
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
