import { useEffect, useRef, useState } from 'react'
import type { SubmitEvent } from 'react'
import type { LoginResponse } from '../auth/loginApi'
import { loadInventoryOptions, ResourceError, validRecordId } from '../resources/resourceApi'
import type { Warehouse } from '../resources/resourceApi'
import type { Product } from '../products/productsApi'
import { createRecord, wholeNumber } from './createApi'

type Props = { session: LoginResponse; expireSession: (session: LoginResponse) => void; reload: () => void; listReady: boolean }
type Options = { kind: 'loading' } | { kind: 'ready'; products: Product[]; warehouses: Warehouse[] }
  | { kind: 'error'; message: string }

export function InventoryCreatePanel({ session, expireSession, reload, listReady }: Props) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<Options>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [productId, setProductId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [quantity, setQuantity] = useState('0')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [denied, setDenied] = useState(false)
  const busy = useRef(false)
  const scope = useRef<{ active: boolean; controller?: AbortController }>({ active: false })

  useEffect(() => {
    const current = { active: true, controller: undefined as AbortController | undefined }
    scope.current = current
    return () => { current.active = false; current.controller?.abort() }
  }, [session])

  useEffect(() => {
    if (!open) return
    let active = true
    const controller = new AbortController()
    loadInventoryOptions(session.token, controller.signal).then((loaded) => {
      if (active) setOptions({ kind: 'ready', ...loaded })
    }).catch((failure: unknown) => {
      if (!active) return
      controller.abort()
      if (failure instanceof ResourceError && failure.status === 401) expireSession(session)
      else setOptions({ kind: 'error', message: failure instanceof ResourceError ? failure.message
        : 'Unable to load choices. Please try again.' })
    })
    return () => { active = false; controller.abort() }
  }, [open, session, expireSession, attempt])

  function retryOptions() {
    setOptions({ kind: 'loading' }); setProductId(''); setWarehouseId('')
    setAttempt((value) => value + 1)
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || uncertain || denied) return
    if (options.kind !== 'ready' || !validRecordId(Number(productId)) || !validRecordId(Number(warehouseId))
      || !options.products.some((product) => String(product.id) === productId)
      || !options.warehouses.some((warehouse) => String(warehouse.id) === warehouseId)
      || !wholeNumber(quantity)) {
      setError('Choose a product and warehouse, and enter zero or a positive whole number for quantity.')
      return
    }
    const current = scope.current
    const controller = new AbortController()
    current.controller = controller
    busy.current = true; setPending(true); setError(''); setConfirmed(false)
    try {
      await createRecord('inventory', { productId: Number(productId), warehouseId: Number(warehouseId),
        quantity: Number(quantity) }, session.token, controller.signal)
      if (!current.active || scope.current !== current) return
      setOpen(false); setConfirmed(true); reload()
    } catch (failure) {
      if (!current.active || scope.current !== current) return
      if (failure instanceof ResourceError && failure.status === 401) expireSession(session)
      else {
        setError(failure instanceof ResourceError ? failure.message
          : 'Creation could not be confirmed. Reload the list before trying again.')
        setUncertain(!(failure instanceof ResourceError && [400, 403, 404, 409].includes(failure.status ?? 0)))
        setDenied(failure instanceof ResourceError && failure.status === 403)
      }
    } finally {
      if (current.active && scope.current === current) { busy.current = false; setPending(false) }
    }
  }
  const usable = options.kind === 'ready' && options.products.length > 0 && options.warehouses.length > 0
  return <section className="create-panel" aria-label="Create inventory">
    {confirmed && <p role="status">Inventory created. The list is refreshing; if it cannot load, reload the list without submitting again.</p>}
    {!open && !uncertain && !denied && <button className="button-primary" disabled={!listReady} onClick={() => {
      setProductId(''); setWarehouseId(''); setQuantity('0'); setError(''); setConfirmed(false)
      setOptions({ kind: 'loading' }); setOpen(true)
    }}>Add inventory</button>}
    {open && <form onSubmit={save} noValidate aria-busy={pending} aria-describedby={error ? 'inventory-create-error' : undefined}>
      <h3>Add inventory</h3>
      {options.kind === 'loading' && <p role="status">Loading products and warehouses…</p>}
      {options.kind === 'error' && <div><p role="alert" className="form-error">{options.message}</p>
        <button type="button" onClick={retryOptions}>Retry options</button></div>}
      {options.kind === 'ready' && <>
        {options.products.length === 0 && <p>Create a product first.</p>}
        {options.warehouses.length === 0 && <p>Create a warehouse first.</p>}
        <div className="form-field"><label htmlFor="inventory-product">Product</label>
          <select id="inventory-product" required value={productId} disabled={pending || uncertain || denied}
            onChange={(event) => setProductId(event.target.value)}>
            <option value="">Choose a product</option>
            {options.products.map((product) => <option key={product.id} value={String(product.id)}>
              {product.name ?? 'Unnamed product'} — {product.sku ?? 'No SKU'}
            </option>)}
          </select></div>
        <div className="form-field"><label htmlFor="inventory-warehouse">Warehouse</label>
          <select id="inventory-warehouse" required value={warehouseId} disabled={pending || uncertain || denied}
            onChange={(event) => setWarehouseId(event.target.value)}>
            <option value="">Choose a warehouse</option>
            {options.warehouses.map((warehouse) => <option key={warehouse.id} value={String(warehouse.id)}>
              {warehouse.name ?? 'Unnamed warehouse'} — {warehouse.location ?? 'No location'}
            </option>)}
          </select></div>
      </>}
      <div className="form-field"><label htmlFor="inventory-initial-quantity">Initial quantity</label>
        <input id="inventory-initial-quantity" inputMode="numeric" required value={quantity}
          disabled={pending || uncertain || denied} onChange={(event) => setQuantity(event.target.value)} /></div>
      {error && <p id="inventory-create-error" role="alert" className="form-error">{error}</p>}
      <div className="quantity-actions"><button type="submit" disabled={!usable || pending || uncertain || denied}>
        {pending ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={pending} onClick={() => { setOpen(false); setError('') }}>Cancel</button>
        {error && !uncertain && !pending && !denied && <button type="button" onClick={() => { setError(''); retryOptions() }}>Reload options</button>}
      </div>
      {pending && <p role="status">Creating inventory…</p>}
    </form>}
    {uncertain && <><p>Creation may already have completed. Reload inventory to check before another attempt.</p>
      <button onClick={() => { setOpen(false); setError(''); setUncertain(false); reload() }}>Reload inventory</button></>}
  </section>
}
