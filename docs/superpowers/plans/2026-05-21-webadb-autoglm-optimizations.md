# WebADB AutoGLM Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the browser-only phone agent closer to Open-AutoGLM behavior while keeping the pure WebUSB frontend architecture.

**Architecture:** Add an in-browser agent session that carries text history across steps while sending only the current screenshot. Extend the device backend with current-app introspection and sensitive-action confirmation metadata, then surface timing/log export in the React console.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, yume-chan WebADB.

---

### Task 1: Agent Context And Prompt

**Files:**
- Create: `src/lib/prompts.ts`
- Modify: `src/lib/openAiClient.ts`
- Modify: `src/lib/agent.ts`
- Test: `src/lib/openAiClient.test.ts`
- Test: `src/lib/agent.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that build a payload containing `current_app`, step history, execution result, and Open-AutoGLM operating rules.

- [x] **Step 2: Verify tests fail**

Run: `npm test -- src/lib/openAiClient.test.ts src/lib/agent.test.ts`

Expected: failures because `currentApp`, `history`, and session state are not implemented.

- [x] **Step 3: Implement minimal code**

Create a prompt module, add `AgentSession`, pass session history to `completeAction`, and store assistant/action history after each execution.

- [x] **Step 4: Verify tests pass**

Run: `npm test -- src/lib/openAiClient.test.ts src/lib/agent.test.ts`

Expected: all tests in those files pass.

### Task 2: Device Current App And Sensitive Confirmation

**Files:**
- Modify: `src/adapters/deviceBackend.ts`
- Modify: `src/adapters/webAdbBackend.ts`
- Modify: `src/lib/actions.ts`
- Test: `src/adapters/deviceBackend.test.ts`
- Test: `src/lib/actions.test.ts`

- [x] **Step 1: Write failing tests**

Add tests for parsing `dumpsys window` output, canonicalizing sensitive tap metadata, and blocking sensitive actions when confirmation is denied.

- [x] **Step 2: Verify tests fail**

Run: `npm test -- src/adapters/deviceBackend.test.ts src/lib/actions.test.ts`

Expected: failures because current-app parsing and confirmation policy are missing.

- [x] **Step 3: Implement minimal code**

Expose `getCurrentApp`, parse focused package names, map packages to labels, add tap confirmation metadata, and allow device execution to call a confirmation callback before tap.

- [x] **Step 4: Verify tests pass**

Run: `npm test -- src/adapters/deviceBackend.test.ts src/lib/actions.test.ts`

Expected: all tests in those files pass.

### Task 3: UI Observability

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `src/lib/settings.ts`
- Test: `src/lib/settings.test.ts`

- [x] **Step 1: Write failing tests**

Add settings tests for model profile and observability preferences.

- [x] **Step 2: Verify tests fail**

Run: `npm test -- src/lib/settings.test.ts`

Expected: failures because new settings are missing.

- [x] **Step 3: Implement minimal code**

Show current app, model/action timing, session log export, prompt mode selection, and confirmation flow in the React console.

- [x] **Step 4: Verify tests pass**

Run: `npm test -- src/lib/settings.test.ts`

Expected: settings tests pass.

### Final Verification

- [x] Run `npm test`
- [x] Run `npm run build`
- [x] Run `npm run lint`
- [x] Review `git diff --stat` and changed files.
