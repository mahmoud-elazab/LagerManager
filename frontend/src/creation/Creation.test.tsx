import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { Workspace } from '../resources/Workspace'
import type { CreationResource } from './createApi'

const account = { email: 'fictional@example.com', role: 'ADMIN' }
const session = { token: 'fictional-session', tokenType: 'Bearer' }
const product = { id: 17, name: 'Example crate', sku: 'EX-1', description: 'Example description', category: 'Storage', quantity: 3, price: 12.5 }
const warehouse = { id: 27, name: 'Example depot', location: 'Example location', capacity: 40 }
const fetchMock = vi.fn<typeof fetch>()
const meMock = vi.fn<typeof fetch>()
const postMock = vi.fn<typeof fetch>()
const listMock = vi.fn<typeof fetch>()
const resources: CreationResource[] = ['products', 'warehouses']

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  meMock.mockImplementation(() => Promise.resolve(Response.json(account)))
  listMock.mockImplementation(() => Promise.resolve(Response.json([])))
  fetchMock.mockImplementation((url, init) => {
    if (url === '/api/auth/login') return Promise.resolve(Response.json(session))
    if (url === '/api/auth/me') return meMock(url, init)
    if (init?.method === 'POST') return postMock(url, init)
    return listMock(url, init)
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetchMock.mockReset(); meMock.mockReset(); postMock.mockReset(); listMock.mockReset() })
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
async function start() { render(<App />); await signIn() }
function singular(resource: CreationResource) { return resource === 'products' ? 'product' : 'warehouse' }
async function open(resource: CreationResource) {
  if (resource === 'warehouses') fireEvent.click(screen.getByRole('button', { name: 'Warehouses' }))
  fireEvent.click(await screen.findByRole('button', { name: `Add ${singular(resource)}` }))
}
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
function fill(resource: CreationResource) {
  change('Name', resource === 'products' ? product.name : warehouse.name)
  if (resource === 'products') {
    change('SKU', product.sku); change('Description', product.description); change('Category', product.category)
    change('Quantity', '3'); change('Price', '12.50')
  } else { change('Location', warehouse.location); change('Capacity', '40') }
}
function save() { fireEvent.click(screen.getByRole('button', { name: 'Save' })) }

it('loads me with Bearer auth and keeps controls hidden until confirmed', async () => {
  const pending = deferred(); meMock.mockReturnValue(pending.promise)
  await start()
  expect(screen.getByText('Loading your account…')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Add product' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
  expect(meMock).toHaveBeenCalledWith('/api/auth/me', {
    headers: { Authorization: `Bearer ${session.token}` }, credentials: 'omit', signal: expect.any(AbortSignal),
  })
  await act(async () => pending.resolve(Response.json(account)))
  expect(await screen.findByRole('button', { name: 'Add product' })).toBeTruthy()
})

it.each(['ADMIN', 'MANAGER', 'EMPLOYEE'])('shows only allowed creation controls for %s', async (role) => {
  meMock.mockImplementation(() => Promise.resolve(Response.json({ ...account, role })))
  await start(); await screen.findByText(`Signed in as ${account.email}`)
  expect(screen.queryByRole('button', { name: 'Add product' }) !== null).toBe(role !== 'EMPLOYEE')
  fireEvent.click(screen.getByRole('button', { name: 'Warehouses' }))
  expect(screen.queryByRole('button', { name: 'Add warehouse' }) !== null).toBe(role !== 'EMPLOYEE')
  if (role === 'EMPLOYEE') {
    listMock.mockResolvedValue(Response.json([{ id: 9, product, warehouse, quantity: 2 }]))
    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }))
    expect(await screen.findByRole('button', { name: 'Edit quantity for inventory 9' })).toBeTruthy()
  }
})

it.each([null, {}, { ...account, email: '' }, { ...account, email: 'invalid' }, { ...account, email: 1 },
  { ...account, role: 'SUPERUSER' }, { ...account, role: null }])('rejects unverified account response %# and permits Retry', async (body) => {
  meMock.mockResolvedValueOnce(Response.json(body))
  await start()
  expect((await screen.findByRole('alert')).textContent).toBe('Unexpected account response. Please try again later.')
  expect(screen.queryByRole('button', { name: 'Add product' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry account' }))
  await screen.findByRole('button', { name: 'Add product' })
})

it.each(['network', 'json', '403', '500'])('handles account %s safely without clearing the session', async (outcome) => {
  if (outcome === 'network') meMock.mockRejectedValueOnce(new Error('private details'))
  else meMock.mockResolvedValueOnce(new Response(outcome === 'json' ? 'not JSON' : 'private details', { status: outcome === 'json' ? 200 : Number(outcome) }))
  await start()
  expect((await screen.findByRole('alert')).textContent).not.toContain('private details')
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Add product' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry account' }))
  await screen.findByRole('button', { name: 'Add product' })
})

it('expires the current session on me 401', async () => {
  meMock.mockResolvedValue(new Response(null, { status: 401 }))
  render(<App />)
  change('Email', account.email); change('Password', 'fictional-input')
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Please sign in again to continue.')
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
})

it.each(['success', '401'])('ignores old me %s after logout and new login', async (outcome) => {
  const pending = deferred(); meMock.mockReturnValueOnce(pending.promise)
  await start()
  const signal = meMock.mock.calls[0][1]!.signal!
  fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
  meMock.mockImplementation(() => Promise.resolve(Response.json({ ...account, role: 'EMPLOYEE' })))
  await signIn(); await screen.findByText(`Signed in as ${account.email}`)
  await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 }) : Response.json(account)))
  expect(signal.aborted).toBe(true)
  expect(screen.queryByRole('button', { name: 'Add product' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
})

it.each(resources)('cancels %s without sending POST', async (resource) => {
  await start(); await open(resource); fill(resource)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(postMock).not.toHaveBeenCalled()
})

it.each(resources)('creates %s with exact payload and refreshes only after confirmation', async (resource) => {
  const pending = deferred(); postMock.mockReturnValue(pending.promise)
  await start(); await open(resource); fill(resource)
  const before = listMock.mock.calls.length
  const form = screen.getByLabelText('Name').closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  expect(postMock).toHaveBeenCalledTimes(1)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Saving…' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
  expect(listMock.mock.calls.length).toBe(before)
  const payload = resource === 'products' ? '{"name":"Example crate","sku":"EX-1","description":"Example description","category":"Storage","quantity":3,"price":12.50}'
    : '{"name":"Example depot","location":"Example location","capacity":40}'
  expect(postMock).toHaveBeenCalledWith(`/api/${resource}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    credentials: 'omit', signal: expect.any(AbortSignal), body: payload,
  })
  listMock.mockImplementation(() => Promise.resolve(Response.json([resource === 'products' ? product : warehouse])))
  await act(async () => pending.resolve(Response.json(resource === 'products' ? product : warehouse, { status: 201 })))
  await screen.findByRole('cell', { name: resource === 'products' ? product.name : warehouse.name })
  expect(screen.getByText(/created\. The list is refreshing/)).toBeTruthy()
  expect(postMock).toHaveBeenCalledTimes(1)
})

it('preserves price decimal digits without rounding input and accepts zero', async () => {
  postMock.mockResolvedValue(Response.json(product))
  await start(); await open('products'); fill('products')
  change('Quantity', '0'); change('Price', '0.123456789012345678901')
  save()
  await screen.findByText(/Product created/)
  expect(postMock.mock.calls[0][1]!.body).toContain('"price":0.123456789012345678901')
  expect(postMock.mock.calls[0][1]!.body).toContain('"quantity":0')
})

it('accepts zero capacity', async () => {
  postMock.mockResolvedValue(Response.json({ ...warehouse, capacity: 0 }))
  await start(); await open('warehouses'); fill('warehouses'); change('Capacity', '0'); save()
  await screen.findByText(/Warehouse created/)
  expect(JSON.parse(postMock.mock.calls[0][1]!.body as string).capacity).toBe(0)
})

const invalid = [
  ['products', 'Name', ' '], ['products', 'SKU', ''], ['products', 'Quantity', ''],
  ['products', 'Quantity', '-1'], ['products', 'Quantity', '1.5'], ['products', 'Quantity', '2147483648'],
  ['products', 'Price', ''], ['products', 'Price', '-1'], ['products', 'Price', '1e3'], ['products', 'Price', 'NaN'],
  ['warehouses', 'Name', ''], ['warehouses', 'Location', ' '], ['warehouses', 'Capacity', ''],
  ['warehouses', 'Capacity', '-1'], ['warehouses', 'Capacity', '1.5'], ['warehouses', 'Capacity', '2147483648'],
] as const
it.each(invalid)('rejects invalid %s %s %# locally', async (resource, field, value) => {
  await start(); await open(resource); fill(resource); change(field, value); save()
  expect(screen.getByRole('alert').textContent).toContain('Check the required details')
  expect(postMock).not.toHaveBeenCalled()
})

it.each(resources.flatMap((resource) => [400, 403, 409, 500].map((status) => ({ resource, status }))))(
  'handles $resource POST $status safely without retry', async ({ resource, status }) => {
    postMock.mockResolvedValue(new Response('private details', { status }))
    await start(); await open(resource); fill(resource); save()
    const error = await screen.findByRole('alert')
    expect(error.textContent).not.toContain('private details')
    expect(error.textContent).toMatch(status === 400 ? /rejected/ : status === 403 ? /Access denied/ : status === 409 ? /conflict/ : /could not be confirmed/)
    expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
    if (status === 500) {
      fireEvent.click(screen.getByRole('button', { name: 'Reload list' }))
      await screen.findByText(`No ${resource} found.`)
    }
    expect(postMock).toHaveBeenCalledTimes(1)
  },
)

it.each(resources.flatMap((resource) => ['network', 'json', 'shape', 'missing-id'].map((failure) => ({ resource, failure }))))(
  'handles uncertain $resource $failure and reloads using GET only', async ({ resource, failure }) => {
    if (failure === 'network') postMock.mockRejectedValue(new Error('private details'))
    else postMock.mockResolvedValue(failure === 'json' ? new Response('not JSON') : Response.json(failure === 'shape' ? {} : { ...(resource === 'products' ? product : warehouse), id: null }))
    await start(); await open(resource); fill(resource); save()
    expect((await screen.findByRole('alert')).textContent).toContain('Creation could not be confirmed')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reload list' }))
    await screen.findByText(`No ${resource} found.`)
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/created\. The list/)).toBeNull()
  },
)

it.each(resources)('distinguishes confirmed %s creation from a subsequent list-load failure', async (resource) => {
  postMock.mockResolvedValue(Response.json(resource === 'products' ? product : warehouse))
  await start(); await open(resource); fill(resource)
  listMock.mockResolvedValue(new Response(null, { status: 500 }))
  save()
  await screen.findByRole('alert')
  expect(screen.getByText(/created\. The list is refreshing/)).toBeTruthy()
  expect(screen.queryByText(/Creation could not be confirmed/)).toBeNull()
  listMock.mockImplementation(() => Promise.resolve(Response.json([])))
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText(`No ${resource} found.`)
  expect(postMock).toHaveBeenCalledTimes(1)
})

it.each(resources)('expires session on %s POST 401', async (resource) => {
  postMock.mockResolvedValue(new Response(null, { status: 401 }))
  await start(); await open(resource); fill(resource); save()
  expect((await screen.findByRole('alert')).textContent).toBe('Please sign in again to continue.')
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
})

it.each(resources.flatMap((resource) => ['navigation', 'logout'].flatMap((action) => ['success', '401'].map((outcome) => ({ resource, action, outcome })))))(
  'ignores stale $resource $outcome after $action', async ({ resource, action, outcome }) => {
    const pending = deferred(); postMock.mockReturnValue(pending.promise)
    await start(); await open(resource); fill(resource); save()
    const signal = postMock.mock.calls[0][1]!.signal!
    if (action === 'navigation') fireEvent.click(screen.getByRole('button', { name: 'Inventory' }))
    else { fireEvent.click(screen.getByRole('button', { name: 'Logout' })); await signIn() }
    await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 })
      : Response.json(resource === 'products' ? product : warehouse)))
    expect(signal.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
    expect(screen.queryByText(/created\. The list/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(postMock).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('heading', { name: action === 'navigation' ? 'Inventory' : 'Products' })).toBeTruthy())
  },
)

it.each(resources.flatMap((resource) => ['success', '401'].map((outcome) => ({ resource, outcome }))))(
  'ignores $resource $outcome after a direct session replacement', async ({ resource, outcome }) => {
    const pending = deferred()
    postMock.mockReturnValue(pending.promise)
    meMock.mockResolvedValueOnce(Response.json(account))
      .mockImplementation(() => Promise.resolve(Response.json({ ...account, role: 'EMPLOYEE' })))
    const expire = vi.fn()
    const logout = vi.fn()
    const current = { ...session, tokenType: 'Bearer' as const }
    const view = render(<Workspace session={current} logout={logout} expireSession={expire} />)
    await open(resource); fill(resource); save()
    const signal = postMock.mock.calls[0][1]!.signal!
    view.rerender(<Workspace session={{ ...current }} logout={logout} expireSession={expire} />)
    await screen.findByText(`Signed in as ${account.email}`)
    await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 })
      : Response.json(resource === 'products' ? product : warehouse)))
    expect(signal.aborted).toBe(true)
    expect(expire).not.toHaveBeenCalled()
    expect(screen.queryByText(/created\. The list/)).toBeNull()
    expect(screen.queryByRole('button', { name: `Add ${singular(resource)}` })).toBeNull()
  },
)

it.each(['success', '401'])('ignores old account %s after direct session replacement', async (outcome) => {
  const pending = deferred()
  meMock.mockReturnValueOnce(pending.promise)
    .mockImplementation(() => Promise.resolve(Response.json({ ...account, role: 'EMPLOYEE' })))
  const expire = vi.fn()
  const logout = vi.fn()
  const current = { ...session, tokenType: 'Bearer' as const }
  const view = render(<Workspace session={current} logout={logout} expireSession={expire} />)
  const signal = meMock.mock.calls[0][1]!.signal!
  view.rerender(<Workspace session={{ ...current }} logout={logout} expireSession={expire} />)
  await screen.findByText(`Signed in as ${account.email}`)
  await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 }) : Response.json(account)))
  expect(signal.aborted).toBe(true)
  expect(expire).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Add product' })).toBeNull()
})
