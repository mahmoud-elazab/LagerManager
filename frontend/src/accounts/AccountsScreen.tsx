import { useCallback, useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import type { LoginResponse } from '../auth/loginApi'
import { accountRoles, validAccountInput } from '../auth/accountValidation'
import type { AccountRole } from '../auth/accountValidation'
import { ResourceError } from '../resources/resourceApi'
import { loadAccounts, saveAccount } from './accountsApi'
import type { Account } from './accountsApi'

type Props = { session: LoginResponse; expireSession: (session: LoginResponse) => void; logout: () => void; currentEmail: string }
type State = { kind: 'loading' } | { kind: 'ready'; rows: Account[] } | { kind: 'error'; message: string; retry: boolean }

export function AccountsScreen(props: Props) {
  const { session, expireSession } = props
  const [stored, setStored] = useState<{ session: LoginResponse; state: State }>({ session, state: { kind: 'loading' } })
  const state: State = stored.session === session ? stored.state : { kind: 'loading' }
  const [attempt, setAttempt] = useState(0)
  const [selection, setSelection] = useState<{ session: LoginResponse; record: Account | null } | null>(null)
  const [message, setMessage] = useState('')
  const form = selection?.session === session ? selection : null
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    loadAccounts(session.token, controller.signal).then((rows) => {
      if (active) setStored({ session, state: { kind: 'ready', rows } })
    }).catch((failure: unknown) => {
      if (!active) return
      if (failure instanceof ResourceError && failure.status === 401) expireSession(session)
      else setStored({ session, state: { kind: 'error', message: failure instanceof ResourceError ? failure.message : 'Unable to load accounts.',
        retry: !(failure instanceof ResourceError && failure.status === 403) } })
    })
    return () => { active = false; controller.abort() }
  }, [session, expireSession, attempt])
  function reload() {
    setSelection(null)
    setStored({ session, state: { kind: 'loading' } })
    setAttempt(value => value + 1)
  }
  const focusHeading = useCallback((element: HTMLHeadingElement | null) => element?.focus(), [])
  return <div className="products-screen">
    <header className="products-header"><h2 tabIndex={-1} ref={focusHeading}>Accounts</h2></header>
    {message && <p role="status">{message}</p>}
    {state.kind === 'loading' && <p role="status">Loading accounts…</p>}
    {state.kind === 'error' && <div><p role="alert" className="form-error">{state.message}</p>
      {state.retry && <button onClick={reload}>Retry</button>}</div>}
    {state.kind === 'ready' && <>
      {!form && <div className="create-panel"><button className="button-primary" onClick={() => {
        setMessage(''); setSelection({ session, record: null })
      }}>Add account</button></div>}
      {form && <AccountForm key={form.record?.id ?? 'new'} {...props} record={form.record}
        cancel={() => setSelection(null)} reload={reload} saved={(account) => {
          if (account.email === props.currentEmail && (!account.enabled || account.role !== 'ADMIN')) { props.logout(); return }
          setMessage('Account saved.'); reload()
        }} />}
      {state.rows.length === 0 ? <p role="status">No accounts found.</p> : <div className="table-scroll" role="region" aria-label="Accounts list" tabIndex={0}>
        <table aria-label="Accounts"><thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Enabled</th>
          <th scope="col" className="actions-cell">Actions</th></tr></thead>
          <tbody>{state.rows.map(row => <tr key={row.id}><td>{row.email}</td><td>{row.role}</td><td>{row.enabled ? 'Yes' : 'No'}</td>
            <td className="actions-cell"><button disabled={!!form} aria-label={`Edit ${row.email}`} onClick={() => {
              setMessage(''); setSelection({ session, record: row })
            }}>Edit</button></td></tr>)}</tbody></table>
      </div>}
    </>}
  </div>
}

type FormProps = Props & { record: Account | null; saved: (account: Account) => void; cancel: () => void; reload: () => void }
function AccountForm({ record, session, expireSession, currentEmail, saved, cancel, reload }: FormProps) {
  const [email, setEmail] = useState(record?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AccountRole>(record?.role ?? 'EMPLOYEE')
  const [enabled, setEnabled] = useState(record?.enabled ?? true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState(false)
  const busy = useRef(false)
  const scope = useRef<{ active: boolean; controller?: AbortController }>({ active: false })
  useEffect(() => {
    const current = { active: true, controller: undefined as AbortController | undefined }
    scope.current = current
    return () => { current.active = false; current.controller?.abort() }
  }, [session])
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    if (busy.current || blocked) return
    if (!record && !validAccountInput(email, password, role)) {
      setError('Enter a valid email and a nonblank password of at most 72 UTF-8 bytes.'); return
    }
    const current = scope.current
    current.controller = new AbortController()
    busy.current = true; setPending(true); setError('')
    try {
      const account = await saveAccount(record, { email, password, role, enabled }, session.token, current.controller.signal)
      if (!current.active || scope.current !== current) return
      const passwordField = form.elements.namedItem('account-password')
      if (passwordField instanceof HTMLInputElement) passwordField.value = ''
      setPassword('')
      saved(account)
    } catch (failure) {
      if (!current.active || scope.current !== current) return
      if (failure instanceof ResourceError && failure.status === 401) expireSession(session)
      else {
        setError(failure instanceof ResourceError ? failure.message : 'Save could not be confirmed. Reload accounts before trying again.')
        setBlocked(!(failure instanceof ResourceError && [400, 409].includes(failure.status ?? 0)))
      }
    } finally {
      if (current.active && scope.current === current) { busy.current = false; setPending(false) }
    }
  }
  return <section className="create-panel" aria-label={record ? 'Edit account' : 'Add account'}>
    <form onSubmit={save} noValidate aria-busy={pending}>
      <h3>{record ? `Edit ${record.email}` : 'Add account'}</h3>
      {record?.email === currentEmail && <p>Your session will end if you disable your account or change its role from Admin.</p>}
      {!record && <>
        <div className="form-field"><label htmlFor="account-email">Email</label>
          <input id="account-email" type="email" autoComplete="off" required value={email} disabled={pending || blocked} onChange={event => setEmail(event.target.value)} /></div>
        <div className="form-field"><label htmlFor="account-password">Password</label>
          <input id="account-password" type="password" autoComplete="new-password" required value={password} disabled={pending || blocked} onChange={event => setPassword(event.target.value)} /></div>
      </>}
      <div className="form-field"><label htmlFor="account-role">Role</label><select id="account-role" value={role} disabled={pending || blocked}
        onChange={event => setRole(event.target.value as AccountRole)}>{accountRoles.map(value => <option key={value}>{value}</option>)}</select></div>
      <div className="form-field"><label htmlFor="account-enabled">Enabled</label><select id="account-enabled" value={String(enabled)} disabled={pending || blocked}
        onChange={event => setEnabled(event.target.value === 'true')}><option value="true">Yes</option><option value="false">No</option></select></div>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="quantity-actions"><button type="submit" disabled={pending || blocked}>{pending ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={pending} onClick={cancel}>Cancel</button></div>
      {blocked && <button type="button" onClick={reload}>Reload accounts</button>}
    </form>
  </section>
}
