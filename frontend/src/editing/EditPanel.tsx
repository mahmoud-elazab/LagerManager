import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import type { LoginResponse } from '../auth/loginApi'
import type { Product } from '../products/productsApi'
import { ResourceError } from '../resources/resourceApi'
import type { Warehouse } from '../resources/resourceApi'
import { decimalPrice, wholeNumber } from '../creation/createApi'
import { updateRecord } from './updateApi'
import type { EditableResource } from './updateApi'

type Props = { resource: EditableResource; record: Product | Warehouse; session: LoginResponse;
  expireSession: (session: LoginResponse) => void; reload: () => void; close: () => void }

export function EditPanel({ resource, record, session, expireSession, reload, close }: Props) {
  const product = 'sku' in record ? record : null
  const [fields, setFields] = useState(() => ({ name: record.name ?? '', sku: product?.sku ?? '',
    description: product?.description ?? '', category: product?.category ?? '', quantity: String(product?.quantity ?? 0),
    price: product?.price === null ? '' : product?.priceText === null ? '' : product?.priceText ?? String(product?.price ?? ''),
    location: 'location' in record ? record.location ?? '' : '', capacity: 'capacity' in record ? String(record.capacity) : '0' }))
  const [touched, setTouched] = useState({ description: false, category: false })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const busy = useRef(false)
  const scope = useRef<{ active: boolean; controller?: AbortController }>({ active: false })
  const label = resource === 'products' ? 'product' : 'warehouse'
  useEffect(() => {
    const current = { active: true, controller: undefined as AbortController | undefined }
    scope.current = current
    return () => { current.active = false; current.controller?.abort() }
  }, [session, record])

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || uncertain || blocked) return
    if (!fields.name.trim() || (product ? !fields.sku.trim() || !wholeNumber(fields.quantity) || !decimalPrice(fields.price)
      : !fields.location.trim() || !wholeNumber(fields.capacity))) {
      setError(product ? 'Check the required details. Enter a valid whole-number quantity and a price of zero or more.'
        : 'Check the required details. Enter zero or a positive whole number for capacity.')
      return
    }
    if (record.id === null) return
    const current = scope.current
    const controller = new AbortController()
    current.controller = controller
    busy.current = true; setPending(true); setError('')
    try {
      const input = product ? { name: fields.name, sku: fields.sku,
        description: touched.description ? fields.description : product.description,
        category: touched.category ? fields.category : product.category,
        quantity: Number(fields.quantity), price: fields.price }
        : { name: fields.name, location: fields.location, capacity: Number(fields.capacity) }
      await updateRecord(resource, record.id, input, session.token, controller.signal)
      if (!current.active || scope.current !== current) return
      setConfirmed(true); reload()
    } catch (failure) {
      if (!current.active || scope.current !== current) return
      if (failure instanceof ResourceError && failure.status === 401) expireSession(session)
      else {
        setError(failure instanceof ResourceError ? failure.message : 'Save could not be confirmed. Reload the list before trying again.')
        setUncertain(!(failure instanceof ResourceError && [400, 403, 404, 409].includes(failure.status ?? 0)))
        setBlocked(failure instanceof ResourceError && [403, 404].includes(failure.status ?? 0))
      }
    } finally {
      if (current.active && scope.current === current) { busy.current = false; setPending(false) }
    }
  }
  if (confirmed) return <section className="create-panel" aria-label={`Edit ${label}`}>
    <p role="status">{product ? 'Product' : 'Warehouse'} updated. If the list cannot load, reload it without saving again.</p>
    <button onClick={close}>Close</button>
  </section>
  const names = product ? ['name', 'sku', 'description', 'category', 'quantity', 'price'] as const
    : ['name', 'location', 'capacity'] as const
  const labels = { name: 'Name', sku: 'SKU', description: 'Description', category: 'Category', quantity: 'Quantity',
    price: 'Price', location: 'Location', capacity: 'Capacity' }
  return <section className="create-panel" aria-label={`Edit ${label}`}>
    <form onSubmit={save} noValidate aria-busy={pending} aria-describedby={error ? 'edit-error' : undefined}>
      <h3>Edit {label}</h3>
      {names.map((name) => <div className="form-field" key={name}>
        <label htmlFor={`edit-${name}`}>{labels[name]}</label>
        <input id={`edit-${name}`} required={!['description', 'category'].includes(name)} value={fields[name]}
          disabled={pending || uncertain || blocked}
          inputMode={name === 'price' ? 'decimal' : ['quantity', 'capacity'].includes(name) ? 'numeric' : undefined}
          onChange={(event) => {
            setFields((previous) => ({ ...previous, [name]: event.target.value }))
            if (name === 'description' || name === 'category') setTouched((previous) => ({ ...previous, [name]: true }))
          }} />
      </div>)}
      {error && <p id="edit-error" role="alert" className="form-error">{error}</p>}
      <div className="quantity-actions"><button type="submit" disabled={pending || uncertain || blocked}>{pending ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={pending} onClick={close}>Cancel</button>
        {(uncertain || blocked) && <button type="button" onClick={() => { close(); reload() }}>Reload list</button>}
      </div>
      {pending && <p role="status">Saving {label}…</p>}
    </form>
  </section>
}
