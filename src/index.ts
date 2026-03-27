import type { Plugin } from '@opencode-ai/plugin'
import type { Event } from '@opencode-ai/sdk'
import path from 'path'
import fs from 'fs'

const LOG_FILE = path.join(process.env.HOME || '', '.opencode-alarm-plugin.log');
function debugLog(msg: string, ...args: any[]) {
    const line = `[${new Date().toISOString()}] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`;
    try { fs.appendFileSync(LOG_FILE, line); } catch (e) { }
}

const TERMINAL_BUNDLE_IDS: Record<string, string> = {
    'vscode': 'com.microsoft.VSCode',
    'Apple_Terminal': 'com.apple.Terminal',
};
const DEBOUNCE_MS = 3000;
const PREVIEW_LENGTH = 30;
const SKIP_TIMEOUT = 5000;

let lastNotificationTime = 0;
let cachedNotifierPath: string | null = null;
const skipIdleNotifications = new Map<string, number>();

function getErrorMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'data' in error) {
        const data = (error as { data: unknown }).data;
        if (typeof data === 'object' && data !== null && 'message' in data) {
            const msg = (data as { message: unknown }).message;
            if (typeof msg === 'string') return msg;
        }
    }
    return '发生错误';
}

function detectTerminalType(): 'vscode' | 'terminal' {
    const termProgram = process.env.TERM_PROGRAM || '';
    if (termProgram === 'vscode') return 'vscode';
    return 'terminal';
}

const AGENT_NOTIFIERS: string[] = ['build', 'plan', 'explore', 'general', 'research']

function getNotifierPathForAgent(agent?: string): string | null {
    const homeDir = process.env.HOME || ''
    if (!homeDir) return null

    const pluginsDir = path.join(homeDir, '.config', 'opencode', 'plugins')

    if (agent && AGENT_NOTIFIERS.includes(agent)) {
        const agentNotifierPath = path.join(
            pluginsDir,
            'asset',
            'notifiers',
            `${agent}.app`,
            'Contents',
            'MacOS',
            'terminal-notifier'
        )
        if (fs.existsSync(agentNotifierPath)) {
            return agentNotifierPath
        }
    }

    const defaultNotifierPath = path.join(
        pluginsDir,
        'bin',
        'terminal-notifier.app',
        'Contents',
        'MacOS',
        'terminal-notifier'
    )
    if (fs.existsSync(defaultNotifierPath)) {
        return defaultNotifierPath
    }

    return null
}

function getTerminalNotifierPath(): string | null {
    if (cachedNotifierPath !== null) {
        return cachedNotifierPath
    }
    cachedNotifierPath = getNotifierPathForAgent()
    return cachedNotifierPath
}

function escapeShellArg(arg: string): string {
    return "'" + arg.replace(/'/g, "'\\''") + "'";
}

function getCurrentWorkingDirectory(): string | null {
    try {
        return process.cwd() || null;
    } catch {
        return null;
    }
}

async function sendNotificationWithTerminalNotifier(
    title: string,
    message: string,
    terminalType: 'vscode' | 'terminal',
    agent?: string
): Promise<boolean> {
    const notifierPath = getNotifierPathForAgent(agent)
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
                const escapedPath = escapeShellArg(cwd)
                args.push('-execute', `open -a 'Visual Studio Code' ${escapedPath}`)
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

async function sendNotification(title: string, message: string, agent?: string): Promise<void> {
    const terminalType = detectTerminalType()
    await sendNotificationWithTerminalNotifier(title, message, terminalType, agent)
}

function stripMarkdown(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1')
        .replace(/~~([^~]+)~~/g, '$1')
        .replace(/^#+\s*/gm, '')
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
    agent?: string
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
    debugLog('🚀 Alarm plugin initialized');
    return {
        event: async ({ event }) => {
            debugLog('🔔 Received event', event.type);

            if ((event as any).type === 'permission.asked') {
                const props = (event as any).properties;
                debugLog('Permission asked FULL properties:', JSON.stringify(props, null, 2));

                const now = Date.now();
                if (now - lastNotificationTime < DEBOUNCE_MS) return;
                lastNotificationTime = now;

                const permissionType = props?.permission || '未知操作';
                const filepath = props?.metadata?.filepath;
                const title = filepath ? `${permissionType}: ${filepath}` : permissionType;
                await sendNotification('🔐 OpenCode', `需要授权: ${title}`);
                return;
            }

            if ((event as any).type === 'permission.replied') {
                const props = (event as any).properties;
                debugLog('Permission replied FULL properties:', JSON.stringify(props, null, 2));

                const sessionID = props?.sessionID;
                const reply = props?.reply;

                if (reply === 'reject' && sessionID) {
                    skipIdleNotifications.set(sessionID, Date.now());
                    debugLog('Marked session to skip idle notification:', sessionID);
                }
                return;
            }

            if (event.type !== 'session.idle' && event.type !== 'session.error') return;

            const sessionID = event.properties?.sessionID;
            debugLog('Session ID:', sessionID);
            if (!sessionID) return;

            const skipTime = skipIdleNotifications.get(sessionID);
            if (skipTime && Date.now() - skipTime < SKIP_TIMEOUT) {
                skipIdleNotifications.delete(sessionID);
                debugLog('Skipping idle notification due to recent permission reject');
                return;
            }

            const now = Date.now();
            debugLog(`Time diff: ${now - lastNotificationTime}ms (DEBOUNCE_MS: ${DEBOUNCE_MS})`);
            if (now - lastNotificationTime < DEBOUNCE_MS) return;

            lastNotificationTime = now;

            try {
                debugLog('Fetching session & messages...');
                const [sessionRes, messagesRes] = await Promise.all([
                    client.session.get({ path: { id: sessionID } }),
                    client.session.messages({ path: { id: sessionID }, query: { limit: 1 } }),
                ]);

                const session = sessionRes.data;
                const isSubagent = session?.parentID !== undefined;
                const titlePrefix = isSubagent ? '🔄 [子对话] ' : '';
                const title = session?.title || 'OpenCode';
                const messages = messagesRes.data || [];
                const lastMessage = messages[messages.length - 1] as Message | undefined;
                debugLog('Title:', title);
                debugLog('Last message:', lastMessage ? 'exists' : 'undefined');

                let hasError = false;
                let errorMessage = '';

                if (event.type === 'session.error' && event.properties.error) {
                    hasError = true;
                    errorMessage = getErrorMessage(event.properties.error);
                } else if (lastMessage?.info?.role === 'assistant' && lastMessage.info.error) {
                    hasError = true;
                    errorMessage = getErrorMessage(lastMessage.info.error);
                }

                if (hasError) {
                    debugLog('Sending error notification');
                    await sendNotification(`❌ ${titlePrefix}${title}`, errorMessage, lastMessage?.info?.agent);
                } else {
                    const preview = lastMessage ? extractTextPreview(lastMessage.parts) : 'AI 回复完成';
                    debugLog('Sending success notification with preview:', preview);
                    await sendNotification(`✅ ${titlePrefix}${title}`, preview, lastMessage?.info?.agent);
                }
            } catch (err) {
                debugLog('🔥 Error in event handler:', err);
                await sendNotification('✅ OpenCode', 'AI 回复完成');
            }
        },
        "tool.execute.before": async (input) => {
            if (input.tool === "question") {
                debugLog('🔔 Question tool invoked');
                const now = Date.now();
                if (now - lastNotificationTime < DEBOUNCE_MS) return;
                lastNotificationTime = now;
                await sendNotification('❓ OpenCode', '需要你的输入');
            }
        }
    }
}

export default AlarmPlugin
