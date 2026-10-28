import { LoginForm } from './auth/LoginForm'
import { useAuth } from './auth/useAuth'
import { ProductsScreen } from './products/ProductsScreen'
import './App.css'

function App() {
  const auth = useAuth()

  return (
    <main className="auth-page">
      <section className={auth.session ? "auth-card products-card" : "auth-card"} aria-labelledby="app-title">
        <p className="eyebrow">Warehouse &amp; Inventory Management</p>
        <h1 id="app-title">LagerManager</h1>
        {auth.session ? (
          <ProductsScreen session={auth.session} logout={auth.logout} expireSession={auth.expireSession} />
        ) : <LoginForm signIn={auth.signIn} pending={auth.pending} error={auth.error} />}
      </section>
    </main>
  )
}

export default App
