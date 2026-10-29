import { LoginForm } from './auth/LoginForm'
import { useAuth } from './auth/useAuth'
import { Workspace } from './resources/Workspace'
import './App.css'

function App() {
  const auth = useAuth()

  return (
    <main className={auth.session ? "workspace-page" : "auth-page"}>
      <section className={auth.session ? "workspace-shell" : "auth-card"} aria-labelledby="app-title">
        {!auth.session && <><p className="eyebrow">Warehouse &amp; Inventory Management</p>
        <h1 id="app-title">LagerManager</h1></>}
        {auth.session ? (
          <Workspace session={auth.session} logout={auth.logout} expireSession={auth.expireSession} />
        ) : <LoginForm signIn={auth.signIn} pending={auth.pending} error={auth.error} />}
      </section>
    </main>
  )
}

export default App
