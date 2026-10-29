import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import type { LoginResponse } from '../auth/loginApi'
import { recordMovement } from './stockApi'
import type { MovementType } from './stockApi'
import { ResourceError, updateInventoryQuantity } from './resourceApi'

type Props = {
  initialEditing?: boolean
  onEdit?: () => void
  onFinish?: () => void
  id: number
  quantity: number
  session: LoginResponse
  expireSession: (session: LoginResponse) => void
  saved: (id: number, quantity: number) => void
  reload: () => void
}

export function QuantityEditor({ id, quantity, session, expireSession, saved, reload, initialEditing = false, onEdit, onFinish }: Props) {
  const [editing, setEditing] = useState(initialEditing)
  const [value, setValue] = useState(String(quantity))
  const [operation, setOperation] = useState<MovementType>('ADJUST')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [needsReload, setNeedsReload] = useState(false)
  const busy = useRef(false)
  const scope = useRef<{ active: boolean; controller?: AbortController }>({ active: false })

  useEffect(() => {
    const current = { active: true, controller: undefined as AbortController | undefined }
    scope.current = current
    return () => { current.active = false; current.controller?.abort() }
  }, [session])

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || needsReload) return
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647 || (operation !== 'ADJUST' && Number(value) === 0)) {
      setError('Enter a valid stock quantity using zero or a positive whole number.')
      return
    }
    if (reason.trim().length > 200 || (operation === 'ADJUST' && reason.replace(/\s/g, '').length < 3)) {
      setError('Enter a short, meaningful reason for the adjustment.'); return
    }
    const current = scope.current
    const controller = new AbortController()
    current.controller = controller
    busy.current = true
    setPending(true)
    setError('')
    try {
      const updated = operation === 'ADJUST'
        ? await updateInventoryQuantity(id, Number(value), session.token, controller.signal, reason)
        : await recordMovement(id, operation, Number(value), reason, session.token, controller.signal)
      if (!current.active || scope.current !== current) return
      saved(id, updated.quantity)
      setEditing(false)
    } catch (failure) {
      if (!current.active || scope.current !== current) return
      if (failure instanceof ResourceError && failure.status === 401) expireSession(session)
      else {
        setError(failure instanceof ResourceError ? failure.message
          : 'Unable to confirm the save. Reload inventory to check the current quantity.')
        setNeedsReload(true)
      }
    } finally {
      if (current.active && scope.current === current) {
        busy.current = false
        setPending(false)
      }
    }
  }

  if (!editing) return <button aria-label={`Edit quantity for inventory ${id}`} onClick={() => {
    setValue(String(quantity)); setOperation('ADJUST'); setReason(''); setError(''); setNeedsReload(false); setEditing(true); onEdit?.()
  }}>Edit quantity</button>

  return <form className="quantity-editor" onSubmit={save} noValidate aria-busy={pending}>
    <label htmlFor={`operation-${id}`}>Operation</label>
    <select id={`operation-${id}`} value={operation} disabled={pending || needsReload} onChange={(event) => {
      setOperation(event.target.value as MovementType); setValue(event.target.value === 'ADJUST' ? String(quantity) : ''); setError('')
    }}><option value="RECEIVE">Receive — add stock</option><option value="ISSUE">Issue — remove stock</option>
      <option value="ADJUST">Adjust — set quantity</option></select>
    <label htmlFor={`quantity-${id}`}>{operation === 'ADJUST' ? `Quantity for inventory ${id}` : operation === 'RECEIVE' ? 'Items to receive' : 'Items to issue'}</label>
    <input id={`quantity-${id}`} inputMode="numeric" required value={value} disabled={pending || needsReload}
      aria-describedby={error ? `quantity-error-${id}` : undefined}
      aria-invalid={error ? true : undefined} onChange={(event) => setValue(event.target.value)} />
    <label htmlFor={`reason-${id}`}>Reason{operation === 'ADJUST' ? ' (required)' : ''}</label>
    <input id={`reason-${id}`} value={reason} required={operation === 'ADJUST'} maxLength={200} disabled={pending || needsReload}
      onChange={(event) => setReason(event.target.value)} />
    {error && <p id={`quantity-error-${id}`} role="alert" className="form-error">{error}</p>}
    <div className="quantity-actions">
      <button type="submit" disabled={pending || needsReload}>{pending ? 'Saving…' : 'Save'}</button>
      <button type="button" disabled={pending} onClick={() => { setEditing(false); onFinish?.() }}>Cancel</button>
      {needsReload && <button type="button" onClick={reload}>Reload inventory</button>}
    </div>
    {pending && <p role="status">Saving quantity…</p>}
  </form>
}
