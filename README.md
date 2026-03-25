# OpenCode Alarm Plugin

在 AI 回复完成时发送系统通知的 OpenCode 插件。

## 功能

- 监听 AI 回复完成事件 (`session.idle`)
- 当终端窗口不在焦点时，发送系统通知
- 支持 macOS 系统通知

## 安装

### 方法一：本地安装

1. 构建插件：

```bash
bun install
bun run build
```

2. 将 `dist/index.js` 复制到插件目录：

```bash
# 全局安装
cp dist/index.js ~/.config/opencode/plugins/alarm.js

# 或项目级安装
cp dist/index.js .opencode/plugins/alarm.js
```

### 方法二：作为 npm 包使用

在 `opencode.json` 中添加：

```json
{
  "plugin": ["opencode-plugin-alarm"]
}
```

## 支持的终端

- Terminal (macOS 默认)
- iTerm2
- WezTerm
- Alacritty
- Kitty
- Ghostty

## 工作原理

1. 监听 `session.idle` 事件（AI 回复完成）
2. 使用 AppleScript 检测当前前台应用是否为终端
3. 如果终端不在焦点，发送 macOS 系统通知

## 要求

- macOS
- Bun 运行时

## License

MIT
