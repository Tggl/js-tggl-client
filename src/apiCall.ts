import ky from 'ky'

export const apiCall = async ({
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
  const postData = body ? JSON.stringify(body) : ''
  const headers: Record<string, any> = {}

  if (apiKey) {
    headers['x-tggl-api-key'] = apiKey
  }
  if (body) {
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = Buffer.byteLength(postData)
  }

  return await ky(url, {
    method,
    body: postData,
    headers,
    timeout: 10_000,
  }).json()
}
