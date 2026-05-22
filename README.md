<p align="center">
  <img src="./public/webdroid-agent-logo.png" alt="WebDroid Agent logo" width="96" />
</p>

# WebDroid Agent

<p align="center">
  <a href="./README.md">中文</a> | <a href="./README.en-US.md">English</a>
</p>

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![WebUSB](https://img.shields.io/badge/WebUSB-Android_ADB-34A853?logo=googlechrome&logoColor=white)
![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-online-F38020?logo=cloudflare&logoColor=white)

WebDroid Agent 是一个完全纯前端的 Android 手机 Agent 实验项目。它在浏览器中通过 WebUSB/WebADB 连接 Android 设备，截取手机屏幕并发送给 OpenAI 兼容的视觉模型，再把模型返回的受控动作解析、校验并通过 ADB 执行。

项目目标不是替代人工长期托管手机，而是提供一个可以在本地浏览器中快速验证「视觉模型 + 手机控制」链路的实验环境。

[在线体验](https://webadb-autoglm.pages.dev/) · [英文版](./README.en-US.md) · [Tango / WebADB](https://github.com/yume-chan/ya-webadb)

```text
Chromium WebUSB -> Tango/WebADB -> Android ADB
浏览器 fetch -> OpenAI 兼容 /v1/chat/completions -> 视觉模型
```

## 目录

- [核心能力](#核心能力)
- [适合谁使用](#适合谁使用)
- [项目状态](#项目状态)
- [工作流程](#工作流程)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [模型动作协议](#模型动作协议)
- [Open-AutoGLM 兼容](#open-autoglm-兼容)
- [设备控制细节](#设备控制细节)
- [安全边界](#安全边界)
- [项目结构](#项目结构)
- [验证](#验证)
- [路线图](#路线图)
- [贡献说明](#贡献说明)
- [部署到 Cloudflare Pages](#部署到-cloudflare-pages)
- [License](#license)
- [相关项目和社区](#相关项目和社区)

## 核心能力

- 纯前端运行，无应用后端，适合本地实验和静态站点部署。
- 通过 WebADB 在浏览器中连接已开启 USB 调试的 Android 设备。
- 截取手机屏幕，并把截图、当前 App、设备状态和历史步骤发送给视觉模型。
- 使用 canonical JSON 提示词和动作格式，并保留 Open-AutoGLM 风格动作输出的解析兼容。
- 自动解析、规范化并校验模型返回的下一步动作。
- 通过 ADB 执行启动应用、点击、滑动、输入文本、返回、Home、长按、双击、等待等操作。
- 支持连续自动执行，也支持逐步人工确认。
- 支持敏感动作确认、最大步数限制、停止运行、上下文重置和运行日志导出。
- 页面配置持久化到本机浏览器 `localStorage`。

## 适合谁使用

适合用于：

- 验证 OpenAI 兼容视觉模型是否能理解真实手机界面。
- 调试手机 Agent 的动作协议、坐标映射和自动执行流程。
- 研究 Open-AutoGLM 风格动作和更通用 JSON 动作之间的兼容层。
- 在本地安全环境中做 Android UI 自动化原型实验。
- 想快速体验 WebUSB + ADB + 多模态模型闭环的开发者。

不建议用于：

- 支付、下单、删除、授权、账号设置等高风险流程。
- 登录、验证码、密码输入等需要人工明确介入的流程。
- 需要后台服务、长期稳定托管或多设备调度的生产场景。

## 项目状态

当前项目处于实验可用阶段，核心链路已经打通：

- 浏览器端连接 Android 设备并获取截图。
- 调用 OpenAI 兼容视觉模型生成下一步动作。
- 解析 canonical JSON 和 Open-AutoGLM 风格动作。
- 执行常见 ADB 控制指令并记录运行日志。
- 支持自动执行、人工确认、停止和上下文重置。

仍建议把它当作本地实验工具使用。真实设备、模型能力、浏览器权限、CORS 配置和 Android ROM 差异都会影响效果。

## 工作流程

1. 在 Chromium 系浏览器中打开应用。
2. 连接开启 USB 调试的 Android 设备，并在手机上授权 ADB 调试。
3. 填写 OpenAI 兼容接口的 `Base URL`、`API Key` 和 `Model`。
4. 输入自然语言任务，例如「打开设置并进入 Wi-Fi 页面」。
5. 点击单步运行或自动运行。
6. 应用截屏并请求模型返回一个动作。
7. 前端解析、校验动作，并根据设置自动执行或等待确认。
8. 重复执行，直到模型返回 `done`、请求 `take_over`、达到最大步数或用户停止。

## 环境要求

- 支持 WebUSB 的 Chromium 系浏览器，例如 Chrome 或 Edge。
- 已开启 USB 调试的 Android 设备。
- 可传输数据的 USB 数据线。
- OpenAI 兼容的 `/v1/chat/completions` API。
- 支持 `image_url` 输入的视觉模型。
- API 服务需要允许浏览器跨域请求，也就是正确配置 CORS。
- 页面需要运行在 `localhost` 或 HTTPS 环境下，WebUSB 才能正常工作。

## 快速开始

```bash
npm install
npm run dev
```

然后用 Chrome 或 Edge 打开 Vite 输出的本地地址。

常用命令：

```bash
npm test
npm run lint
npm run build
npm run preview
```

## 配置说明

应用会把以下配置保存在当前浏览器的 `localStorage` 中：

- `Base URL`：OpenAI 兼容接口地址，默认 `https://api.openai.com/v1`。
- `API Key`：模型接口密钥。
- `Model`：模型名称，默认 `gpt-5.5`。
- `Task`：当前自然语言任务。
- `Max steps`：自动执行的最大步数，默认 `50`。
- `Auto execute`：是否自动执行模型返回的安全动作，默认开启。
- `Confirm sensitive actions`：敏感点击是否需要人工确认，默认开启。
- `Stream responses`：是否启用流式响应，默认关闭。
- `Use ADB Keyboard for text`：是否优先使用 ADB Keyboard 输入文本，默认关闭。
- `Action settle`、`Double tap interval`、`Keyboard step`：动作执行后的等待和输入节奏参数。

API Key 只保存在浏览器本地。请只在可信设备和本地实验环境中使用。

## 模型动作协议

推荐让模型只返回一个 JSON 对象，不要包含 Markdown 或解释性文本：

```json
{ "action": "tap", "x": 540, "y": 1280, "reason": "点击搜索框" }
```

canonical JSON 支持的标准动作：

| 动作 | 说明 |
| --- | --- |
| `launch` | 启动应用，可传常见应用名或包名 |
| `tap` | 点击屏幕坐标 |
| `swipe` | 从一个坐标滑动到另一个坐标 |
| `input_text` | 输入文本 |
| `key` | 发送 Android 按键，如 `BACK`、`HOME`、`ENTER` |
| `back` | 返回 |
| `home` | 回到桌面 |
| `long_press` | 长按坐标 |
| `double_tap` | 双击坐标 |
| `wait` | 等待一段时间 |
| `take_over` | 请求人工接管 |
| `interact` | 请求人工做选择或补充信息 |
| `note` | 记录观察，不执行设备动作 |
| `call_api` | 基于已有上下文请求模型整理或分析 |
| `done` | 任务完成 |

示例：

```json
{ "action": "launch", "app": "Settings", "reason": "打开系统设置" }
```

```json
{ "action": "swipe", "fromX": 540, "fromY": 1700, "toX": 540, "toY": 500, "durationMs": 400, "reason": "向下滚动列表" }
```

```json
{ "action": "take_over", "message": "需要用户输入验证码" }
```

## Open-AutoGLM 兼容

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
- `Interact`
- `Note`
- `Call_API`

也支持类似下面的函数式输出：

```text
do(action="Launch", app="京东")
```

Open-AutoGLM 风格坐标使用 `0-1000` 的相对坐标空间；canonical JSON 默认使用截图像素坐标。应用会在执行前把坐标映射回设备原生坐标。

## 设备控制细节

- 启动应用：使用内置常见 App 名称映射，或直接传 Android 包名。
- 点击/滑动：执行前会校验坐标是否在屏幕范围内。
- 长按：使用 Android `input swipe x y x y duration` 命令模拟。
- 双击：连续发送两次 `tap`，中间带可配置延迟。
- 文本输入：简单 ASCII 文本使用 Android `input text`。
- 中文和复杂字符：可使用 ADB Keyboard 广播模式输入。
- ADB Keyboard 模式要求设备上已安装并启用 `com.android.adbkeyboard/.AdbIME`。

## 安全边界

项目会尽量在前端执行前做约束和确认：

- 模型输出必须能解析为受支持动作。
- 坐标会进行屏幕范围校验。
- 文本输入会限制长度并拒绝控制字符。
- 自动执行有最大步数限制。
- 用户可以随时停止运行。
- 敏感点击可要求人工确认。
- `take_over`、`interact`、`note`、`call_api`、`done` 不会直接操作设备。

仍然建议避免让 Agent 操作账号登录、支付、下单、删除、授权、验证码、隐私页面等高风险流程。模型返回 `take_over` 时，自动执行会停止并等待人工接管。

## 项目结构

```text
src/
  adapters/
    appPackages.ts            # 常见 App 名称和包名映射
    deviceBackend.ts          # 设备后端接口
    webAdbBackend.ts          # WebADB/WebUSB 实现
    screenshotPreprocess.ts   # 截图预处理
  components/
    DevicePanel.tsx           # 设备连接和执行设置面板
    ModelPanel.tsx            # 模型配置面板
    PhoneStage.tsx            # 手机截图和动作覆盖层
    RunLog.tsx                # 运行日志
    RunPanel.tsx              # 聊天、运行控制和待执行动作
    ScreenshotLightbox.tsx    # 截图预览弹窗
    SettingsDialog.tsx        # 应用设置和仓库信息
  lib/
    actions.ts                # 动作解析、规范化和校验
    agent.ts                  # Agent 循环调度
    appCopy.ts                # 双语界面文案
    openAiClient.ts           # OpenAI 兼容请求构造与响应读取
    prompts.ts                # 提示词和动作规则
    repository.ts             # 仓库链接和 GitHub 统计解析
    screenshotCoordinates.ts  # 截图坐标映射
    settings.ts               # 本地设置读写
  styles/                     # 按页面区域拆分的样式
  App.tsx                     # 页面状态、业务流程和组件编排
```

## 验证

```bash
npm test
npm run lint
npm run build
```

当前测试主要覆盖：

- 动作解析和动作安全校验。
- OpenAI 兼容请求构造。
- Agent 单步和连续执行流程。
- 设置持久化和兼容迁移。
- 截图坐标映射。
- 运行日志、截图预览和主界面布局组件。

真实设备控制仍需要连接 Android 设备进行手动验证。

## 路线图

- [x] 浏览器中通过 WebADB 连接 Android 设备。
- [x] 截图并发送给 OpenAI 兼容视觉模型。
- [x] 支持 canonical JSON 动作协议。
- [x] 兼容 Open-AutoGLM 风格动作输出。
- [x] 支持自动执行、单步执行和敏感动作确认。
- [x] 支持运行日志和截图查看。
- [ ] 补充更完整的真实设备验证矩阵。
- [ ] 增加更多模型提供商配置示例。
- [ ] 增强失败恢复、动作重试和任务暂停恢复体验。
- [ ] 提供更系统的安全策略和风险分级。

## 贡献说明

欢迎围绕以下方向提交 issue 或 pull request：

- 新设备、新浏览器或新模型的兼容性反馈。
- 动作解析、坐标映射、ADB 执行稳定性改进。
- Open-AutoGLM 或其他手机 Agent 协议兼容。
- 文档、示例任务、故障排查和安全建议补充。
- UI 可用性、日志可读性和本地实验体验优化。

提交改动前建议先运行：

```bash
npm test
npm run lint
npm run build
```

## 部署到 Cloudflare Pages

项目已创建在 Cloudflare Pages：

- 线上地址（历史 Pages 域名）：https://webadb-autoglm.pages.dev/
- 部署方式：GitHub 绑定自动部署

重新部署：

```bash
git push origin main
```

也可以本地先验证构建：

```bash
npm run build
```

## License

本项目基于 [MIT License](./LICENSE) 开源。你可以自由使用、复制、修改、分发和二次开发本项目代码，但需要保留原始版权声明和许可证文本。

项目依赖的第三方库仍遵循各自的开源许可证，请在分发或商用前自行确认依赖合规性。

## 相关项目和社区

- [Tango / WebADB](https://github.com/yume-chan/ya-webadb)：浏览器中的 ADB/WebUSB 能力基础。
- Open-AutoGLM：手机 GUI Agent 动作协议的重要参考。
- Linux.do：活跃的中文技术社区，围绕 AI、软件开发、资源分享与前沿资讯展开讨论。
