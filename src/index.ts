import type { Plugin } from '@opencode-ai/plugin'

const TERMINAL_APPS = ['Terminal', 'iTerm2', 'WezTerm', 'Alacritty', 'kitty', 'Ghostty']

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
  const script = `display notification "${message}" with title "${title}"`
  Bun.spawnSync(['osascript', '-e', script])
}

export const AlarmPlugin: Plugin = async () => {
  return {
    'session.idle': async () => {
      const focused = await isTerminalFocused()
      if (focused) return
      
      await sendNotification('OpenCode', 'AI 回复完成')
    }
  }
}

export default AlarmPlugin
