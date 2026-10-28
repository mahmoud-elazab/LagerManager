import { useState } from 'react'
import type { SubmitEvent } from 'react'
import type { LoginInput } from './loginApi'

type LoginFormProps = {
  signIn: (input: LoginInput) => Promise<boolean>
  pending: boolean
  error: string
}

export function LoginForm({ signIn, pending, error }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    if (await signIn({ email, password })) {
      // Also scrub the field if the signed-in screen has already unmounted this form.
      const passwordField = form.elements.namedItem('password')
      if (passwordField instanceof HTMLInputElement) passwordField.value = ''
      setPassword('')
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={pending} aria-describedby={error ? 'login-error' : undefined}>
      <h2>Sign in</h2>
      <div className="form-field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required
          value={email} onChange={(event) => setEmail(event.target.value)} disabled={pending} />
      </div>
      <div className="form-field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required
          value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending} />
      </div>
      {error && <p id="login-error" className="form-error" role="alert">{error}</p>}
      <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
      <p className="form-hint" role="status">{pending ? 'Signing in. Please wait.' : ''}</p>
    </form>
  )
}
