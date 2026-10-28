import { DeletePanel } from '../deletion/DeletePanel'
import { CreatePanel } from '../creation/CreatePanel'
import { EditPanel } from '../editing/EditPanel'
import { useEffect, useRef, useState } from 'react'
import { InventoryScreen } from './InventoryScreen'
import type { LoginResponse } from '../auth/loginApi'
import type { Warehouse } from './resourceApi'
import { loadWarehouses, ResourceError, validRecordId } from './resourceApi'

type State = { kind: 'loading' } | { kind: 'ready'; rows: Warehouse[] }
  | { kind: 'error'; message: string; retry: boolean }
type Props = {
  canDelete?: boolean
  canCreate?: boolean
  resource: 'warehouses' | 'inventory'
  session: LoginResponse
  logout: () => void
  expireSession: (session: LoginResponse) => void
}

const screens = {
  warehouses: {
    title: 'Warehouses', headers: ['Name', 'Location', 'Capacity'],
    load: loadWarehouses,
  },

}

export function ResourceScreen(props: Props) {
  return props.resource === 'inventory' ? <InventoryScreen session={props.session} logout={props.logout}
    expireSession={props.expireSession} canCreate={props.canCreate} canDelete={props.canDelete} /> : <WarehouseScreen {...props} />
}

function WarehouseScreen({ resource, session, expireSession, canCreate = false, canDelete = false }: Props) {
  const [storedState, setState] = useState<State>({ kind: 'loading' })
  const [owner, setOwner] = useState(session)
  const state: State = owner === session ? storedState : { kind: 'loading' }
  const [attempt, setAttempt] = useState(0)
  const [storedSelection, setSelection] = useState<{ record: Warehouse; version: number; session: LoginResponse; action: 'edit' | 'delete' } | null>(null)
  const selection = storedSelection?.session === session ? storedSelection : null
  const editVersion = useRef(0)
  const screen = screens.warehouses
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    screen.load(session.token, controller.signal).then((rows) => {
      if (active) { setOwner(session); setState({ kind: 'ready', rows }) }
    }).catch((failure: unknown) => {
      if (!active) return
      setOwner(session)
      if (failure instanceof ResourceError && failure.status === 401) expireSession(session)
      else setState({ kind: 'error',
        message: failure instanceof ResourceError ? failure.message : 'Unable to load this list. Please try again.',
        retry: !(failure instanceof ResourceError && failure.status === 403) })
    })
    return () => { active = false; controller.abort() }
  }, [screen, session, attempt, expireSession])

  function reload() { setOwner(session); setState({ kind: 'loading' }); setAttempt((value) => value + 1) }

  return <div className="products-screen">
    <header className="products-header">
      <h2 tabIndex={-1} ref={(element) => element?.focus()}>{screen.title}</h2>
    </header>
    {canCreate && !selection && <CreatePanel resource="warehouses" session={session} expireSession={expireSession} reload={reload} listReady={state.kind === 'ready'} />}
    {canCreate && selection?.action === 'edit' && <EditPanel key={selection.version} resource="warehouses" record={selection.record} session={session}
      expireSession={expireSession} reload={reload} close={() => setSelection(null)} />}
      {canDelete && selection?.action === 'delete' && validRecordId(selection.record.id) && <DeletePanel key={selection.version}
        resource="warehouses" id={selection.record.id} record={selection.record} session={session}
        expireSession={expireSession} reload={reload} close={() => setSelection(null)} />}
    {state.kind === 'loading' && <p role="status">Loading {resource}…</p>}
    {state.kind === 'error' && <div><p role="alert" className="form-error">{state.message}</p>
      {state.retry && <button onClick={reload}>Retry</button>}
    </div>}
    {state.kind === 'ready' && (state.rows.length === 0 ? <p role="status">No {resource} found.</p> :
      <div className="table-scroll" role="region" aria-label={`${screen.title} list`} tabIndex={0}>
        <table aria-label={screen.title}>
          <thead><tr>{screen.headers.map((header) => <th key={header} scope="col">{header}</th>)}{(canCreate || canDelete) && <th scope="col">Actions</th>}</tr></thead>
          <tbody>{state.rows.map((warehouse, index) => <tr key={warehouse.id ?? `missing-${index}`}>
            <td>{warehouse.name ?? 'Not specified'}</td><td>{warehouse.location ?? 'Not specified'}</td><td>{warehouse.capacity}</td>
            {(canCreate || canDelete) && <td>{validRecordId(warehouse.id) && <>{canCreate && <button aria-label={`Edit warehouse ${warehouse.id}`}
              onClick={() => setSelection({ record: warehouse, version: ++editVersion.current, session, action: 'edit' })}>Edit</button>}
              {canDelete && <button aria-label={`Delete warehouse ${warehouse.id}`}
                onClick={() => setSelection({ record: warehouse, version: ++editVersion.current, session, action: 'delete' })}>Delete</button>}</>}</td>}
          </tr>)}</tbody>
        </table>
      </div>)}
  </div>
}
