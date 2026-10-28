import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { ProductsScreen } from './ProductsScreen'

const product = { id: 1, name: 'Fictional crate', sku: 'DEMO-1', category: 'Storage', quantity: 7, price: 12.5 }
const session = { token: 'fictional-session', tokenType: 'Bearer' as const }
const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetchMock.mockReset() })

function deferred() {
  let resolve!: (value: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}

async function signIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'fictional@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional-input' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('heading', { name: 'Products' })
}

function renderProducts() {
  return render(<ProductsScreen session={session} logout={vi.fn()} expireSession={vi.fn()} />)
}

it('loads with a Bearer header and displays an accessible populated table without invented currency', async () => {
  fetchMock.mockResolvedValue(Response.json([product]))
  renderProducts()
  await screen.findByRole('cell', { name: 'Fictional crate' })
  expect(fetchMock).toHaveBeenCalledWith('/api/products', {
    headers: { Authorization: `Bearer ${session.token}` }, credentials: 'omit', signal: expect.any(AbortSignal),
  })
  expect(screen.getByRole('columnheader', { name: 'Product record quantity' })).toBeTruthy()
  expect(screen.getByRole('cell', { name: '12.5' })).toBeTruthy()
  expect(screen.getByRole('cell', { name: '7' })).toBeTruthy()
  expect(screen.getByRole('table').textContent).not.toMatch(/[$€£]/)
  expect(screen.queryByText(session.token)).toBeNull()
})

it('handles nullable model fields', async () => {
  fetchMock.mockResolvedValue(Response.json([{ id: null, name: null, sku: null, category: null, quantity: 0, price: null, description: null }]))
  renderProducts()
  await screen.findByRole('table')
  expect(screen.getAllByRole('cell', { name: 'Not specified' })).toHaveLength(4)
  expect(screen.getByRole('cell', { name: '0' })).toBeTruthy()
})

it('shows an empty list', async () => {
  fetchMock.mockResolvedValue(Response.json([]))
  renderProducts()
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('No products found.'))
  expect(screen.queryByRole('table')).toBeNull()
})

it('keeps logout available during loading and aborts on unmount', () => {
  fetchMock.mockReturnValue(new Promise(() => {}))
  const view = renderProducts()
  expect(screen.getByRole('status').textContent).toBe('Loading products…')
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
  const signal = fetchMock.mock.calls[0][1]!.signal!
  view.unmount()
  expect(signal.aborted).toBe(true)
})

it.each([403, 500, 502])('handles HTTP %s safely without clearing the session', async (status) => {
  fetchMock.mockResolvedValue(new Response('private internal details', { status }))
  const expire = vi.fn()
  render(<ProductsScreen session={session} logout={vi.fn()} expireSession={expire} />)
  const error = await screen.findByRole('alert')
  expect(error.textContent).toBe(status === 403
    ? 'Access denied. You do not have permission to view products.' : 'Unable to load products. Please try again later.')
  expect(screen.queryByText('private internal details')).toBeNull()
  expect(expire).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Retry' }) !== null).toBe(status !== 403)
})

it('recovers from network failure with Retry', async () => {
  fetchMock.mockRejectedValueOnce(new Error('private network details'))
    .mockResolvedValueOnce(Response.json([product]))
  renderProducts()
  expect((await screen.findByRole('alert')).textContent).toBe('Unable to connect. Check your connection and try again.')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByRole('cell', { name: product.name })
  expect(screen.queryByRole('alert')).toBeNull()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it.each([null, {}, [null], [{ ...product, quantity: null }], [{ ...product, quantity: 1.5 }],
  [{ ...product, price: '12.50' }], [{ ...product, name: 42 }], [{ ...product, sku: {} }],
  [{ ...product, category: false }], [{ ...product, id: '1' }], [{ name: 'incomplete' }]])(
  'rejects unexpected response shape %#', async (body) => {
    fetchMock.mockResolvedValue(Response.json(body))
    renderProducts()
    expect((await screen.findByRole('alert')).textContent).toBe('Unexpected product response. Please try again later.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  },
)

it('rejects malformed JSON and allows retry', async () => {
  fetchMock.mockResolvedValue(new Response('not JSON'))
  renderProducts()
  expect((await screen.findByRole('alert')).textContent).toBe('Unexpected product response. Please try again later.')
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
})

it('clears an expired session and asks for sign-in again on 401', async () => {
  fetchMock.mockImplementation((url) => Promise.resolve(url === '/api/auth/login'
    ? Response.json(session) : new Response(null, { status: 401 })))
  render(<App />)
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'fictional@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional-input' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Please sign in again to continue.')
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull()
  expect(screen.getByLabelText<HTMLInputElement>('Password').value).toBe('')
})

it.each(['success', '401'])('ignores obsolete %s after logout and a newer login', async (outcome) => {
  const old = deferred()
  let productRequests = 0
  let logins = 0
  fetchMock.mockImplementation((url) => {
    if (url === '/api/auth/login') return Promise.resolve(Response.json({ ...session, token: `fictional-${++logins}` }))
    return ++productRequests === 1 ? old.promise : Promise.resolve(Response.json([product]))
  })
  render(<App />)
  await signIn()
  const signal = fetchMock.mock.calls.find(([url]) => url === '/api/products')![1]!.signal!
  fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
  expect(signal.aborted).toBe(true)
  await signIn()
  await screen.findByRole('cell', { name: product.name })
  await act(async () => old.resolve(outcome === '401' ? new Response(null, { status: 401 })
    : Response.json([{ ...product, name: 'Obsolete product' }])))
  expect(screen.getByRole('cell', { name: product.name })).toBeTruthy()
  expect(screen.queryByText('Obsolete product')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
})

it('ignores an old 401 when the session prop changes without unmounting', async () => {
  const old = deferred()
  const expire = vi.fn()
  const logout = vi.fn()
  fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(Response.json([product]))
  const view = render(<ProductsScreen session={session} logout={logout} expireSession={expire} />)
  const signal = fetchMock.mock.calls[0][1]!.signal!
  view.rerender(<ProductsScreen session={{ ...session }} logout={logout} expireSession={expire} />)
  await screen.findByRole('table')
  await act(async () => old.resolve(new Response(null, { status: 401 })))
  expect(signal.aborted).toBe(true)
  expect(expire).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole('cell', { name: product.name })).toBeTruthy())
})
