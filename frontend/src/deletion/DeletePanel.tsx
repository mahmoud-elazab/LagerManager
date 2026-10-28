import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import type { LoginResponse } from '../auth/loginApi'
import { ResourceError } from '../resources/resourceApi'
import type { Inventory, Warehouse } from '../resources/resourceApi'
import type { Product } from '../products/productsApi'
import { deleteRecord } from './deleteApi'
import type { DeletableResource } from './deleteApi'

function describeItem(record: Product | Warehouse | Inventory): string {
  if ('product' in record) return `${record.product?.name || 'Unnamed product'} — ${record.product?.sku || 'No SKU'}; ${record.warehouse?.name || 'Unnamed warehouse'} — ${record.warehouse?.location || 'No location'}`
  if ('sku' in record) return `${record.name || 'Unnamed product'} — ${record.sku || 'No SKU'}`
  return `${record.name || 'Unnamed warehouse'} — ${record.location || 'No location'}`
}
type Props = { resource: DeletableResource; id: number; record: Product | Warehouse | Inventory; session: LoginResponse;
  expireSession: (session: LoginResponse) => void; reload: () => void; close: () => void }

export function DeletePanel({ resource, id, record, session, expireSession, reload, close }: Props) {
  const description = describeItem(record)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const busy = useRef(false)
  const scope = useRef<{ active: boolean; controller?: AbortController }>({ active: false })
  const label = resource === 'products' ? 'Product' : resource === 'warehouses' ? 'Warehouse' : 'Inventory'
  useEffect(() => {
    const current = { active: true, controller: undefined as AbortController | undefined }
    scope.current = current
    return () => { current.active = false; current.controller?.abort() }
  }, [session, id, resource, record])

  async function remove(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || error) return
    const current = scope.current
    const controller = new AbortController()
    current.controller = controller
    busy.current = true; setPending(true)
    try {
      await deleteRecord(resource, id, session.token, controller.signal)
      if (!current.active || scope.current !== current) return
      setConfirmed(true); reload()
    } catch (failure) {
      if (!current.active || scope.current !== current) return
      if (failure instanceof ResourceError && failure.status === 401) expireSession(session)
      else setError(failure instanceof ResourceError ? failure.message
        : 'Deletion could not be confirmed. Reload the list to check whether the item still exists.')
    } finally {
      if (current.active && scope.current === current) { busy.current = false; setPending(false) }
    }
  }
  if (confirmed) return <section className="create-panel" aria-label={`Delete ${label.toLowerCase()}`}>
    <p role="status">{label} removal request completed. If the list cannot load, reload it without deleting again.</p>
    <button onClick={close}>Close</button>
  </section>
  return <section className="create-panel" aria-labelledby="delete-title">
    <form onSubmit={remove} aria-describedby={`delete-description${error ? ' delete-error' : ''}`} aria-busy={pending}>
      <h3 id="delete-title" tabIndex={-1} ref={(element) => element?.focus()}>Delete {label.toLowerCase()}?</h3>
      <p id="delete-description">{description}</p>
      {error && <p id="delete-error" role="alert" className="form-error">{error}</p>}
      <div className="quantity-actions">
        <button type="submit" disabled={pending || Boolean(error)}>{pending ? 'Deleting…' : 'Delete'}</button>
        <button type="button" disabled={pending} onClick={close}>Cancel</button>
        {error && <button type="button" onClick={() => { close(); reload() }}>Reload list</button>}
      </div>
      {pending && <p role="status">Deleting {label.toLowerCase()}…</p>}
    </form>
  </section>
}
