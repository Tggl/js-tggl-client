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
