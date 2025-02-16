import http from 'http'
import https from 'https'

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
  const httpModule = url.startsWith('https') ? https : http

  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : ''
    let timer: number | undefined = undefined

    const req = httpModule.request(
      url,
      {
        method,
        headers:
          body && apiKey
            ? {
                'x-tggl-api-key': apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
              }
            : body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
              }
            : apiKey
            ? {
                'x-tggl-api-key': apiKey,
              }
            : {},
      },
      (res) => {
        let data = ''

        res.on('data', (chunk) => (data += chunk))

        res.on('end', () => {
          clearTimeout(timer)

          try {
            if (res.statusCode !== 200) {
              reject(JSON.parse(data))
            } else {
              resolve(JSON.parse(data))
            }
          } catch (error) {
            if (error instanceof SyntaxError) {
              reject(data)
            }
            reject(error)
          }
        })
      }
    )

    req.on('error', reject)
    if (body) {
      req.write(postData)
    }
    req.end()

    // @ts-ignore
    timer = setTimeout(() => {
      req.destroy()
      reject({ error: 'Request timed out' })
    }, 10_000)
  })
}
