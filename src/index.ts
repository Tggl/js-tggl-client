import fetch from 'node-fetch'

export class TgglClient {
  private flags: Record<string, any> = {}
  private context: Record<string, any> = {}

  constructor(private apiKey: string) {
    if (apiKey === undefined) {
      throw new Error('Could not create Tggl client, missing API Key')
    }

    if (typeof apiKey !== 'string') {
      throw new Error('Could not create Tggl client, API Key must be a string')
    }

    if (!apiKey) {
      throw new Error('Could not create Tggl client, API Key cannot be empty')
    }
  }

  async setContext(context: Record<string, any>) {
    if (context === undefined) {
      throw new Error('Could not set Tggl context, context is missing')
    }

    if (typeof context !== 'object' || context === null) {
      throw new Error('Could not set Tggl context, context must be an object')
    }

    if (Array.isArray(context)) {
      throw new Error('Could not set Tggl context, context cannot be an array')
    }

    this.context = context

    const response = await fetch('https://api.tggl.io/flags', {
      method: 'post',
      body: JSON.stringify(context),
      headers: {
        'x-tggl-api-key': this.apiKey,
      },
    })

    let json: any = {}

    try {
      json = await response.json()
    } catch (error) {}

    if (!response.ok) {
      throw new Error(
        `Invalid response from Tggl: ${json.error || response.statusText}`
      )
    }

    this.flags = json
  }

  isActive(slug: string) {
    return this.flags[slug] !== undefined
  }

  get<T>(slug: string): T | undefined
  get<T>(slug: string, defaultValue: T): T
  get<T>(slug: string, defaultValue?: T): T {
    return this.flags[slug] === undefined ? defaultValue : this.flags[slug]
  }
}
