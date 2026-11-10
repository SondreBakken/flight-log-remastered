export function classes(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(' ')
}
