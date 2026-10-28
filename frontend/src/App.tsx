import { LoginForm } from './auth/LoginForm'
import { useAuth } from './auth/useAuth'
import './App.css'

function App() {
  const auth = useAuth()

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="app-title">
        <p className="eyebrow">Warehouse &amp; Inventory Management</p>
        <h1 id="app-title">LagerManager</h1>
        {auth.signedIn ? (
          <div className="signed-in">
            <h2 tabIndex={-1} ref={(element) => element?.focus()}>You’re signed in</h2>
            <p>Your workspace will be available in a future step.</p>
            <button onClick={auth.logout}>Logout</button>
          </div>
        ) : <LoginForm signIn={auth.signIn} pending={auth.pending} error={auth.error} />}
      </section>
    </main>
  )
}

export default App
