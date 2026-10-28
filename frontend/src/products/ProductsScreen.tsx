import { DeletePanel } from '../deletion/DeletePanel'
import { CreatePanel } from '../creation/CreatePanel'
import { EditPanel } from '../editing/EditPanel'
import { validRecordId } from '../resources/resourceApi'
import { useEffect, useRef, useState } from 'react'
import type { LoginResponse } from '../auth/loginApi'
import { loadProducts, ProductsError } from './productsApi'
import type { Product } from './productsApi'

type Props = {
  canDelete?: boolean
  canCreate?: boolean
  session: LoginResponse
  logout: () => void
  expireSession: (session: LoginResponse) => void
}
type State = { kind: 'loading' } | { kind: 'ready'; products: Product[] }
  | { kind: 'error'; message: string; retry: boolean }

export function ProductsScreen({ session, expireSession, canCreate = false, canDelete = false }: Props) {
  const [storedState, setState] = useState<State>({ kind: 'loading' })
  const [owner, setOwner] = useState(session)
  const state: State = owner === session ? storedState : { kind: 'loading' }
  const [attempt, setAttempt] = useState(0)
  const [storedSelection, setSelection] = useState<{ record: Product; version: number; session: LoginResponse; action: 'edit' | 'delete' } | null>(null)
  const selection = storedSelection?.session === session ? storedSelection : null
  const editVersion = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    loadProducts(session.token, controller.signal).then((products) => {
      if (active) { setOwner(session); setState({ kind: 'ready', products }) }
    }).catch((failure: unknown) => {
      if (!active) return
      setOwner(session)
      if (failure instanceof ProductsError && failure.status === 401) {
        expireSession(session)
      } else {
        setState({ kind: 'error',
          message: failure instanceof ProductsError ? failure.message : 'Unable to load products. Please try again.',
          retry: !(failure instanceof ProductsError && failure.status === 403) })
      }
    })
    return () => { active = false; controller.abort() }
  }, [session, attempt, expireSession])

  function reload() { setOwner(session); setState({ kind: 'loading' }); setAttempt((value) => value + 1) }

  return (
    <div className="products-screen">
      <header className="products-header">
        <h2 tabIndex={-1} ref={(element) => element?.focus()}>Products</h2>
        </header>
      {canCreate && !selection && <CreatePanel resource="products" session={session} expireSession={expireSession} reload={reload} listReady={state.kind === 'ready'} />}
      {canCreate && selection?.action === 'edit' && <EditPanel key={selection.version} resource="products" record={selection.record} session={session}
        expireSession={expireSession} reload={reload} close={() => setSelection(null)} />}
      {canDelete && selection?.action === 'delete' && validRecordId(selection.record.id) && <DeletePanel key={selection.version}
        resource="products" id={selection.record.id} record={selection.record} session={session}
        expireSession={expireSession} reload={reload} close={() => setSelection(null)} />}
      {state.kind === 'loading' && <p role="status">Loading products…</p>}
      {state.kind === 'error' && <div>
        <p role="alert" className="form-error">{state.message}</p>
        {state.retry && <button onClick={reload}>Retry</button>}
      </div>}
      {state.kind === 'ready' && (state.products.length === 0 ? <p role="status">No products found.</p> : (
        <div className="table-scroll" role="region" aria-label="Product list" tabIndex={0}>
          <table aria-label="Products">
            <thead><tr>{['Name', 'SKU', 'Category', 'Quantity', 'Price'].map((heading) =>
              <th key={heading} scope="col">{heading}</th>)}{(canCreate || canDelete) && <th scope="col">Actions</th>}</tr></thead>
            <tbody>{state.products.map((product, index) => <tr key={product.id ?? `row-${index}`}>
              <td>{product.name ?? 'Not specified'}</td><td>{product.sku ?? 'Not specified'}</td>
              <td>{product.category ?? 'Not specified'}</td><td>{product.quantity}</td>
              <td>{product.priceText ?? product.price ?? 'Not specified'}</td>
              {(canCreate || canDelete) && <td>{validRecordId(product.id) && <>{canCreate && <button aria-label={`Edit product ${product.id}`}
                onClick={() => setSelection({ record: product, version: ++editVersion.current, session, action: 'edit' })}>Edit</button>}
              {canDelete && <button aria-label={`Delete product ${product.id}`}
                onClick={() => setSelection({ record: product, version: ++editVersion.current, session, action: 'delete' })}>Delete</button>}</>}</td>}
            </tr>)}</tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
