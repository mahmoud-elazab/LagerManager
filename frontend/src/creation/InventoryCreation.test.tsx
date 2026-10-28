import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { Workspace } from '../resources/Workspace'

const session = { token: 'fictional-session', tokenType: 'Bearer' as const }
const account = { email: 'fictional@example.com', role: 'ADMIN' }
const product = { description: null, id: 17, name: 'Example crate', sku: 'EX-1', category: null, quantity: 999, price: 12.5 }
const warehouse = { id: 27, name: 'Example depot', location: 'Example location', capacity: 40 }
const inventory = { id: 41, product, warehouse, quantity: 3 }
const fetchMock = vi.fn<typeof fetch>()
const meMock = vi.fn<typeof fetch>()
const listMock = vi.fn<typeof fetch>()
const postMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  meMock.mockImplementation(() => Promise.resolve(Response.json(account)))
  listMock.mockImplementation((url) => Promise.resolve(Response.json(url === '/api/products' ? [product]
    : url === '/api/warehouses' ? [warehouse] : [])))
  fetchMock.mockImplementation((url, init) => {
    if (url === '/api/auth/login') return Promise.resolve(Response.json(session))
    if (url === '/api/auth/me') return meMock(url, init)
    if (init?.method === 'POST') return postMock(url, init)
    return listMock(url, init)
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetchMock.mockReset(); meMock.mockReset(); listMock.mockReset(); postMock.mockReset() })
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}
async function signIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: account.email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional-input' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('heading', { name: 'Products' })
}
async function start() {
  render(<App />); await signIn()
  fireEvent.click(screen.getByRole('button', { name: 'Inventory' }))
  await screen.findByText('No inventory found.')
}
async function open(waitForOptions = true) {
  const add = await screen.findByRole<HTMLButtonElement>('button', { name: 'Add inventory' })
  await waitFor(() => expect(add.disabled).toBe(false))
  fireEvent.click(add)
  if (waitForOptions) await screen.findByLabelText('Product')
}
function select(productId = '17', warehouseId = '27', quantity = '3') {
  fireEvent.change(screen.getByLabelText('Product'), { target: { value: productId } })
  fireEvent.change(screen.getByLabelText('Warehouse'), { target: { value: warehouseId } })
  fireEvent.change(screen.getByLabelText('Initial quantity'), { target: { value: quantity } })
}
function save() { fireEvent.click(screen.getByRole('button', { name: 'Save' })) }

it.each(['ADMIN', 'MANAGER', 'EMPLOYEE'])('allows inventory creation only for confirmed %s permissions', async (role) => {
  meMock.mockImplementation(() => Promise.resolve(Response.json({ ...account, role })))
  await start(); await screen.findByText(`Signed in as ${account.email}`)
  expect(screen.queryByRole('button', { name: 'Add inventory' }) !== null).toBe(role !== 'EMPLOYEE')
  if (role === 'EMPLOYEE') {
    listMock.mockImplementation(() => Promise.resolve(Response.json([inventory])))
    fireEvent.click(screen.getByRole('button', { name: 'Products' }))
    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }))
    await screen.findByRole('button', { name: 'Edit quantity for inventory 41' })
  }
})

it('hides creation controls while current-user permissions are unknown', async () => {
  const pending = deferred(); meMock.mockReturnValue(pending.promise)
  await start()
  expect(screen.queryByRole('button', { name: 'Add inventory' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
  await act(async () => pending.resolve(Response.json(account)))
  expect(await screen.findByRole('button', { name: 'Add inventory' })).toBeTruthy()
})

it('loads options only on opening, authenticates both GETs and uses IDs and distinguishing labels', async () => {
  await start()
  expect(listMock.mock.calls.map(([url]) => url)).toEqual(['/api/products', '/api/inventory'])
  await open()
  expect(screen.getByRole<HTMLOptionElement>('option', { name: 'Example crate — EX-1' }).value).toBe('17')
  expect(screen.getByRole<HTMLOptionElement>('option', { name: 'Example depot — Example location' }).value).toBe('27')
  for (const endpoint of ['/api/products', '/api/warehouses']) {
    expect(listMock).toHaveBeenCalledWith(endpoint, {
      headers: { Authorization: `Bearer ${session.token}` }, credentials: 'omit', signal: expect.any(AbortSignal),
    })
  }
  select()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(postMock).not.toHaveBeenCalled()
})

it('shows loading and cancels obsolete option responses when the form is cancelled', async () => {
  await start()
  const pending = deferred()
  listMock.mockReturnValue(pending.promise)
  await open(false)
  expect(screen.getByText('Loading products and warehouses…')).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
  const signal = listMock.mock.calls.at(-1)![1]!.signal!
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(signal.aborted).toBe(true)
  await act(async () => pending.resolve(new Response(null, { status: 401 })))
  expect(screen.getByRole('button', { name: 'Add inventory' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(postMock).not.toHaveBeenCalled()
})

it.each(['products', 'warehouses', 'both'])('explains empty usable %s options without allowing Save', async (empty) => {
  await start()
  listMock.mockImplementation((url) => Promise.resolve(Response.json(
    empty === 'both' || url === `/api/${empty}` ? [] : url === '/api/products' ? [product] : [warehouse])))
  await open()
  if (empty !== 'warehouses') expect(screen.getByText('Create a product first.')).toBeTruthy()
  if (empty !== 'products') expect(screen.getByText('Create a warehouse first.')).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
})

it('excludes missing/invalid IDs but keeps usable records and nullable labels', async () => {
  await start()
  const ids = [null, 0, -1, '12', 1.5, 9007199254740992, undefined]
  listMock.mockImplementation((url) => {
    const record = url === '/api/products' ? product : warehouse
    return Promise.resolve(Response.json([{ ...record, name: null, sku: null, location: null }, ...ids.map((id) => ({ ...record, id }))]))
  })
  await open()
  expect(screen.getAllByRole('option')).toHaveLength(4)
  expect(screen.getByRole<HTMLOptionElement>('option', { name: 'Unnamed product — No SKU' }).value).toBe('17')
  expect(screen.getByRole<HTMLOptionElement>('option', { name: 'Unnamed warehouse — No location' }).value).toBe('27')
})

it.each(['network', 'server', '403', 'json', 'shape'])('handles option %s failure and retries GET only', async (failure) => {
  await start()
  listMock.mockImplementation((url) => {
    if (url !== '/api/products') return Promise.resolve(Response.json([warehouse]))
    if (failure === 'network') return Promise.reject(new Error('private details'))
    return Promise.resolve(failure === 'json' ? new Response('not JSON') : failure === 'shape' ? Response.json([{ id: 17, quantity: 'invalid' }])
      : new Response('private details', { status: failure === '403' ? 403 : 500 }))
  })
  await open(false)
  const error = await screen.findByRole('alert')
  expect(error.textContent).not.toContain('private details')
  if (failure === '403') expect(error.textContent).toContain('Access denied')
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
  listMock.mockImplementation((url) => Promise.resolve(Response.json(url === '/api/products' ? [product] : [warehouse])))
  fireEvent.click(screen.getByRole('button', { name: 'Retry options' }))
  await screen.findByRole('option', { name: 'Example crate — EX-1' })
  expect(postMock).not.toHaveBeenCalled()
})

it('expires current session on option 401', async () => {
  await start(); listMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 401 })))
  await open(false)
  expect((await screen.findByRole('alert')).textContent).toBe('Please sign in again to continue.')
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
})

it.each([0, 6, 2147483647])('creates inventory with quantity %s, exact POST, saving guard and confirmed refresh', async (quantity) => {
  await start(); await open(); select('17', '27', String(quantity))
  const pending = deferred(); postMock.mockReturnValue(pending.promise)
  const form = screen.getByLabelText('Initial quantity').closest('form')!
  const before = listMock.mock.calls.length
  fireEvent.submit(form); fireEvent.submit(form)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Saving…' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
  expect(listMock.mock.calls.length).toBe(before)
  expect(postMock).toHaveBeenCalledExactlyOnceWith('/api/inventory', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    credentials: 'omit', signal: expect.any(AbortSignal),
    body: JSON.stringify({ productId: 17, warehouseId: 27, quantity }),
  })
  expect(screen.queryByText(/Inventory created/)).toBeNull()
  listMock.mockImplementation(() => Promise.resolve(Response.json([{ ...inventory, quantity }])))
  await act(async () => pending.resolve(Response.json({ ...inventory, quantity }, { status: 201 })))
  await screen.findByText(/Inventory created/)
  expect(screen.getByRole('cell', { name: String(quantity) })).toBeTruthy()
  expect(screen.getByRole('table', { name: 'Inventory' })).toBeTruthy()
})

it('does not prohibit an existing product and warehouse combination', async () => {
  await start()
  listMock.mockImplementation((url) => Promise.resolve(Response.json(url === '/api/products' ? [product]
    : url === '/api/warehouses' ? [warehouse] : [inventory])))
  // Revisit to load an existing record with exactly the selected association pair.
  fireEvent.click(screen.getByRole('button', { name: 'Products' }))
  fireEvent.click(screen.getByRole('button', { name: 'Inventory' }))
  await screen.findByRole('cell', { name: '3' })
  await open(); select(); postMock.mockResolvedValue(Response.json({ ...inventory, id: 42 })); save()
  await screen.findByText(/Inventory created/)
  expect(postMock).toHaveBeenCalledTimes(1)
})

it.each(['', ' ', '-1', '1.5', '2147483648', 'abc', '1e3'])('rejects invalid quantity %# locally', async (quantity) => {
  await start(); await open(); select('17', '27', quantity); save()
  expect(screen.getByRole('alert').textContent).toContain('Choose a product and warehouse')
  expect(postMock).not.toHaveBeenCalled()
})

it.each([['', '27'], ['17', ''], ['999', '27'], ['17', '-1']])('rejects unselected/unavailable associations %#', async (productId, warehouseId) => {
  await start(); await open(); select(productId, warehouseId); save()
  await screen.findByRole('alert')
  expect(postMock).not.toHaveBeenCalled()
})

it.each([400, 403, 404, 409, 500])('handles POST %s safely and never retries the mutation', async (status) => {
  await start(); await open(); select()
  postMock.mockResolvedValue(new Response('private details', { status })); save()
  const error = await screen.findByRole('alert')
  expect(error.textContent).not.toContain('private details')
  expect(error.textContent).toMatch(status === 400 ? /rejected/ : status === 403 ? /Access denied/
    : status === 404 ? /not found/ : status === 409 ? /conflict/ : /could not be confirmed/)
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
  if (status === 500) {
    fireEvent.click(screen.getByRole('button', { name: 'Reload inventory' }))
    await screen.findByText('No inventory found.')
  }
  expect(postMock).toHaveBeenCalledTimes(1)
})

it('expires current session on creation 401', async () => {
  await start(); await open(); select(); postMock.mockResolvedValue(new Response(null, { status: 401 })); save()
  expect((await screen.findByRole('alert')).textContent).toBe('Please sign in again to continue.')
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
})

it.each(['network', 'json', 'shape', 'missing-id', 'invalid-id', 'nested'])('handles uncertain %s outcomes with GET reload and no automatic POST retry', async (failure) => {
  await start(); await open(); select()
  if (failure === 'network') postMock.mockRejectedValue(new Error('private details'))
  else postMock.mockResolvedValue(failure === 'json' ? new Response('not JSON') : Response.json(
    failure === 'shape' ? {} : failure === 'missing-id' ? { ...inventory, id: null }
      : failure === 'invalid-id' ? { ...inventory, id: 1.5 } : { ...inventory, product: {} }))
  save()
  expect((await screen.findByRole('alert')).textContent).toContain('Creation could not be confirmed')
  expect(screen.queryByText(/Inventory created/)).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Reload inventory' }))
  await screen.findByText('No inventory found.')
  expect(postMock).toHaveBeenCalledTimes(1)
})

it('preserves confirmed creation when the subsequent inventory load fails', async () => {
  await start(); await open(); select(); postMock.mockResolvedValue(Response.json(inventory))
  listMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 500 })))
  save()
  await screen.findByRole('alert')
  expect(screen.getByText(/Inventory created/)).toBeTruthy()
  expect(screen.queryByText(/Creation could not be confirmed/)).toBeNull()
  listMock.mockImplementation(() => Promise.resolve(Response.json([inventory])))
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByRole('cell', { name: '3' })
  expect(postMock).toHaveBeenCalledTimes(1)
})

it.each(['options', 'save'].flatMap((phase) => ['navigation', 'logout'].flatMap((action) =>
  ['success', '401'].map((outcome) => ({ phase, action, outcome })))))(
  'ignores stale $phase $outcome after $action', async ({ phase, action, outcome }) => {
    await start()
    const pending = deferred()
    if (phase === 'options') {
      listMock.mockImplementation((url) => url === '/api/products' ? pending.promise : Promise.resolve(Response.json([warehouse])))
      await open(false)
    } else { await open(); select(); postMock.mockReturnValue(pending.promise); save() }
    const signal = phase === 'save' ? postMock.mock.calls[0][1]!.signal!
      : listMock.mock.calls.findLast(([url]) => url === '/api/products')![1]!.signal!
    listMock.mockImplementation((url) => Promise.resolve(Response.json(url === '/api/products' ? [product]
      : url === '/api/warehouses' ? [warehouse] : [])))
    if (action === 'navigation') fireEvent.click(screen.getByRole('button', { name: 'Products' }))
    else { fireEvent.click(screen.getByRole('button', { name: 'Logout' })); await signIn() }
    await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 })
      : Response.json(phase === 'options' ? [product] : inventory)))
    expect(signal.aborted).toBe(true)
    expect(screen.getByRole('heading', { name: 'Products' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
    expect(screen.queryByText(/Inventory created/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(postMock).toHaveBeenCalledTimes(phase === 'save' ? 1 : 0)
  },
)

it.each(['options', 'save'].flatMap((phase) => ['success', '401'].map((outcome) => ({ phase, outcome }))))(
  'ignores stale $phase $outcome after direct session change', async ({ phase, outcome }) => {
    const current = { ...session }
    const expire = vi.fn(); const logout = vi.fn()
    const view = render(<Workspace session={current} expireSession={expire} logout={logout} />)
    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }))
    await screen.findByText('No inventory found.')
    const pending = deferred()
    if (phase === 'options') {
      listMock.mockImplementation((url) => url === '/api/products' ? pending.promise : Promise.resolve(Response.json([warehouse])))
      await open(false)
    } else { await open(); select(); postMock.mockReturnValue(pending.promise); save() }
    const signal = phase === 'save' ? postMock.mock.calls[0][1]!.signal!
      : listMock.mock.calls.findLast(([url]) => url === '/api/products')![1]!.signal!
    listMock.mockImplementation(() => Promise.resolve(Response.json([])))
    meMock.mockImplementation(() => Promise.resolve(Response.json({ ...account, role: 'EMPLOYEE' })))
    view.rerender(<Workspace session={{ ...current }} expireSession={expire} logout={logout} />)
    await screen.findByText(`Signed in as ${account.email}`)
    await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 })
      : Response.json(phase === 'options' ? [product] : inventory)))
    expect(signal.aborted).toBe(true)
    expect(expire).not.toHaveBeenCalled()
    expect(screen.queryByText(/Inventory created/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add inventory' })).toBeNull()
  },
)


it('keeps table names and natural labels without developer notes or visible milestones', async () => {
  await start()
  const forbidden = /view only|backend|specified currency|capacity unit|Quantity belongs|Adding a product|Absolute quantity|2147483647/i
  fireEvent.click(screen.getByRole('button', { name: 'Products' }))
  await screen.findByRole('table', { name: 'Products' })
  expect(screen.getByRole('columnheader', { name: 'Quantity' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Add product' }))
  expect(screen.getByLabelText('Quantity')).toBeTruthy()
  expect(screen.getByLabelText('Price')).toBeTruthy()
  expect(document.body.textContent).not.toMatch(forbidden)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Warehouses' }))
  await screen.findByRole('table', { name: 'Warehouses' })
  fireEvent.click(screen.getByRole('button', { name: 'Add warehouse' }))
  expect(screen.getByLabelText('Capacity')).toBeTruthy()
  expect(document.body.textContent).not.toMatch(forbidden)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  listMock.mockImplementation((url) => Promise.resolve(Response.json(url === '/api/products' ? [product]
    : url === '/api/warehouses' ? [warehouse] : [inventory])))
  fireEvent.click(screen.getByRole('button', { name: 'Inventory' }))
  await screen.findByRole('table', { name: 'Inventory' })
  fireEvent.click(screen.getByRole('button', { name: 'Edit quantity for inventory 41' }))
  expect(document.body.textContent).not.toMatch(forbidden)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await open()
  expect(document.body.textContent).not.toMatch(forbidden)
})
