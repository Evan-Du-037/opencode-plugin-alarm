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

function detectTerminalType(): 'vscode' | 'terminal' {
  const termProgram = process.env.TERM_PROGRAM || ''
  if (termProgram === 'vscode') return 'vscode'
  return 'terminal'
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

function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'"
}

function getCurrentWorkingDirectory(): string | null {
  try {
    return process.cwd() || null
  } catch {
    return null
  }
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
        return frontApp & "|" & windowCount
      end tell
    `
    const result = Bun.spawnSync(['osascript', '-e', script])
    const output = result.stdout.toString().trim()
    
    const pipeIndex = output.lastIndexOf('|')
    if (pipeIndex === -1) return false
    
    const frontApp = output.substring(0, pipeIndex)
    const windowCount = parseInt(output.substring(pipeIndex + 1), 10)
    
    if (isNaN(windowCount) || windowCount === 0) return false
    
    if (TERMINAL_APPS.includes(frontApp)) return true
    
    if (frontApp === 'Electron' || frontApp === 'Code') {
      return process.env.TERM_PROGRAM === 'vscode'
    }
    
    return false
  } catch {
    return false
  }
}

async function sendNotificationWithTerminalNotifier(
  title: string,
  message: string,
  terminalType: 'vscode' | 'terminal'
): Promise<boolean> {
  const notifierPath = getTerminalNotifierPath()
  if (!notifierPath) {
    return false
  }

  try {
    const args: string[] = [
      '-title', title,
      '-message', message,
      '-sound', 'default',
    ]

    if (terminalType === 'vscode') {
      const cwd = getCurrentWorkingDirectory()
      if (cwd) {
        const vscodeUrl = `vscode://file/${cwd}`
        args.push('-open', vscodeUrl)
      } else {
        args.push('-activate', 'com.microsoft.VSCode')
      }
    } else {
      args.push('-activate', 'com.apple.Terminal')
    }

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
  const terminalType = detectTerminalType()
  const success = await sendNotificationWithTerminalNotifier(title, message, terminalType)
  
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

interface MessagePart {
  type: string
  text?: string
}

interface MessageInfo {
  role?: string
  error?: unknown
}

interface Message {
  info: MessageInfo
  parts?: MessagePart[]
}

function extractTextPreview(parts: unknown): string {
  if (!parts || !Array.isArray(parts)) {
    return 'AI 回复完成'
  }
  
  for (const part of parts) {
    if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
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
        const lastMessage = messages[messages.length - 1] as Message | undefined

        let hasError = false
        let errorMessage = ''

        if (event.type === 'session.error' && event.properties.error) {
          hasError = true
          errorMessage = getErrorMessage(event.properties.error)
        } else if (lastMessage?.info?.role === 'assistant' && lastMessage.info.error) {
          hasError = true
          errorMessage = getErrorMessage(lastMessage.info.error)
        }

        if (hasError) {
          await sendNotification(`❌ ${title}`, errorMessage)
        } else {
          const preview = lastMessage ? extractTextPreview(lastMessage.parts) : 'AI 回复完成'
          await sendNotification(`✅ ${title}`, preview)
        }
      } catch {
        await sendNotification('✅ OpenCode', 'AI 回复完成')
      }
    }
  }
}

export default AlarmPlugin
