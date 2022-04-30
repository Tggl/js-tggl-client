import axios from 'axios'

export class TgglClient {
  private flags: Record<string, any> = {}
  private context: Record<string, any> = {}
  private url: string

  constructor(private apiKey: string, options: { url?: string } = {}) {
    if (apiKey === undefined) {
      throw new Error('Could not create Tggl client, missing API Key')
    }

    if (typeof apiKey !== 'string') {
      throw new Error('Could not create Tggl client, API Key must be a string')
    }

    if (!apiKey) {
      throw new Error('Could not create Tggl client, API Key cannot be empty')
    }

    this.url = options.url ?? 'https://api.tggl.io/flags'
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

    try {
      const response = await axios({
        method: 'post',
        url: this.url,
        data: JSON.stringify(context),
        headers: {
          'x-tggl-api-key': this.apiKey,
        },
      })

      this.flags = response.data
    } catch (error) {
      throw new Error(
        `Invalid response from Tggl: ${
          error.response?.data?.error || error.response?.statusText
        }`
      )
    }
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
