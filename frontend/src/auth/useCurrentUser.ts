import { useEffect, useState } from 'react'
import type { LoginResponse } from './loginApi'
import { loadCurrentUser } from './currentUserApi'
import type { CurrentUser } from './currentUserApi'
import { ResourceError } from '../resources/resourceApi'

type State = { kind: 'loading' } | { kind: 'ready'; user: CurrentUser } | { kind: 'error'; message: string }
export function useCurrentUser(session: LoginResponse, expireSession: (session: LoginResponse) => void) {
  const [result, setResult] = useState<{ session: LoginResponse; state: State }>({ session, state: { kind: 'loading' } })
  const [attempt, setAttempt] = useState(0)
  const state: State = result.session === session ? result.state : { kind: 'loading' }
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    loadCurrentUser(session.token, controller.signal).then((user) => {
      if (active) setResult({ session, state: { kind: 'ready', user } })
    }).catch((failure: unknown) => {
      if (!active) return
      if (failure instanceof ResourceError && failure.status === 401) expireSession(session)
      else setResult({ session, state: { kind: 'error', message: failure instanceof ResourceError
        ? failure.message : 'Unable to load your account. Please try again.' } })
    })
    return () => { active = false; controller.abort() }
  }, [session, expireSession, attempt])
  function retry() {
    setResult({ session, state: { kind: 'loading' } })
    setAttempt((value) => value + 1)
  }
  return { state, retry }
}
