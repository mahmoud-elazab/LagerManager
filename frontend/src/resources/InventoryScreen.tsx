import { useCallback, useEffect, useRef, useState } from 'react'
import type { LoginResponse } from '../auth/loginApi'
import { loadInventory, ResourceError } from './resourceApi'
import type { Inventory } from './resourceApi'
import { InventoryCreatePanel } from '../creation/InventoryCreatePanel'
import { DeletePanel } from '../deletion/DeletePanel'
import { validRecordId } from './resourceApi'
import { MovementHistory } from './MovementHistory'
import { QuantityEditor } from './QuantityEditor'

type Props = {
  canDelete?: boolean
  canCreate?: boolean
  session: LoginResponse
  logout: () => void
  expireSession: (session: LoginResponse) => void
}
type State = { kind: 'loading' } | { kind: 'ready'; items: Inventory[] }
  | { kind: 'error'; message: string; retry: boolean }

export function InventoryScreen({ session, expireSession, canCreate = false, canDelete = false }: Props) {
  const [result, setResult] = useState<{ session: LoginResponse; state: State }>({ session, state: { kind: 'loading' } })
  const [attempt, setAttempt] = useState(0)
  const [success, setSuccess] = useState('')
  const [storedSelection, setSelection] = useState<{ action: 'quantity' | 'delete' | 'history'; record: Inventory; version: number; session: LoginResponse } | null>(null)
  const selection = storedSelection?.session === session ? storedSelection : null
  const version = useRef(0)
  const state: State = result.session === session ? result.state : { kind: 'loading' }

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    loadInventory(session.token, controller.signal).then((items) => {
      if (active) setResult({ session, state: { kind: 'ready', items } })
    }).catch((failure: unknown) => {
      if (!active) return
      if (failure instanceof ResourceError && failure.status === 401) expireSession(session)
      else setResult({ session, state: { kind: 'error',
        message: failure instanceof ResourceError ? failure.message : 'Unable to load inventory. Please try again.',
        retry: !(failure instanceof ResourceError && failure.status === 403) } })
    })
    return () => { active = false; controller.abort() }
  }, [session, attempt, expireSession])

  function reload() {
    if (selection?.action === 'quantity') setSelection(null)
    setSuccess('')
    setResult({ session, state: { kind: 'loading' } })
    setAttempt((value) => value + 1)
  }
  function saved(id: number, quantity: number) {
    setSelection(null)
    setResult((previous) => previous.session === session && previous.state.kind === 'ready'
      ? { session, state: { kind: 'ready', items: previous.state.items.map((item) =>
        item.id === id ? { ...item, quantity } : item) } } : previous)
    setSuccess(`Quantity updated for inventory ${id}.`)
  }

  const focusHeading = useCallback((element: HTMLHeadingElement | null) => element?.focus(), [])
  return <div className="products-screen">
    <header className="products-header"><h2 tabIndex={-1} ref={focusHeading}>Inventory</h2>
      </header>
    {canCreate && !selection && <InventoryCreatePanel session={session} expireSession={expireSession} reload={reload} listReady={state.kind === 'ready'} />}
    {canDelete && selection?.action === 'delete' && validRecordId(selection.record.id) && <DeletePanel key={selection.version}
      resource="inventory" id={selection.record.id} record={selection.record} session={session}
      expireSession={expireSession} reload={reload} close={() => setSelection(null)} />}
    {selection?.action === 'history' && validRecordId(selection.record.id) && <MovementHistory key={selection.version}
      id={selection.record.id} session={session} expireSession={expireSession} close={() => setSelection(null)} />}
    {success && result.session === session && <p role="status">{success}</p>}
    {state.kind === 'loading' && <p role="status">Loading inventory…</p>}
    {state.kind === 'error' && <div><p role="alert" className="form-error">{state.message}</p>
      {state.retry && <button onClick={reload}>Retry</button>}</div>}
    {state.kind === 'ready' && (state.items.length === 0 ? <p role="status">No inventory found.</p> :
      <div className="table-scroll" role="region" aria-label="Inventory list" tabIndex={0}>
        <table aria-label="Inventory"><thead><tr>
          {['Product name', 'Product SKU', 'Warehouse name', 'Warehouse location', 'Quantity', 'Actions']
            .map((heading) => <th key={heading} scope="col" className={heading === 'Actions' ? 'actions-cell' : heading === 'Quantity' ? 'numeric' : undefined}>{heading}</th>)}
        </tr></thead><tbody>{state.items.map((item, index) => <tr key={item.id ?? `missing-${index}`}>
          <td>{item.product?.name ?? 'Not specified'}</td><td>{item.product?.sku ?? 'Not specified'}</td>
          <td>{item.warehouse?.name ?? 'Not specified'}</td><td>{item.warehouse?.location ?? 'Not specified'}</td>
          <td className="numeric">{item.quantity}</td><td className="actions-cell">{validRecordId(item.id)
            ? <><QuantityEditor key={selection?.action === 'quantity' && selection.record.id === item.id ? selection.version : 'idle'}
              id={item.id} quantity={item.quantity} session={session} expireSession={expireSession}
              initialEditing={selection?.action === 'quantity' && selection.record.id === item.id}
              onEdit={() => setSelection({ action: 'quantity', record: item, version: ++version.current, session })}
              onFinish={() => setSelection(null)} saved={saved} reload={reload} />
              <button aria-label={`History for inventory ${item.id}`} onClick={() => setSelection({ action: 'history', record: item,
                version: ++version.current, session })}>History</button>
              {canDelete && <button className="button-danger" aria-label={`Delete inventory ${item.id}`} onClick={() =>
                setSelection({ action: 'delete', record: item, version: ++version.current, session })}>Delete</button>}</>
            : 'Editing unavailable'}</td>
        </tr>)}</tbody></table>
      </div>)}
  </div>
}
