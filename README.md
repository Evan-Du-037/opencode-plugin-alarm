# OpenCode Alarm Plugin

在 AI 回复完成时发送系统通知的 OpenCode 插件。

## 功能

- 监听 AI 回复完成事件 (`session.idle`)
- 监听权限请求事件 (`permission.asked`)，当模型需要执行命令时实时提醒
- 当终端窗口不在焦点时，发送系统通知
- **点击通知自动激活 VSCode 或 Terminal 窗口**
- 支持 macOS 系统通知

## 安装

### 方法一：本地安装（推荐）

```bash
bun install
./install.sh
```

此脚本会：
1. 构建插件
2. 安装到 `~/.config/opencode/plugins/opencode-plugin-alarm.js`
3. 安装 `terminal-notifier` 工具

### 方法二：手动安装

1. 构建插件：

```bash
bun install
bun run build
```

2. 复制文件：

```bash
# 插件文件
cp dist/index.js ~/.config/opencode/plugins/alarm.js

# terminal-notifier（用于点击通知激活窗口）
mkdir -p ~/.config/opencode/plugins/bin
cp -r bin/terminal-notifier.app ~/.config/opencode/plugins/bin/
```

### 方法三：作为 npm 包使用

在 `opencode.json` 中添加：

```json
{
  "plugin": ["opencode-plugin-alarm"]
}
```

> 注意：npm 方式安装后，点击通知激活窗口功能可能不可用，会回退到普通通知。

## 支持的终端

- **VSCode** - 点击通知激活 VSCode 窗口
- **Terminal** (macOS 默认) - 点击通知激活 Terminal 窗口
- iTerm2, WezTerm, Alacritty, Kitty, Ghostty - 支持焦点检测

## 工作原理

1. 监听 `session.idle` 事件（AI 回复完成）
2. 监听 `permission.asked` 事件（模型请求权限，如执行命令），始终发送通知
3. 使用 AppleScript 检测当前前台应用是否为终端
4. 如果终端不在焦点：
   - 使用 `terminal-notifier` 发送可点击通知
   - 点击通知时自动激活 VSCode 或 Terminal 窗口
5. 如果 `terminal-notifier` 不可用，回退到 `osascript` 发送普通通知

## 要求

- macOS
- Bun 运行时

## License

MIT
