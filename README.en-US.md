# WebADB AutoGLM

WebADB AutoGLM is a fully frontend Android phone agent experiment. It connects to an Android device from the browser through WebUSB/WebADB, captures the device screen, sends it to an OpenAI-compatible vision model, then parses, validates, and executes the model's constrained action through ADB.

The goal is not to replace long-running human supervision. It is a local browser environment for quickly validating the vision-model-plus-phone-control loop.

```text
Chromium WebUSB -> Tango/WebADB -> Android ADB
browser fetch -> OpenAI-compatible /v1/chat/completions -> vision model
```

## What It Can Do

- Run entirely on the frontend, with no application backend.
- Connect to an Android device with USB debugging enabled through WebADB in the browser.
- Capture the phone screen and send the screenshot, current app, device state, and step history to the model.
- Support both canonical JSON and Open-AutoGLM-style prompt/action formats.
- Parse, normalize, and validate the next action returned by the model.
- Execute app launches, taps, swipes, text input, Back, Home, long press, double tap, and wait actions through ADB.
- Support continuous auto-execution as well as step-by-step human confirmation.
- Support sensitive-action confirmation, max-step limits, stop controls, session reset, and run-log export.
- Persist page settings in the local browser `localStorage`.

## Good Fits

This project is a good fit for:

- Testing whether an OpenAI-compatible vision model can understand real Android UI.
- Debugging phone-agent action protocols, coordinate mapping, and auto-execution loops.
- Exploring compatibility between Open-AutoGLM-style actions and more general JSON actions.
- Building Android UI automation prototypes in a local and controlled environment.

It is not a good fit for:

- Payments, checkout flows, deletions, authorization, or account settings.
- Login, captcha, password, or verification-code flows that need explicit human intervention.
- Production use cases that require a backend, long-running reliability, or multi-device orchestration.

## Flow

1. Open the app in a Chromium-based browser.
2. Connect an Android device with USB debugging enabled and authorize ADB on the phone.
3. Fill in the OpenAI-compatible `Base URL`, `API Key`, and `Model`.
4. Enter a natural-language task such as "Open Settings and go to Wi-Fi".
5. Start a single step or auto-run session.
6. The app captures the screen and asks the model for one action.
7. The frontend parses and validates the action, then auto-executes or waits for confirmation depending on settings.
8. The loop continues until the model returns `done`, requests `take_over`, the max step count is reached, or the user stops execution.

## Requirements

- A Chromium-based browser with WebUSB support, such as Chrome or Edge.
- An Android device with USB debugging enabled.
- A USB data cable.
- An OpenAI-compatible `/v1/chat/completions` API.
- A vision model that accepts `image_url` input.
- An API service configured to allow browser cross-origin requests.
- A `localhost` or HTTPS environment so WebUSB can work.

## Quick Start

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite in Chrome or Edge.

Common commands:

```bash
npm test
npm run lint
npm run build
npm run preview
```

## Configuration

The app stores these values in the current browser's `localStorage`:

- `Base URL`: OpenAI-compatible API endpoint, default `https://api.openai.com/v1`.
- `API Key`: model API key.
- `Model`: model name, default `gpt-5.5`.
- `Task`: current natural-language task.
- `Max steps`: maximum auto-execution steps, default `50`.
- `Auto execute`: whether safe model actions are executed automatically, default on.
- `Prompt mode`: `canonical-json` or `autoglm-native`.
- `Confirm sensitive actions`: whether sensitive taps require human confirmation, default on.
- `Stream responses`: whether to use streaming responses, default off.
- `Use ADB Keyboard for text`: whether to prefer ADB Keyboard input, default off.
- `Action settle`, `Double tap interval`, `Keyboard step`: timing controls for action execution and text input.

The API key stays in the browser only. Use this on trusted devices and in local experimentation only.

## Action Protocol

The model should return a single JSON object and avoid Markdown or explanatory prose:

```json
{ "action": "tap", "x": 540, "y": 1280, "reason": "Click the search box" }
```

Supported canonical JSON actions:

| Action | Meaning |
| --- | --- |
| `launch` | Launch an app by common app name or package name |
| `tap` | Tap a screen coordinate |
| `swipe` | Swipe from one point to another |
| `input_text` | Type text |
| `key` | Send an Android key such as `BACK`, `HOME`, or `ENTER` |
| `back` | Navigate back |
| `home` | Return to the home screen |
| `long_press` | Long-press a coordinate |
| `double_tap` | Double-tap a coordinate |
| `wait` | Wait for a duration |
| `take_over` | Request human takeover |
| `interact` | Ask a human to make a choice or provide input |
| `note` | Record an observation without touching the device |
| `call_api` | Ask for summary or analysis of recorded context |
| `done` | Mark the task as complete |

Examples:

```json
{ "action": "launch", "app": "Settings", "reason": "Open system settings" }
```

```json
{ "action": "swipe", "fromX": 540, "fromY": 1700, "toX": 540, "toY": 500, "durationMs": 400, "reason": "Scroll the list down" }
```

```json
{ "action": "take_over", "message": "The user needs to enter a verification code" }
```

## Open-AutoGLM Compatibility

The parser also accepts Open-AutoGLM-style action names and payloads, including:

- `Launch`
- `Tap`, including `element: [x, y]` relative coordinates
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

It also accepts function-style outputs such as:

```text
do(action="Launch", app="JD")
```

Open-AutoGLM coordinates use the `0-1000` relative coordinate space; canonical JSON uses screenshot pixel coordinates. The app maps them back to native device coordinates before execution.

## Device Control Details

- Launching apps: use the built-in common app-name mapping or pass an Android package name directly.
- Tap and swipe: coordinates are validated against the screen bounds before execution.
- Long press: simulated with Android `input swipe x y x y duration`.
- Double tap: two taps with a configurable delay in between.
- Text input: simple ASCII text uses Android `input text`.
- Chinese and complex text: can use the ADB Keyboard broadcast method.
- ADB Keyboard mode requires `com.android.adbkeyboard/.AdbIME` to be installed and enabled on the device.

## Safety Boundaries

The frontend tries to constrain and confirm actions before execution:

- Model output must parse into a supported action.
- Coordinates are checked against the screen bounds.
- Text input is length-limited and control characters are rejected.
- Auto-execution has a maximum step count.
- The user can stop the run at any time.
- Sensitive taps can require human confirmation.
- `take_over`, `interact`, `note`, `call_api`, and `done` do not directly control the device.

It is still strongly recommended to avoid letting the agent handle account login, payments, checkout, deletions, authorization, verification codes, or privacy-sensitive pages. When the model returns `take_over`, auto-execution stops and waits for a human.

## Project Structure

```text
src/
  adapters/
    deviceBackend.ts          # device backend interface
    webAdbBackend.ts          # WebADB/WebUSB implementation
    screenshotPreprocess.ts   # screenshot preprocessing
  components/
    RunLog.tsx                # run log view
  lib/
    actions.ts                # action parsing, normalization, and validation
    agent.ts                  # agent loop orchestration
    openAiClient.ts           # OpenAI-compatible request building and response reading
    prompts.ts                # prompts and action rules
    screenshotCoordinates.ts  # screenshot coordinate mapping
    settings.ts               # local settings persistence
  App.tsx                     # main page state and interaction
```

## Verification

```bash
npm test
npm run lint
npm run build
```

The current tests mainly cover:

- Action parsing and action safety validation.
- OpenAI-compatible request construction.
- Single-step and continuous agent execution.
- Settings persistence and compatibility migration.
- Screenshot coordinate mapping.
- The run-log component.

Real-device control still needs manual verification with an Android device.

## Deploying to Cloudflare Pages

The project is already set up on Cloudflare Pages:

- Live site: https://webadb-autoglm.pages.dev/
- Deployment method: automatic deployment from GitHub

Redeploy:

```bash
git push origin main
```

You can also verify the build locally first:

```bash
npm run build
```

## Related Projects and Community

- [Tango / WebADB](https://github.com/yume-chan/ya-webadb): the browser-side ADB/WebUSB foundation.
- Open-AutoGLM: an important reference for mobile GUI agent action protocols.
- Linux.do: an active Chinese tech community centered on AI, software development, resource sharing, and current industry discussion.
