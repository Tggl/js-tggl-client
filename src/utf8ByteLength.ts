/** UTF-8 byte length of a string (works in browsers and Node without Buffer). */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
