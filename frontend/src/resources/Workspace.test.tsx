import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { ResourceScreen } from './ResourceScreen'

const session = { token: 'fictional-test-session', tokenType: 'Bearer' }
const product = { description: null, id: 1, name: 'Fictional crate', sku: 'DEMO', category: null, quantity: 999, price: null }
const warehouse = { id: 2, name: 'Fictional depot', location: 'Example location', capacity: 80 }
const inventory = { id: 3, product, warehouse, quantity: 12 }
const resources = ['warehouses', 'inventory'] as const
const fetchMock = vi.fn<typeof fetch>()
const dataMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  dataMock.mockImplementation(() => Promise.resolve(Response.json([])))
  fetchMock.mockImplementation((url, init) => url === '/api/auth/me'
    ? Promise.resolve(Response.json({ email: 'fictional@example.com', role: 'EMPLOYEE' })) : url === '/api/auth/login'
    ? Promise.resolve(Response.json(session)) : dataMock(url, init))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetchMock.mockReset(); dataMock.mockReset() })

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}
function title(resource: string) { return resource[0].toUpperCase() + resource.slice(1) }
function navigate(resource: string) { fireEvent.click(screen.getByRole('button', { name: title(resource) })) }
async function signIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'fictional@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional-input' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('heading', { name: 'Products' })
}
async function start() { render(<App />); await signIn() }

it('loads only selected resources, marks navigation, reloads on return and resets on new login', async () => {
  await start()
  await screen.findByText('No products found.')
  expect(dataMock.mock.calls.map(([url]) => url)).toEqual(['/api/products'])
  expect(screen.getByRole('navigation', { name: 'Resources' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Products' }).getAttribute('aria-current')).toBe('page')
  navigate('warehouses')
  await screen.findByText('No warehouses found.')
  navigate('inventory')
  await screen.findByText('No inventory found.')
  expect(screen.getByRole('button', { name: 'Inventory' }).getAttribute('aria-current')).toBe('page')
  navigate('warehouses')
  await screen.findByText('No warehouses found.')
  fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
  await signIn()
  await screen.findByText('No products found.')
  expect(dataMock.mock.calls.map(([url]) => url)).toEqual([
    '/api/products', '/api/warehouses', '/api/inventory', '/api/warehouses', '/api/products',
  ])
})

it.each(resources)('loads authenticated %s and displays model fields', async (resource) => {
  await start()
  dataMock.mockResolvedValue(Response.json(resource === 'warehouses' ? [warehouse] : [inventory]))
  navigate(resource)
  await screen.findByRole('cell', { name: warehouse.name })
  expect(dataMock).toHaveBeenLastCalledWith(`/api/${resource}`, {
    headers: { Authorization: `Bearer ${session.token}` }, credentials: 'omit', signal: expect.any(AbortSignal),
  })
  expect(screen.getByRole('cell', { name: warehouse.location })).toBeTruthy()
  if (resource === 'inventory') {
    expect(screen.getByRole('cell', { name: product.name })).toBeTruthy()
    expect(screen.getByRole('cell', { name: product.sku })).toBeTruthy()
    expect(screen.getByRole('cell', { name: '12' })).toBeTruthy()
    expect(screen.queryByRole('cell', { name: '999' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Quantity' })).toBeTruthy()
  } else {
    expect(screen.getByRole('cell', { name: '80' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Capacity' })).toBeTruthy()
  }
})

it.each(resources)('handles nullable fields and associations for %s', async (resource) => {
  await start()
  dataMock.mockResolvedValue(Response.json(resource === 'warehouses'
    ? [{ id: null, name: null, location: null, capacity: 0 }]
    : [{ id: null, product: null, warehouse: null, quantity: 0 },
      { id: 4, product: { ...product, name: null, sku: null }, warehouse: { ...warehouse, name: null, location: null }, quantity: 2 }]))
  navigate(resource)
  await screen.findByRole('table')
  expect(screen.getAllByRole('cell', { name: 'Not specified' })).toHaveLength(resource === 'warehouses' ? 2 : 8)
  expect(screen.getByRole('cell', { name: '0' })).toBeTruthy()
})

it.each(resources)('shows empty %s', async (resource) => {
  await start(); navigate(resource)
  await screen.findByText(`No ${resource} found.`)
  expect(screen.queryByRole('table')).toBeNull()
})

it.each(resources)('shows loading and permits logout while %s is pending', async (resource) => {
  await start()
  const pending = deferred()
  dataMock.mockReturnValue(pending.promise)
  navigate(resource)
  expect(screen.getByRole('status').textContent).toBe(`Loading ${resource}…`)
  const signal = dataMock.mock.calls.at(-1)![1]!.signal!
  fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
  expect(signal.aborted).toBe(true)
  await act(async () => pending.resolve(Response.json(resource === 'warehouses' ? [warehouse] : [inventory])))
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
})

it.each(resources)('expires the current session on %s 401', async (resource) => {
  await start()
  dataMock.mockResolvedValue(new Response(null, { status: 401 }))
  navigate(resource)
  expect((await screen.findByRole('alert')).textContent).toBe('Please sign in again to continue.')
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
})

it.each(resources.flatMap((resource) => [403, 500].map((status) => ({ resource, status }))))(
  'safely handles $resource HTTP $status', async ({ resource, status }) => {
    await start()
    dataMock.mockResolvedValue(new Response('private details', { status }))
    navigate(resource)
    expect((await screen.findByRole('alert')).textContent).toBe(status === 403
      ? `Access denied. You do not have permission to view ${resource}.` : `Unable to load ${resource}. Please try again later.`)
    expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
    expect(screen.queryByText('private details')).toBeNull()
    if (status === 403) expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    else {
      dataMock.mockResolvedValue(Response.json([]))
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      await screen.findByText(`No ${resource} found.`)
    }
  },
)

it.each(resources)('recovers from network failure on %s', async (resource) => {
  await start()
  dataMock.mockRejectedValueOnce(new Error('private details'))
  navigate(resource)
  expect((await screen.findByRole('alert')).textContent).toBe('Unable to connect. Check your connection and try again.')
  dataMock.mockResolvedValue(Response.json([]))
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText(`No ${resource} found.`)
})

const malformed = [null, {}, [null], [{ id: 1 }], [{ ...warehouse, capacity: null }],
  [{ ...warehouse, capacity: 1.5 }], [{ ...warehouse, capacity: 2147483648 }], [{ ...warehouse, location: 1 }]]
it.each(resources.flatMap((resource) => malformed.map((body, index) => ({ resource, body, index }))))(
  'rejects $resource unexpected shape $index', async ({ resource, body }) => {
    await start(); dataMock.mockResolvedValue(Response.json(body)); navigate(resource)
    expect((await screen.findByRole('alert')).textContent).toBe('Unexpected server response. Please try again later.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  },
)

it.each([
  { ...inventory, quantity: null }, { ...inventory, quantity: 1.5 }, { ...inventory, quantity: 2147483648 },
  { ...inventory, product: [] }, { ...inventory, product: { ...product, quantity: null } },
  { ...inventory, warehouse: { ...warehouse, capacity: null } }, { ...inventory, warehouse: 'invalid' },
])('rejects malformed nested inventory %#', async (body) => {
  await start(); dataMock.mockResolvedValue(Response.json([body])); navigate('inventory')
  await screen.findByRole('alert')
  expect(screen.queryByRole('table')).toBeNull()
})

it.each(resources)('rejects malformed JSON on %s', async (resource) => {
  await start(); dataMock.mockResolvedValue(new Response('not JSON')); navigate(resource)
  expect((await screen.findByRole('alert')).textContent).toBe('Unexpected server response. Please try again later.')
})

it.each(resources.flatMap((resource) => ['success', '401'].map((outcome) => ({ resource, outcome }))))(
  'ignores $resource stale $outcome after navigation', async ({ resource, outcome }) => {
    await start()
    const old = deferred()
    dataMock.mockReturnValueOnce(old.promise).mockImplementation(() => Promise.resolve(Response.json([])))
    navigate(resource)
    const signal = dataMock.mock.calls.at(-1)![1]!.signal!
    navigate('products')
    await screen.findByText('No products found.')
    expect(signal.aborted).toBe(true)
    await act(async () => old.resolve(outcome === '401' ? new Response(null, { status: 401 })
      : Response.json(resource === 'warehouses' ? [warehouse] : [inventory])))
    expect(screen.getByRole('heading', { name: 'Products' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    navigate(resource)
    await screen.findByText(`No ${resource} found.`)
  },
)

it.each(resources.flatMap((resource) => ['success', '401'].map((outcome) => ({ resource, outcome }))))(
  'ignores $resource old $outcome after logout and new login', async ({ resource, outcome }) => {
    await start()
    const old = deferred()
    dataMock.mockReturnValueOnce(old.promise).mockImplementation(() => Promise.resolve(Response.json([])))
    navigate(resource)
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
    await signIn()
    await screen.findByText('No products found.')
    await act(async () => old.resolve(outcome === '401' ? new Response(null, { status: 401 })
      : Response.json(resource === 'warehouses' ? [warehouse] : [inventory])))
    expect(screen.getByRole('heading', { name: 'Products' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
    await waitFor(() => expect(screen.getByText('No products found.')).toBeTruthy())
  },
)

it.each(resources.flatMap((resource) => ['success', '401'].map((outcome) => ({ resource, outcome }))))(
  'ignores $resource old $outcome on direct session change', async ({ resource, outcome }) => {
    const old = deferred()
    const expire = vi.fn()
    const logout = vi.fn()
    dataMock.mockReturnValueOnce(old.promise).mockImplementation(() => Promise.resolve(Response.json([])))
    const first = { ...session, tokenType: 'Bearer' as const }
    const view = render(<ResourceScreen resource={resource} session={first} logout={logout} expireSession={expire} />)
    const signal = dataMock.mock.calls[0][1]!.signal!
    view.rerender(<ResourceScreen resource={resource} session={{ ...first }} logout={logout} expireSession={expire} />)
    await screen.findByText(`No ${resource} found.`)
    expect(signal.aborted).toBe(true)
    await act(async () => old.resolve(outcome === '401' ? new Response(null, { status: 401 })
      : Response.json(resource === 'warehouses' ? [warehouse] : [inventory])))
    expect(expire).not.toHaveBeenCalled()
    expect(screen.getByText(`No ${resource} found.`)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  },
)
