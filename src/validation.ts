export const assertValidContext = (context: any) => {
  if (context === undefined || context === null) {
    throw new Error('Invalid Tggl context, context is missing')
  }

  if (typeof context !== 'object') {
    throw new Error('Invalid Tggl context, context must be an object')
  }

  if (Array.isArray(context)) {
    throw new Error('Invalid Tggl context, context cannot be an array')
  }
}

export const checkApiKey = (apiKey: any) => {
  if (apiKey === undefined) {
    console.error('Could not properly create Tggl client, missing API Key')
  }

  if (typeof apiKey !== 'string') {
    console.error(
      'Could not properly create Tggl client, API Key must be a string'
    )
  }

  if (!apiKey) {
    console.error(
      'Could not properly create Tggl client, API Key cannot be empty'
    )
  }
}
