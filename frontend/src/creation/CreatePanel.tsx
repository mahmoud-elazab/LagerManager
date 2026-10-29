import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import type { LoginResponse } from '../auth/loginApi'
import { ResourceError } from '../resources/resourceApi'
import { createRecord, decimalPrice, wholeNumber } from './createApi'
import type { CreationResource } from './createApi'

type Props = { listReady: boolean; resource: Exclude<CreationResource, 'inventory'>; session: LoginResponse; expireSession: (session: LoginResponse) => void; reload: () => void }
const initial = { name: '', sku: '', description: '', category: '', price: '', location: '', capacity: '0' }

export function CreatePanel({ resource, session, expireSession, reload, listReady }: Props) {
  const [open, setOpen] = useState(false)
  const [fields, setFields] = useState(initial)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [denied, setDenied] = useState(false)
  const busy = useRef(false)
  const scope = useRef<{ active: boolean; controller?: AbortController }>({ active: false })
  const label = resource === 'products' ? 'product' : 'warehouse'
  useEffect(() => {
    const current = { active: true, controller: undefined as AbortController | undefined }
    scope.current = current
    return () => { current.active = false; current.controller?.abort() }
  }, [session])

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || uncertain || denied) return
    if (!fields.name.trim() || (resource === 'products'
      ? !fields.sku.trim() || !decimalPrice(fields.price)
      : !fields.location.trim() || !wholeNumber(fields.capacity))) {
      setError(resource === 'products'
        ? 'Check the required details. Enter the required details and a valid price of zero or more.'
        : 'Check the required details. Use zero or a positive whole number for capacity.')
      return
    }
    const current = scope.current
    const controller = new AbortController()
    current.controller = controller
    busy.current = true
    setPending(true); setError(''); setConfirmed(false)
    try {
      const input = resource === 'products'
        ? { name: fields.name.trim(), sku: fields.sku.trim(), description: fields.description,
          category: fields.category, price: fields.price }
        : { name: fields.name.trim(), location: fields.location.trim(), capacity: Number(fields.capacity) }
      await createRecord(resource, input, session.token, controller.signal)
      if (!current.active || scope.current !== current) return
      setConfirmed(true); setOpen(false); setFields(initial)
      reload()
    } catch (failure) {
      if (!current.active || scope.current !== current) return
      if (failure instanceof ResourceError && failure.status === 401) expireSession(session)
      else {
        setError(failure instanceof ResourceError ? failure.message : 'Creation could not be confirmed. Reload the list before trying again.')
        setUncertain(!(failure instanceof ResourceError && [400, 403, 409].includes(failure.status ?? 0)))
        setDenied(failure instanceof ResourceError && failure.status === 403)
      }
    } finally {
      if (current.active && scope.current === current) { busy.current = false; setPending(false) }
    }
  }
  const names = resource === 'products' ? ['name', 'sku', 'description', 'category', 'price'] as const
    : ['name', 'location', 'capacity'] as const
  const labels = { name: 'Name', sku: 'SKU', description: 'Description', category: 'Category', quantity: 'Quantity',
    price: 'Price', location: 'Location', capacity: 'Capacity' }
  return <section className="create-panel" aria-label={`Create ${label}`}>
    {confirmed && <p role="status">{label === 'product' ? 'Product' : 'Warehouse'} created. The list is refreshing; if it cannot load, reload the list without submitting again.</p>}
    {!open && !uncertain && !denied && <button className="button-primary" disabled={!listReady} onClick={() => { setFields(initial); setError(''); setConfirmed(false); setOpen(true) }}>Add {label}</button>}
    {open && <form onSubmit={save} noValidate aria-busy={pending} aria-describedby={error ? `create-${label}-error` : undefined}>
      <h3>Add {label}</h3>
      {names.map((name) => <div className="form-field" key={name}>
        <label htmlFor={`create-${name}`}>{labels[name]}</label>
        <input id={`create-${name}`} value={fields[name]} disabled={pending || uncertain || denied}
          required={!['description', 'category'].includes(name)}
          inputMode={name === 'price' ? 'decimal' : ['quantity', 'capacity'].includes(name) ? 'numeric' : undefined}
          onChange={(event) => setFields((previous) => ({ ...previous, [name]: event.target.value }))} />
      </div>)}

      {error && <p id={`create-${label}-error`} role="alert" className="form-error">{error}</p>}
      <div className="quantity-actions">
        <button type="submit" disabled={pending || uncertain || denied}>{pending ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setError('') }}>Cancel</button>
      </div>
      {pending && <p role="status">Creating {label}…</p>}
    </form>}
    {uncertain && <><p>Creation may already have completed. Reload the list to check before another attempt.</p>
      <button onClick={() => { setOpen(false); setError(''); setUncertain(false); reload() }}>Reload list</button></>}
  </section>
}
