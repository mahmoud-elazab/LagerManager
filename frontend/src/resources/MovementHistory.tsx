import { useEffect, useState } from 'react'
import type { LoginResponse } from '../auth/loginApi'
import { ResourceError } from './resourceApi'
import { loadMovements } from './stockApi'
import type { StockMovement } from './stockApi'

type Props = { id: number; session: LoginResponse; expireSession: (session: LoginResponse) => void; close: () => void }
type State = { kind: 'loading' } | { kind: 'ready'; rows: StockMovement[] } | { kind: 'error'; message: string }
export function MovementHistory({ id, session, expireSession, close }: Props) {
  const [result, setResult] = useState<{ id: number; session: LoginResponse; state: State }>({ id, session, state: { kind: 'loading' } })
  const state: State = result.id === id && result.session === session ? result.state : { kind: 'loading' }
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    loadMovements(id, session.token, controller.signal).then((rows) => {
      if (active) setResult({ id, session, state: { kind: 'ready', rows } })
    }).catch((failure: unknown) => {
      if (!active) return
      if (failure instanceof ResourceError && failure.status === 401) expireSession(session)
      else setResult({ id, session, state: { kind: 'error', message: failure instanceof ResourceError
        ? failure.message : 'Unable to load stock history. Please try again.' } })
    })
    return () => { active = false; controller.abort() }
  }, [id, session, expireSession, attempt])
  return <section className="movement-history" aria-label={`Stock history for inventory ${id}`}>
    <div className="products-header"><h3>Stock history — {id}</h3><button onClick={close}>Close history</button></div>
    {state.kind === 'loading' && <p role="status">Loading stock history…</p>}
    {state.kind === 'error' && <><p className="form-error" role="alert">{state.message}</p><button onClick={() => {
      setResult({ id, session, state: { kind: 'loading' } }); setAttempt((value) => value + 1)
    }}>Retry history</button></>}
    {state.kind === 'ready' && (state.rows.length === 0 ? <p role="status">No stock movements yet.</p> :
      <div className="table-scroll" role="region" tabIndex={0} aria-label="Stock history list">
        <table aria-label="Stock movements"><thead><tr>{['Date', 'Operation', 'Change', 'Before', 'After', 'Actor', 'Reason']
          .map((heading) => <th scope="col" key={heading}>{heading}</th>)}</tr></thead>
          <tbody>{state.rows.map((row) => <tr key={row.id}><td><time dateTime={row.timestamp}>{new Date(row.timestamp).toLocaleString()}</time></td>
            <td>{{ RECEIVE: 'Receive', ISSUE: 'Issue', ADJUST: 'Adjust' }[row.type]}</td>
            <td>{row.quantityChange > 0 ? '+' : ''}{row.quantityChange}</td><td>{row.previousQuantity}</td><td>{row.resultingQuantity}</td>
            <td>{row.actor}</td><td>{row.reason}</td></tr>)}</tbody></table>
      </div>)}
  </section>
}
