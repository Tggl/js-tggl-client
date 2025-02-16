export const apiCall = ({
  apiKey,
  body,
  url,
  method,
}: {
  url: string
  method: 'post' | 'get'
  apiKey?: string | null
  body?: any
}): Promise<unknown> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('Request timed out'), 10_000)

  return fetch(url, {
    method,
    signal: controller.signal,
    body: body ? JSON.stringify(body) : undefined,
    headers:
      body && apiKey
        ? {
            'Content-Type': 'application/json',
            'x-tggl-api-key': apiKey,
          }
        : body
        ? {
            'Content-Type': 'application/json',
          }
        : apiKey
        ? {
            'x-tggl-api-key': apiKey,
          }
        : {},
  }).then(async (r) => {
    clearTimeout(timer)

    if (r.ok) {
      return r.json()
    }

    throw await r.json()
  })
}
