# WebADB AutoGLM

一个完全纯前端的 Android 手机 Agent 项目：

```text
Chromium WebUSB -> Tango/WebADB -> Android ADB
浏览器 fetch -> OpenAI 兼容的 /v1/chat/completions
```

## 运行

```bash
npm install
npm run dev
```

然后用 Chrome 或 Edge 打开 Vite 输出的本地地址。

## 环境要求

- 支持 WebUSB 的 Chromium 系浏览器。
- 已开启 USB 调试的 Android 设备。
- USB 数据线。
- 允许浏览器跨域请求的 OpenAI 兼容 API。
- 支持 `/v1/chat/completions` 中 `image_url` 内容的视觉模型。

## 功能

- 通过 WebADB 在浏览器里连接 Android 设备。
- 截取手机屏幕并发送给 OpenAI 兼容视觉模型。
- 解析模型返回的 JSON 动作。
- 校验动作安全性和坐标范围。
- 通过 ADB 执行点击、滑动、输入、启动应用等操作。
- 支持连续自动执行，直到模型返回完成、请求人工接管、达到最大步数或用户停止。
- 页面设置会持久化到本机浏览器 `localStorage`。

## 模型动作协议

模型应只返回一个 JSON 对象，例如：

```json
{ "action": "tap", "x": 540, "y": 1280, "reason": "点击搜索框" }
```

支持的标准动作：

- `launch`
- `tap`
- `swipe`
- `input_text`
- `key`
- `back`
- `home`
- `long_press`
- `double_tap`
- `wait`
- `take_over`
- `note`
- `done`

解析器也兼容 Open-AutoGLM 风格的动作名称和载荷，包括：

- `Launch`
- `Tap`，支持 `element: [x, y]` 相对坐标
- `Type`
- `Swipe`
- `Back`
- `Home`
- `Long Press`
- `Double Tap`
- `Wait`
- `Take_over`

也支持类似下面的函数式输出：

```text
do(action="Launch", app="京东")
```

## 设备控制

- 启动应用：使用内置常见 App 名称映射，或直接传 Android 包名。
- 长按：使用 Android `input swipe x y x y duration` 命令模拟。
- 双击：连续发送两次 `tap`，中间带短延迟。
- 文本输入：支持 Android `input text`，也支持 ADB Keyboard 广播模式。
- ADB Keyboard 模式要求设备上已安装 `com.android.adbkeyboard/.AdbIME`。

## 默认设置

- 默认模型：`gpt-5.5`
- 默认自动执行：开启
- 默认最大步数：`50`

以下设置会保存在本机浏览器：

- Base URL
- API Key
- Model
- Task
- Max steps
- Auto execute
- Use ADB Keyboard for text

## 安全说明

API Key 会保存在浏览器本地存储中，请只在可信设备和本地实验场景使用。

建议避免让 Agent 操作账号登录、支付、下单、删除、授权、验证码、隐私页面等高风险流程。模型返回 `take_over` 时，自动执行会停止并等待人工接管。

## 验证

```bash
npm test
npm run lint
npm run build
```

## 部署到 Cloudflare Pages

项目已创建在 Cloudflare Pages：

- 访问地址：https://webadb-autoglm.pages.dev/
- 最新部署：https://259d8673.webadb-autoglm.pages.dev/
- 部署方式：Wrangler Direct Upload

重新部署：

```bash
npm run deploy:pages
```

## 友链

- Linux.do：也称 L 站，是一个活跃的中文技术社区，围绕 AI、软件开发、资源分享与前沿资讯展开讨论；社区愿景是“新的理想型社区”，社区文化是“真诚、友善、团结、专业，共建你我引以为荣之社区”。
