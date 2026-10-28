import { ResourceError } from '../resources/resourceApi'

export type CurrentUser = { email: string; role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE' }

export async function loadCurrentUser(token: string, signal: AbortSignal): Promise<CurrentUser> {
  let response: Response
  try {
    response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', signal })
  } catch { throw new ResourceError('Unable to load your account. Check your connection and try again.') }
  if (response.status === 401) throw new ResourceError('Please sign in again to continue.', 401)
  if (response.status === 403) throw new ResourceError('Access denied. Your account details are unavailable.', 403)
  if (!response.ok) throw new ResourceError('Unable to load your account. Please try again later.')
  let data: unknown
  try { data = await response.json() } catch { throw new ResourceError('Unexpected account response. Please try again later.') }
  if (typeof data !== 'object' || data === null || !('email' in data) || typeof data.email !== 'string'
    || !/^[^\s@]+@[^\s@]+$/.test(data.email) || !('role' in data)
    || (data.role !== 'ADMIN' && data.role !== 'MANAGER' && data.role !== 'EMPLOYEE')) {
    throw new ResourceError('Unexpected account response. Please try again later.')
  }
  return { email: data.email, role: data.role }
}
