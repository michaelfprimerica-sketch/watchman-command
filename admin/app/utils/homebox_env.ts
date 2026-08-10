export const HOMEBOX_PEPPER_ENV = 'HBOX_AUTH_API_KEY_PEPPER'

export function findValidHomeboxPepper(env: string[]): string | null {
  const prefix = `${HOMEBOX_PEPPER_ENV}=`
  const value = env.find((entry) => entry.startsWith(prefix))?.slice(prefix.length)
  return value && Buffer.byteLength(value, 'utf8') >= 32 ? value : null
}

export function withHomeboxPepper(env: string[], pepper: string): string[] {
  const prefix = `${HOMEBOX_PEPPER_ENV}=`
  return [...env.filter((entry) => !entry.startsWith(prefix)), `${prefix}${pepper}`]
}
