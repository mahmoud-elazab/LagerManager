import { useRef, useState } from 'react'
import { LoginError, loginRequest } from './loginApi'
import type { LoginInput, LoginResponse } from './loginApi'

export function useAuth() {
  const [session, setSession] = useState<LoginResponse | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)

  async function signIn(input: LoginInput): Promise<boolean> {
    if (submitting.current) return false
    if (!input.email.trim() || !input.password || /^\s+$/.test(input.password)) {
      setError('Enter a valid email and password.')
      return false
    }
    submitting.current = true
    setPending(true)
    setError('')
    try {
      const response = await loginRequest(input)
      setSession(response)
      return true
    } catch (failure) {
      setError(failure instanceof LoginError ? failure.message : 'Unable to sign in. Please try again.')
      return false
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  function logout() {
    setSession(null)
    setError('')
  }

  return { signedIn: session !== null, signIn, logout, pending, error }
}
