import { useCallback, useRef, useState } from 'react'
import { LoginError, loginRequest } from './loginApi'
import type { LoginInput, LoginResponse } from './loginApi'

export function useAuth() {
  const [session, setSession] = useState<LoginResponse | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  const currentSession = useRef<LoginResponse | null>(null)

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
      currentSession.current = response
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
    currentSession.current = null
    setSession(null)
    setError('')
  }

  const expireSession = useCallback((expected: LoginResponse) => {
    if (currentSession.current !== expected) return
    currentSession.current = null
    setSession(null)
    setError('Please sign in again to continue.')
  }, [])

  return { session, signIn, logout, expireSession, pending, error }
}
