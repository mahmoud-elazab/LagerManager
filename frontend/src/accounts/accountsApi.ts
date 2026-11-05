import type { AccountRole } from '../auth/accountValidation'
import { isAccountRole } from '../auth/accountValidation'
import { ResourceError, validRecordId } from '../resources/resourceApi'

export type Account = { id: number; email: string; role: AccountRole; enabled: boolean }
export type AccountInput = { email: string; password: string; role: AccountRole; enabled: boolean }
export function isAccount(value: unknown): value is Account {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return validRecordId(row.id) && typeof row.email === 'string' && !!row.email.trim()
    && isAccountRole(row.role) && typeof row.enabled === 'boolean'
}
async function request(method: string, path: string, token: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  const mutation = method !== 'GET'
  const uncertain = 'Save could not be confirmed. Reload accounts to check before trying again.'
  let response: Response
  try {
    response = await fetch(path, { method, headers: { Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, credentials: 'omit', signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  } catch { throw new ResourceError(mutation ? uncertain : 'Unable to load accounts. Check your connection and try again.') }
  if (response.status === 401) throw new ResourceError('Please sign in again to continue.', 401)
  if (response.status === 403) throw new ResourceError('Access denied. Only Admins can manage accounts.', 403)
  if (response.status === 400) throw new ResourceError('Check the account details, role and enabled status.', 400)
  if (response.status === 409) throw new ResourceError('An account with this email already exists.', 409)
  if (response.status === 404) throw new ResourceError('This account no longer exists. Reload accounts.', 404)
  if (response.status !== (method === 'POST' ? 201 : 200)) {
    throw new ResourceError(mutation ? uncertain : 'Unable to load accounts. Please try again later.')
  }
  try { return await response.json() } catch {
    throw new ResourceError(mutation ? uncertain : 'Unexpected account response. Please try again later.')
  }
}
export async function loadAccounts(token: string, signal: AbortSignal): Promise<Account[]> {
  const data = await request('GET', '/api/accounts', token, signal)
  if (!Array.isArray(data) || !data.every(isAccount)) throw new ResourceError('Unexpected account response. Please try again later.')
  return data
}
export async function saveAccount(record: Account | null, input: AccountInput, token: string, signal: AbortSignal): Promise<Account> {
  const data = record ? await request('PUT', `/api/accounts/${record.id}`, token, signal, { role: input.role, enabled: input.enabled })
    : await request('POST', '/api/accounts', token, signal, input)
  if (!isAccount(data) || (record && data.id !== record.id) || data.email !== (record?.email ?? input.email)
    || data.role !== input.role || data.enabled !== input.enabled) {
    throw new ResourceError('Save could not be confirmed. Reload accounts to check before trying again.')
  }
  return data
}
