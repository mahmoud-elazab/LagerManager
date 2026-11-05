export const accountRoles = ['ADMIN', 'MANAGER', 'EMPLOYEE'] as const
export type AccountRole = typeof accountRoles[number]
export function isAccountRole(value: unknown): value is AccountRole {
  return value === 'ADMIN' || value === 'MANAGER' || value === 'EMPLOYEE'
}
export function validAccountInput(email: string, password: string, role: string): boolean {
  // Match email-input syntax while keeping the existing dot-in-domain requirement.
  return email.length <= 255 && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(email)
    && !!password.trim() && new TextEncoder().encode(password).length <= 72 && isAccountRole(role)
}
