import { TgglStorage } from './types.js';

const hasLocalStorage = Boolean(
  // @ts-expect-error only works in browser
  typeof window !== 'undefined' && window.localStorage
);

export const localStorageStorage: TgglStorage = {
  get(): string | null {
    if (hasLocalStorage) {
      // @ts-expect-error only works in browser
      return window.localStorage.getItem('tggl-flags') as string;
    }

    return null;
  },
  set(value: string) {
    if (hasLocalStorage) {
      // @ts-expect-error only works in browser
      window.localStorage.setItem('tggl-flags', value);
    }
  },
};
