import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { Workspace } from '../resources/Workspace'
import type { EditableResource } from './updateApi'

const session = { token: 'fictional-session', tokenType: 'Bearer' as const }
const account = { email: 'fictional@example.com', role: 'ADMIN' }
const product = { id: 17, name: 'Example crate', sku: 'EX-1', description: 'Keep this description', category: 'Storage', totalStock: 3, price: 12.5 }
const warehouse = { id: 27, name: 'Example depot', location: 'Example location', capacity: 40 }
const resources: EditableResource[] = ['products', 'warehouses']
const fetchMock = vi.fn<typeof fetch>()
const meMock = vi.fn<typeof fetch>()
const listMock = vi.fn<typeof fetch>()
const putMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  meMock.mockImplementation(() => Promise.resolve(Response.json(account)))
  listMock.mockImplementation((url) => Promise.resolve(Response.json(url === '/api/products' ? [product]
    : url === '/api/warehouses' ? [warehouse] : [])))
  fetchMock.mockImplementation((url, init) => {
    if (url === '/api/auth/login') return Promise.resolve(Response.json(session))
    if (url === '/api/auth/me') return meMock(url, init)
    if (init?.method === 'PUT') return putMock(url, init)
    return listMock(url, init)
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetchMock.mockReset(); meMock.mockReset(); listMock.mockReset(); putMock.mockReset() })
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}
function singular(resource: EditableResource) { return resource === 'products' ? 'product' : 'warehouse' }
function record(resource: EditableResource) { return resource === 'products' ? product : warehouse }
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
async function signIn() {
  change('Email', account.email); change('Password', 'fictional-input')
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('heading', { name: 'Products' })
}
async function start(resource: EditableResource = 'products') {
  render(<App />); await signIn()
  if (resource === 'warehouses') fireEvent.click(screen.getByRole('button', { name: 'Warehouses' }))
  await screen.findByRole('table', { name: resource === 'products' ? 'Products' : 'Warehouses' })
}
async function edit(resource: EditableResource, id = record(resource).id) {
  fireEvent.click(await screen.findByRole('button', { name: `Edit ${singular(resource)} ${id}` }))
}
function save() { fireEvent.click(screen.getByRole('button', { name: 'Save' })) }
function singleHeader() {
  const buttons = screen.getAllByRole('button', { name: 'Logout' })
  expect(buttons).toHaveLength(1)
  const header = buttons[0].closest('header')!
  expect(header.getAttribute('aria-label')).toBe('Workspace')
  expect(header.querySelector('h1')?.textContent).toBe('LagerManager')
  const nav = screen.getByRole('navigation', { name: 'Resources' })
  expect(header.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

it.each(resources.flatMap((resource) => ['ADMIN', 'MANAGER', 'EMPLOYEE'].map((role) => ({ resource, role }))))(
  'permits $resource editing controls only for confirmed $role', async ({ resource, role }) => {
    meMock.mockImplementation(() => Promise.resolve(Response.json({ ...account, role })))
    await start(resource); await screen.findByText(`Signed in as ${account.email}`)
    expect(screen.queryByRole('button', { name: `Edit ${singular(resource)} ${record(resource).id}` }) !== null).toBe(role !== 'EMPLOYEE')
    singleHeader()
  },
)

it.each(resources)('hides %s Edit before role confirmation and excludes unusable record IDs', async (resource) => {
  const pending = deferred(); meMock.mockReturnValue(pending.promise)
  const value = record(resource)
  listMock.mockImplementation(() => Promise.resolve(Response.json([value, { ...value, id: null }, { ...value, id: 0 }, { ...value, id: -1 }])))
  await start(resource)
  expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
  await act(async () => pending.resolve(Response.json(account)))
  expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(1)
})

it.each(resources)('populates every %s field and cancels without mutation', async (resource) => {
  await start(resource); await edit(resource)
  expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe(record(resource).name)
  if (resource === 'products') {
    for (const [label, value] of [['SKU', product.sku], ['Description', product.description], ['Category', product.category], ['Price', '12.5']]) {
      expect(screen.getByLabelText<HTMLInputElement>(label).value).toBe(value)
    }
  } else {
    expect(screen.getByLabelText<HTMLInputElement>('Location').value).toBe(warehouse.location)
    expect(screen.getByLabelText<HTMLInputElement>('Capacity').value).toBe('40')
  }
  expect(screen.queryByLabelText(/^ID$/i)).toBeNull()
  change('Name', 'Unsaved value'); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(putMock).not.toHaveBeenCalled()
  expect(screen.getByRole('cell', { name: record(resource).name })).toBeTruthy()
})

it.each(resources)('sends an exact matching-ID authenticated %s PUT and confirms before list refresh', async (resource) => {
  const pending = deferred(); putMock.mockReturnValue(pending.promise)
  await start(resource); await edit(resource)
  const initialReads = listMock.mock.calls.length
  const form = screen.getByLabelText('Name').closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  singleHeader()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Saving…' }).disabled).toBe(true)
  expect(screen.getByLabelText<HTMLInputElement>('Name').disabled).toBe(true)
  expect(listMock.mock.calls.length).toBe(initialReads)
  const body = resource === 'products' ? '{"name":"Example crate","sku":"EX-1","description":"Keep this description","category":"Storage","price":12.5}'
    : '{"name":"Example depot","location":"Example location","capacity":40}'
  expect(putMock).toHaveBeenCalledExactlyOnceWith(`/api/${resource}/${record(resource).id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    credentials: 'omit', signal: expect.any(AbortSignal), body,
  })
  expect(screen.queryByText(/updated\. If/)).toBeNull()
  await act(async () => pending.resolve(Response.json(record(resource))))
  await screen.findByText(/updated\. If/)
  expect(listMock.mock.calls.length).toBe(initialReads + 1)
})

it('preserves untouched null optional fields and only replaces them when deliberately changed', async () => {
  const nullable = { ...product, description: null, category: null }
  listMock.mockImplementation(() => Promise.resolve(Response.json([nullable])))
  putMock.mockImplementation(() => Promise.resolve(Response.json(nullable)))
  await start(); await edit('products'); save()
  await screen.findByText(/Product updated/)
  expect(JSON.parse(putMock.mock.calls[0][1]!.body as string)).toMatchObject({ description: null, category: null })
  await edit('products')
  change('Description', 'New description'); change('Category', 'New category'); save()
  await screen.findByText(/Product updated/)
  expect(JSON.parse(putMock.mock.calls[1][1]!.body as string)).toMatchObject({ description: 'New description', category: 'New category' })
})

it('preserves existing description/spacing and deliberately cleared optional fields', async () => {
  const value = { ...product, name: '  Example crate  ' }
  listMock.mockImplementation(() => Promise.resolve(Response.json([value])))
  putMock.mockResolvedValue(Response.json(value))
  await start(); await edit('products'); change('Category', ''); save()
  await screen.findByText(/Product updated/)
  expect(JSON.parse(putMock.mock.calls[0][1]!.body as string)).toMatchObject({ name: value.name, description: product.description, category: '' })
})

it('preserves original precise decimal price on opening/saving and sends edited decimals without rounding', async () => {
  const raw = JSON.stringify(product).replace('"price":12.5', '"price":0.123456789012345678901')
  listMock.mockImplementation(() => Promise.resolve(new Response(`[${raw}]`)))
  putMock.mockImplementation(() => Promise.resolve(Response.json(product)))
  await start(); await edit('products')
  expect(screen.getByLabelText<HTMLInputElement>('Price').value).toBe('0.123456789012345678901')
  save(); await screen.findByText(/Product updated/)
  expect(putMock.mock.calls[0][1]!.body).toContain('"price":0.123456789012345678901')
  await edit('products'); change('Price', '123.000000000000000000001'); save()
  await screen.findByText(/Product updated/)
  expect(putMock.mock.calls[1][1]!.body).toContain('"price":123.000000000000000000001')
})

it('expands exponent prices exactly for the edit form', async () => {
  const raw = JSON.stringify(product).replace('"price":12.5', '"price":1e-7')
  listMock.mockImplementation(() => Promise.resolve(new Response(`[${raw}]`)))
  await start(); await edit('products')
  expect(screen.getByLabelText<HTMLInputElement>('Price').value).toBe('0.0000001')
})

it('rejects malformed description data instead of dropping it', async () => {
  listMock.mockImplementation(() => Promise.resolve(Response.json([{ ...product, description: 42 }])))
  render(<App />); await signIn()
  expect((await screen.findByRole('alert')).textContent).toBe('Unexpected product response. Please try again later.')
  expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull()
})

it.each(resources)('accepts zero values for %s', async (resource) => {
  putMock.mockResolvedValue(Response.json(record(resource)))
  await start(resource); await edit(resource)
  change(resource === 'products' ? 'Price' : 'Capacity', '0')
  save(); await screen.findByText(/updated\. If/)
  const body = JSON.parse(putMock.mock.calls[0][1]!.body as string)
  expect(body[resource === 'products' ? 'price' : 'capacity']).toBe(0)
  if (resource === 'products') expect(body).not.toHaveProperty('quantity')
})

it.each([
  ['products', 'Name', ' '], ['products', 'SKU', ''],  
    ['products', 'Price', ''],
  ['products', 'Price', '-1'], ['products', 'Price', '1e3'], ['products', 'Price', 'not a price'],
  ['warehouses', 'Name', ''], ['warehouses', 'Location', ' '], ['warehouses', 'Capacity', ''],
  ['warehouses', 'Capacity', '-1'], ['warehouses', 'Capacity', '1.5'], ['warehouses', 'Capacity', '2147483648'],
] as const)('rejects invalid %s %s %# without PUT', async (resource, field, value) => {
  await start(resource); await edit(resource); change(field, value); save()
  expect(screen.getByRole('alert').textContent).toContain('Check the required details')
  expect(putMock).not.toHaveBeenCalled()
})

it.each(resources.flatMap((resource) => [400, 403, 404, 409, 500].map((status) => ({ resource, status }))))(
  'handles $resource PUT $status without mutation retry', async ({ resource, status }) => {
    putMock.mockResolvedValue(new Response('private details', { status }))
    await start(resource); await edit(resource); save()
    const error = await screen.findByRole('alert')
    expect(error.textContent).toMatch(status === 400 ? /rejected/ : status === 403 ? /Editing is not permitted/
      : status === 404 ? /not found/ : status === 409 ? /conflict/ : /could not be confirmed/)
    expect(error.textContent).not.toContain('private details')
    singleHeader()
    if ([403, 404, 500].includes(status)) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Reload list' }))
      await screen.findByRole('table')
    }
    expect(putMock).toHaveBeenCalledTimes(1)
  },
)

it.each(resources.flatMap((resource) => ['network', 'json', 'null', 'shape', 'id', 'missing-id'].map((failure) => ({ resource, failure }))))(
  'rejects $resource uncertain $failure responses without false success or retry', async ({ resource, failure }) => {
    if (failure === 'network') putMock.mockRejectedValue(new Error('private details'))
    else putMock.mockResolvedValue(failure === 'json' ? new Response('not JSON') : Response.json(failure === 'null' ? null
      : failure === 'shape' ? {} : { ...record(resource), id: failure === 'id' ? 99 : null }))
    await start(resource); await edit(resource); save()
    expect((await screen.findByRole('alert')).textContent).toContain('Save could not be confirmed')
    expect(screen.queryByText(/updated\. If/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reload list' }))
    await screen.findByRole('table')
    expect(putMock).toHaveBeenCalledTimes(1)
  },
)

it.each(resources)('distinguishes confirmed %s update from list-refresh failure', async (resource) => {
  putMock.mockResolvedValue(Response.json(record(resource)))
  await start(resource); await edit(resource)
  listMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 500 })))
  save(); await screen.findByRole('alert')
  expect(screen.getByText(/updated\. If/)).toBeTruthy()
  expect(screen.queryByText(/Save could not be confirmed/)).toBeNull()
  listMock.mockImplementation(() => Promise.resolve(Response.json([record(resource)])))
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByRole('table')
  expect(putMock).toHaveBeenCalledTimes(1)
})

it.each(resources)('expires the current session on %s PUT 401', async (resource) => {
  putMock.mockResolvedValue(new Response(null, { status: 401 }))
  await start(resource); await edit(resource); save()
  expect((await screen.findByRole('alert')).textContent).toBe('Please sign in again to continue.')
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull()
})

it.each(resources.flatMap((resource) => ['navigation', 'logout'].flatMap((action) => ['success', '401'].map((outcome) => ({ resource, action, outcome })))))(
  'ignores $resource stale $outcome after $action', async ({ resource, action, outcome }) => {
    const pending = deferred(); putMock.mockReturnValue(pending.promise)
    await start(resource); await edit(resource); save()
    const signal = putMock.mock.calls[0][1]!.signal!
    if (action === 'navigation') fireEvent.click(screen.getByRole('button', { name: 'Inventory' }))
    else { fireEvent.click(screen.getByRole('button', { name: 'Logout' })); await signIn() }
    await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 }) : Response.json(record(resource))))
    expect(signal.aborted).toBe(true)
    expect(screen.queryByText(/updated\. If/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    singleHeader()
  },
)

it.each(resources.flatMap((resource) => ['success', '401'].map((outcome) => ({ resource, outcome }))))(
  'ignores $resource stale $outcome after selecting another record', async ({ resource, outcome }) => {
    const first = record(resource), second = { ...first, id: first.id + 1, name: 'Other record' }
    listMock.mockImplementation(() => Promise.resolve(Response.json([first, second])))
    const pending = deferred(); putMock.mockReturnValue(pending.promise)
    await start(resource); await edit(resource); save()
    const signal = putMock.mock.calls[0][1]!.signal!
    await edit(resource, second.id)
    await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 }) : Response.json(first)))
    expect(signal.aborted).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Other record')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/updated\. If/)).toBeNull()
    expect(putMock).toHaveBeenCalledTimes(1)
  },
)

it.each(resources.flatMap((resource) => ['success', '401'].map((outcome) => ({ resource, outcome }))))(
  'ignores $resource stale $outcome on direct session replacement', async ({ resource, outcome }) => {
    const pending = deferred(); putMock.mockReturnValue(pending.promise)
    const expire = vi.fn(), logout = vi.fn()
    const view = render(<Workspace session={session} logout={logout} expireSession={expire} />)
    if (resource === 'warehouses') fireEvent.click(screen.getByRole('button', { name: 'Warehouses' }))
    await edit(resource); save()
    const signal = putMock.mock.calls[0][1]!.signal!
    view.rerender(<Workspace session={{ ...session }} logout={logout} expireSession={expire} />)
    await screen.findByRole('table')
    await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 }) : Response.json(record(resource))))
    expect(signal.aborted).toBe(true)
    expect(expire).not.toHaveBeenCalled()
    expect(screen.queryByText(/updated\. If/)).toBeNull()
    expect(screen.queryByLabelText('Name')).toBeNull()
  },
)

it.each(['products', 'warehouses', 'inventory'])('has exactly one shared Logout while %s loads and fails', async (resource) => {
  const pending = deferred()
  meMock.mockImplementation(() => Promise.resolve(Response.json({ ...account, role: 'EMPLOYEE' })))
  render(<App />); await signIn()
  listMock.mockReturnValue(pending.promise)
  if (resource === 'products') {
    fireEvent.click(screen.getByRole('button', { name: 'Warehouses' }))
    fireEvent.click(screen.getByRole('button', { name: 'Products' }))
  } else fireEvent.click(screen.getByRole('button', { name: resource === 'warehouses' ? 'Warehouses' : 'Inventory' }))
  singleHeader()
  await act(async () => pending.resolve(new Response(null, { status: 500 })))
  await screen.findByRole('alert')
  singleHeader()
})

it('keeps one shared Logout during current-user loading and errors', async () => {
  const pending = deferred(); meMock.mockReturnValue(pending.promise)
  render(<App />); await signIn(); singleHeader()
  await act(async () => pending.resolve(new Response(null, { status: 500 })))
  await screen.findByRole('alert'); singleHeader()
  expect(screen.getByRole('button', { name: 'Retry account' })).toBeTruthy()
})
