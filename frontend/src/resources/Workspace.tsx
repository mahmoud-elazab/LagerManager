import { WorkspaceHeader } from './WorkspaceHeader'
import { useState } from 'react'
import { useCurrentUser } from '../auth/useCurrentUser'
import type { LoginResponse } from '../auth/loginApi'
import { ProductsScreen } from '../products/ProductsScreen'
import { ResourceScreen } from './ResourceScreen'

type Props = {
  session: LoginResponse
  logout: () => void
  expireSession: (session: LoginResponse) => void
}

export function Workspace(props: Props) {
  const [selected, setSelected] = useState<'products' | 'warehouses' | 'inventory'>('products')
  const account = useCurrentUser(props.session, props.expireSession)
  const canCreate = account.state.kind === 'ready' && ['ADMIN', 'MANAGER'].includes(account.state.user.role)
  const canDelete = account.state.kind === 'ready' && account.state.user.role === 'ADMIN'
  return <>
    <WorkspaceHeader logout={props.logout}>
    {account.state.kind === 'loading' && <p role="status">Loading your account…</p>}
    {account.state.kind === 'ready' && <p>Signed in as {account.state.user.email}</p>}
    {account.state.kind === 'error' && <div><p role="alert" className="form-error">{account.state.message}</p>
      <button onClick={account.retry}>Retry account</button></div>}
    </WorkspaceHeader>
    <nav className="resource-nav" aria-label="Resources">
      {(['products', 'warehouses', 'inventory'] as const).map((resource) =>
        <button key={resource} aria-current={selected === resource ? 'page' : undefined}
          onClick={() => setSelected(resource)}>{resource[0].toUpperCase() + resource.slice(1)}</button>)}
    </nav>
    {selected === 'products' ? <ProductsScreen {...props} canCreate={canCreate} canDelete={canDelete} />
      : <ResourceScreen key={selected} resource={selected} {...props} canCreate={canCreate} canDelete={canDelete} />}
  </>
}
