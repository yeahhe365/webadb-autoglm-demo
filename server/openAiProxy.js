export const OPENAI_PROXY_PATH = '/api/openai/chat/completions'
export const MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024

export function createOpenAiProxyHandler(fetcher = fetch, options = {}) {
  const maxBodyBytes = options.maxBodyBytes ?? MAX_PROXY_BODY_BYTES

  return async function openAiProxyHandler(request, response) {
    const url = parseRequestUrl(request.url)
    if (!url) {
      sendJson(response, 400, { error: { message: 'Request URL is invalid.' } })
      return
    }

    if (url.pathname !== OPENAI_PROXY_PATH) {
      sendJson(response, 404, { error: { message: 'Not found.' } })
      return
    }

    if (request.method !== 'POST') {
      response.writeHead(405, {
        Allow: 'POST',
        'Content-Type': 'application/json',
      })
      response.end(JSON.stringify({ error: { message: 'Method not allowed.' } }))
      return
    }

    let body
    try {
      body = JSON.parse(await readRequestBody(request, maxBodyBytes))
    } catch (caught) {
      if (isRequestBodyTooLargeError(caught)) {
        sendJson(response, 413, { error: { message: 'Request body is too large.' } })
        return
      }
      sendJson(response, 400, { error: { message: 'Request body must be valid JSON.' } })
      return
    }

    const validationError = validateProxyRequest(body)
    if (validationError) {
      sendJson(response, 400, { error: { message: validationError } })
      return
    }

    const upstreamUrl = `${normalizeBaseUrl(body.baseUrl)}/chat/completions`
    const abortController = new AbortController()
    const abortUpstream = () => {
      if (!abortController.signal.aborted) {
        abortController.abort()
      }
    }
    request.once('aborted', abortUpstream)
    response.once('close', abortUpstream)

    let upstreamResponse
    try {
      upstreamResponse = await fetcher(upstreamUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${body.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: abortController.signal,
        body: JSON.stringify(body.payload),
      })
    } catch (caught) {
      request.off('aborted', abortUpstream)
      response.off('close', abortUpstream)
      if (abortController.signal.aborted) {
        return
      }
      const message = caught instanceof Error ? caught.message : String(caught)
      sendJson(response, 502, { error: { message: `Model API request failed: ${message}` } })
      return
    }

    await forwardUpstreamResponse(response, upstreamResponse, {
      onFinished: () => {
        request.off('aborted', abortUpstream)
        response.off('close', abortUpstream)
      },
    })
  }
}

export function isOpenAiProxyRequest(requestUrl) {
  return parseRequestUrl(requestUrl)?.pathname === OPENAI_PROXY_PATH
}

function validateProxyRequest(body) {
  if (!isRecord(body)) {
    return 'Request body must be an object.'
  }
  if (typeof body.baseUrl !== 'string' || !body.baseUrl.trim()) {
    return 'Base URL is required.'
  }
  if (!isHttpBaseUrl(body.baseUrl)) {
    return 'Base URL must use http or https.'
  }
  if (typeof body.apiKey !== 'string' || !body.apiKey.trim()) {
    return 'API key is required.'
  }
  if (!isRecord(body.payload)) {
    return 'Request payload must be an object.'
  }
  return null
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.trim().replace(/\/+$/, '')
}

function isHttpBaseUrl(baseUrl) {
  try {
    const url = new URL(baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function readRequestBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let body = ''
    let bodyBytes = 0
    let tooLarge = false

    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      if (tooLarge) {
        return
      }
      bodyBytes += Buffer.byteLength(chunk, 'utf8')
      if (bodyBytes > maxBodyBytes) {
        tooLarge = true
        reject(new RequestBodyTooLargeError())
        return
      }
      body += chunk
    })
    request.on('end', () => {
      if (!tooLarge) {
        resolve(body)
      }
    })
    request.on('error', (error) => {
      if (!tooLarge) {
        reject(error)
      }
    })
  })
}

function parseRequestUrl(requestUrl) {
  try {
    return new URL(requestUrl ?? '/', 'http://localhost')
  } catch {
    return null
  }
}

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large.')
    this.name = 'RequestBodyTooLargeError'
  }
}

function isRequestBodyTooLargeError(error) {
  return error instanceof RequestBodyTooLargeError
}

async function forwardUpstreamResponse(response, upstreamResponse, { onFinished } = {}) {
  response.statusCode = upstreamResponse.status
  const contentType = upstreamResponse.headers.get('content-type')
  if (contentType) {
    response.setHeader('Content-Type', contentType)
  }

  if (!upstreamResponse.body) {
    response.end()
    onFinished?.()
    return
  }

  const reader = upstreamResponse.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      response.write(Buffer.from(value))
    }
    response.end()
  } catch (caught) {
    if (!response.destroyed) {
      response.destroy(caught instanceof Error ? caught : new Error(String(caught)))
    }
  } finally {
    onFinished?.()
    reader.releaseLock()
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
