import type { ReactNode } from 'react'

type Props = { logout: () => void; children?: ReactNode }
export function WorkspaceHeader({ logout, children }: Props) {
  return <header className="workspace-header" aria-label="Workspace">
    <div className="workspace-account">
      <p className="eyebrow">Warehouse &amp; Inventory Management</p>
      <h1 id="app-title">LagerManager</h1>
      {children}
    </div>
    <button className="logout-button" onClick={logout}>Logout</button>
  </header>
}
