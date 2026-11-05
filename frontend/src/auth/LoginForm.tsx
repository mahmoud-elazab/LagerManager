import { useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import { validAccountInput } from './accountValidation'
import type { LoginInput } from './loginApi'

type LoginFormProps = {
  signIn: (input: LoginInput) => Promise<boolean>
  pending: boolean
  error: string
}

export function LoginForm({ signIn, pending, error }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [registering, setRegistering] = useState(false)
  const [role, setRole] = useState('EMPLOYEE')
  const [registrationPending, setRegistrationPending] = useState(false)
  const [registrationError, setRegistrationError] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const submitting = useRef(false)
  const busy = pending || registrationPending
  const visibleError = registering ? registrationError : confirmation ? '' : error

  async function register() {
    if (submitting.current) return
    setRegistrationError('')
    if (!validAccountInput(email, password, role)) {
      setRegistrationError('Enter a valid email, a nonblank password of at most 72 UTF-8 bytes, and a role.')
      return
    }
    submitting.current = true
    setRegistrationPending(true)
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
        body: JSON.stringify({ email, password, role }),
      })
      if (response.status === 409) {
        setRegistrationError('An account with this email already exists.')
      } else if (response.status === 400) {
        setRegistrationError('Enter a valid email, a nonblank password of at most 72 UTF-8 bytes, and a role.')
      } else if (response.status === 201) {
        const data: unknown = await response.json()
        if (!data || typeof data !== 'object' || !('email' in data) || data.email !== email) {
          throw new Error('Unexpected response')
        }
        setPassword('')
        setRegistering(false)
        setConfirmation('Registration successful. Sign in with your new account.')
      } else {
        setRegistrationError('Registration could not be confirmed. Try signing in before registering again.')
      }
    } catch {
      setRegistrationError('Registration could not be confirmed. Check your connection and try signing in before registering again.')
    } finally {
      submitting.current = false
      setRegistrationPending(false)
    }
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (registering) { await register(); return }
    setConfirmation('')
    const form = event.currentTarget
    if (await signIn({ email, password })) {
      // Also scrub the field if the signed-in screen has already unmounted this form.
      const passwordField = form.elements.namedItem('password')
      if (passwordField instanceof HTMLInputElement) passwordField.value = ''
      setPassword('')
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={busy} aria-describedby={visibleError ? 'login-error' : undefined}>
      <h2>{registering ? 'Registration' : 'Sign in'}</h2>
      <div className="form-field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required
          value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
      </div>
      <div className="form-field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} required
          value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
      </div>
      {registering && <div className="form-field">
        <label htmlFor="role">Role</label>
        <select id="role" value={role} onChange={(event) => setRole(event.target.value)} disabled={busy} required>
          <option value="ADMIN">Admin</option><option value="MANAGER">Manager</option><option value="EMPLOYEE">Employee</option>
        </select>
      </div>}
      {visibleError && <p id="login-error" className="form-error" role="alert">{visibleError}</p>}
      {confirmation && <p role="status">{confirmation}</p>}
      <button type="submit" disabled={busy}>{registering ? (registrationPending ? 'Registering…' : 'Register') : pending ? 'Signing in…' : 'Sign in'}</button>
      <button type="button" disabled={busy} onClick={() => {
        setRegistering(!registering); setPassword(''); setRegistrationError(''); setConfirmation('')
      }}>{registering ? 'Back to sign in' : 'Registration'}</button>
      <p className="form-hint" role="status">{pending ? 'Signing in. Please wait.' : ''}</p>
    </form>
  )
}
