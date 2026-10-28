export type LoginInput = {
  email: string
  password: string
}

export type LoginResponse = {
  token: string
  tokenType: 'Bearer'
}

export class LoginError extends Error {}

export async function loginRequest(input: LoginInput): Promise<LoginResponse> {
  let response: Response
  try {
    response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify(input),
    })
  } catch {
    throw new LoginError('Unable to connect. Check your connection and try again.')
  }

  if (response.status === 401) {
    throw new LoginError('Sign in failed. Check your email and password.')
  }
  if (response.status === 400) {
    throw new LoginError('Enter a valid email and password.')
  }
  if (!response.ok) {
    throw new LoginError('The server could not complete sign in. Please try again later.')
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new LoginError('Unexpected server response. Please try again later.')
  }
  if (typeof data !== 'object' || data === null || !('token' in data)
    || typeof data.token !== 'string' || !data.token.trim() || /\s/.test(data.token)
    || !('tokenType' in data) || data.tokenType !== 'Bearer') {
    throw new LoginError('Unexpected server response. Please try again later.')
  }
  return { token: data.token, tokenType: 'Bearer' }
}
