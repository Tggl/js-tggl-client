import type { request } from 'http'

export const apiCall = ({
  apiKey,
  body,
  url,
  method,
}: {
  url: string
  method: 'post' | 'get'
  apiKey: string
  body?: any
}) => {
  if (typeof fetch !== 'undefined') {
    return fetch(url, {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: body
        ? {
            'Content-Type': 'application/json',
            'x-tggl-api-key': apiKey,
          }
        : {
            'x-tggl-api-key': apiKey,
          },
    }).then(async (r) => {
      if (r.ok) {
        return r.json()
      }

      throw await r.json()
    })
  } else {
    const httpModule: { request: typeof request } = url.startsWith('https')
      ? require('https')
      : require('http')

    return new Promise((resolve, reject) => {
      const postData = body ? JSON.stringify(body) : ''

      const req = httpModule.request(
        url,
        {
          method,
          headers: body
            ? {
                'x-tggl-api-key': apiKey,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
              }
            : {
                'x-tggl-api-key': apiKey,
              },
        },
        (res) => {
          let data = ''

          res.on('data', (chunk) => (data += chunk))

          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                reject(JSON.parse(data))
              } else {
                resolve(JSON.parse(data))
              }
            } catch (error) {
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
    })
  }
}
