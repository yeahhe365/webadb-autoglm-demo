import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createOpenAiProxyHandler } from './openAiProxy.js'

const servers = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
})

describe('createOpenAiProxyHandler', () => {
  it('forwards a local proxy request to the configured OpenAI-compatible base URL', async () => {
    const upstreamRequests = []
    const upstreamUrl = await listen((request, response) => {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        upstreamRequests.push({
          url: request.url,
          authorization: request.headers.authorization,
          contentType: request.headers['content-type'],
          body: JSON.parse(body),
        })
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ choices: [{ message: { content: '{"action":"done"}' } }] }))
      })
    })
    const proxyUrl = await listen(createOpenAiProxyHandler())

    const response = await fetch(`${proxyUrl}/api/openai/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: `${upstreamUrl}/v1`,
        apiKey: 'secret',
        payload: {
          model: 'agent-model',
          messages: [{ role: 'user', content: 'hello' }],
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      choices: [{ message: { content: '{"action":"done"}' } }],
    })
    expect(upstreamRequests).toEqual([
      {
        url: '/v1/chat/completions',
        authorization: 'Bearer secret',
        contentType: 'application/json',
        body: {
          model: 'agent-model',
          messages: [{ role: 'user', content: 'hello' }],
        },
      },
    ])
  })

  it('rejects proxy requests without a valid payload', async () => {
    const proxyUrl = await listen(createOpenAiProxyHandler())

    const response = await fetch(`${proxyUrl}/api/openai/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { message: 'Request payload must be an object.' },
    })
  })

  it('rejects proxy requests with an unsupported base URL protocol', async () => {
    const proxyUrl = await listen(createOpenAiProxyHandler())

    const response = await fetch(`${proxyUrl}/api/openai/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'file:///tmp/model-api',
        apiKey: 'secret',
        payload: { model: 'agent-model' },
      }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: { message: 'Base URL must use http or https.' },
    })
  })

  it('rejects proxy requests that exceed the configured body limit', async () => {
    const proxyUrl = await listen(createOpenAiProxyHandler(fetch, { maxBodyBytes: 24 }))

    const response = await fetch(`${proxyUrl}/api/openai/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        payload: { model: 'agent-model' },
      }),
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      error: { message: 'Request body is too large.' },
    })
  })

  it('aborts the upstream model request when the client disconnects', async () => {
    let upstreamSignal
    const upstreamStarted = deferred()
    const upstreamAborted = deferred()
    const fetcher = async (_url, init) => {
      upstreamSignal = init.signal
      upstreamStarted.resolve()
      return new Promise((_resolve, reject) => {
        upstreamSignal.addEventListener(
          'abort',
          () => {
            upstreamAborted.resolve()
            const error = new Error('upstream aborted')
            error.name = 'AbortError'
            reject(error)
          },
          { once: true },
        )
      })
    }
    const proxyUrl = await listen(createOpenAiProxyHandler(fetcher))
    const controller = new AbortController()

    const request = fetch(`${proxyUrl}/api/openai/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'secret',
        payload: { model: 'agent-model', messages: [{ role: 'user', content: 'hello' }] },
      }),
    }).catch((error) => error)

    await upstreamStarted.promise
    expect(upstreamSignal.aborted).toBe(false)

    controller.abort()

    await upstreamAborted.promise
    await expect(request).resolves.toEqual(expect.objectContaining({ name: 'AbortError' }))
  })
})

function listen(handler) {
  const server = createServer(handler)
  servers.push(server)

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not bind test server.'))
        return
      }
      resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
