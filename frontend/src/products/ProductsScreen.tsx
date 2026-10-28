import { useEffect, useState } from 'react'
import type { LoginResponse } from '../auth/loginApi'
import { loadProducts, ProductsError } from './productsApi'
import type { Product } from './productsApi'

type Props = {
  session: LoginResponse
  logout: () => void
  expireSession: (session: LoginResponse) => void
}
type State = { kind: 'loading' } | { kind: 'ready'; products: Product[] }
  | { kind: 'error'; message: string; retry: boolean }

export function ProductsScreen({ session, logout, expireSession }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    loadProducts(session.token, controller.signal).then((products) => {
      if (active) setState({ kind: 'ready', products })
    }).catch((failure: unknown) => {
      if (!active) return
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

  return (
    <div className="products-screen">
      <header className="products-header">
        <h2 tabIndex={-1} ref={(element) => element?.focus()}>Products</h2>
        <button onClick={logout}>Logout</button>
      </header>
      <p id="quantity-note">Product record quantity is stored on each product; it is not a total of warehouse inventory.</p>
      {state.kind === 'loading' && <p role="status">Loading products…</p>}
      {state.kind === 'error' && <div>
        <p role="alert" className="form-error">{state.message}</p>
        {state.retry && <button onClick={() => { setState({ kind: 'loading' }); setAttempt((value) => value + 1) }}>Retry</button>}
      </div>}
      {state.kind === 'ready' && (state.products.length === 0 ? <p role="status">No products found.</p> : (
        <div className="table-scroll" role="region" aria-label="Product list" tabIndex={0}>
          <table aria-describedby="quantity-note">
            <caption>Products — view only. Prices have no specified currency.</caption>
            <thead><tr>{['Name', 'SKU', 'Category', 'Product record quantity', 'Price'].map((heading) =>
              <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>{state.products.map((product, index) => <tr key={product.id ?? `row-${index}`}>
              <td>{product.name ?? 'Not specified'}</td><td>{product.sku ?? 'Not specified'}</td>
              <td>{product.category ?? 'Not specified'}</td><td>{product.quantity}</td>
              <td>{product.price ?? 'Not specified'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
