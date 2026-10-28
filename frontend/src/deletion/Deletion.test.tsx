import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { Workspace } from '../resources/Workspace'
import type { DeletableResource } from './deleteApi'

const session = { token: 'fictional-session', tokenType: 'Bearer' as const }
const account = { email: 'fictional@example.com', role: 'ADMIN' }
const product = { id: 17, name: 'Example crate', sku: 'EX-1', description: 'Example description', category: null, quantity: 3, price: 12.5 }
const warehouse = { id: 27, name: 'Example depot', location: 'Example location', capacity: 40 }
const inventory = { id: 41, product, warehouse, quantity: 4 }
const resources: DeletableResource[] = ['products', 'warehouses', 'inventory']
const fetchMock = vi.fn<typeof fetch>()
const meMock = vi.fn<typeof fetch>()
const listMock = vi.fn<typeof fetch>()
const deleteMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  meMock.mockImplementation(() => Promise.resolve(Response.json(account)))
  listMock.mockImplementation((url) => Promise.resolve(Response.json([url === '/api/products' ? product
    : url === '/api/warehouses' ? warehouse : inventory])))
  fetchMock.mockImplementation((url, init) => {
    if (url === '/api/auth/login') return Promise.resolve(Response.json(session))
    if (url === '/api/auth/me') return meMock(url, init)
    if (init?.method === 'DELETE') return deleteMock(url, init)
    return listMock(url, init)
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetchMock.mockReset(); meMock.mockReset(); listMock.mockReset(); deleteMock.mockReset() })
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}
function record(resource: DeletableResource) { return resource === 'products' ? product : resource === 'warehouses' ? warehouse : inventory }
function label(resource: DeletableResource) { return resource === 'products' ? 'product' : resource === 'warehouses' ? 'warehouse' : 'inventory' }
function title(resource: DeletableResource) { return resource[0].toUpperCase() + resource.slice(1) }
async function signIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: account.email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional-input' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('heading', { name: 'Products' })
}
async function start(resource: DeletableResource) {
  render(<App />); await signIn()
  if (resource !== 'products') fireEvent.click(screen.getByRole('button', { name: title(resource) }))
  await screen.findByRole('table', { name: title(resource) })
}
async function confirm(resource: DeletableResource, id = record(resource).id) {
  fireEvent.click(await screen.findByRole('button', { name: `Delete ${label(resource)} ${id}` }))
}
function remove() { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) }
function oneHeader() {
  const buttons = screen.getAllByRole('button', { name: 'Logout' })
  expect(buttons).toHaveLength(1)
  expect(buttons[0].closest('header')?.getAttribute('aria-label')).toBe('Workspace')
}

it.each(resources.flatMap((resource) => ['ADMIN', 'MANAGER', 'EMPLOYEE'].map((role) => ({ resource, role }))))(
  'shows $resource Delete only for confirmed $role permissions', async ({ resource, role }) => {
    meMock.mockImplementation(() => Promise.resolve(Response.json({ ...account, role })))
    await start(resource); await screen.findByText(`Signed in as ${account.email}`)
    expect(screen.queryByRole('button', { name: `Delete ${label(resource)} ${record(resource).id}` }) !== null).toBe(role === 'ADMIN')
    if (resource !== 'inventory') expect(screen.queryByRole('button', { name: /^Edit / }) !== null).toBe(role !== 'EMPLOYEE')
    else expect(screen.getByRole('button', { name: 'Edit quantity for inventory 41' })).toBeTruthy()
    oneHeader()
  },
)

it.each(resources)('hides %s Delete until account role is verified', async (resource) => {
  const pending = deferred(); meMock.mockReturnValue(pending.promise)
  await start(resource)
  expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull()
  await act(async () => pending.resolve(Response.json(account)))
  expect(await screen.findByRole('button', { name: `Delete ${label(resource)} ${record(resource).id}` })).toBeTruthy()
})

it.each(resources)('targets only usable actual %s IDs', async (resource) => {
  const item = record(resource)
  listMock.mockImplementation(() => Promise.resolve(Response.json([item, { ...item, id: null }, { ...item, id: 0 }, { ...item, id: -1 }])))
  await start(resource); await screen.findByText(`Signed in as ${account.email}`)
  expect(screen.getAllByRole('button', { name: /^Delete / })).toHaveLength(1)
  await confirm(resource)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(deleteMock).not.toHaveBeenCalled()
})

it.each(resources)('identifies %s confirmation and Cancel does not DELETE', async (resource) => {
  await start(resource); await confirm(resource)
  const panel = screen.getByRole('region', { name: `Delete ${label(resource)}?` })
  if (resource !== 'warehouses') {
    expect(panel.textContent).toContain(product.name)
    expect(panel.textContent).toContain(product.sku)
  }
  if (resource !== 'products') {
    expect(panel.textContent).toContain(warehouse.name)
    expect(panel.textContent).toContain(warehouse.location)
  }
  expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(deleteMock).not.toHaveBeenCalled()
  expect(screen.getByRole('table')).toBeTruthy()
})

it.each(resources)('uses fallbacks for missing %s names and associations', async (resource) => {
  const item = resource === 'products' ? { ...product, name: null, sku: null } : resource === 'warehouses'
    ? { ...warehouse, name: null, location: null } : { ...inventory, product: null, warehouse: null }
  listMock.mockImplementation(() => Promise.resolve(Response.json([item])))
  await start(resource); await confirm(resource)
  const panel = screen.getByRole('region', { name: `Delete ${label(resource)}?` })
  if (resource !== 'warehouses') expect(panel.textContent).toContain('Unnamed product')
  if (resource !== 'products') expect(panel.textContent).toContain('Unnamed warehouse')
})

it.each(resources.flatMap((resource) => [200, 204].map((status) => ({ resource, status }))))(
  'accepts empty $status for $resource, guards duplicates and refreshes only after success', async ({ resource, status }) => {
    const pending = deferred(); deleteMock.mockReturnValue(pending.promise)
    await start(resource); await confirm(resource)
    const form = screen.getByRole('button', { name: 'Delete' }).closest('form')!
    const before = listMock.mock.calls.length
    fireEvent.submit(form); fireEvent.submit(form)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Deleting…' }).disabled).toBe(true)
    expect(screen.getByText(`Deleting ${label(resource)}…`)).toBeTruthy()
    oneHeader()
    expect(listMock.mock.calls.length).toBe(before)
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.queryByText(/removal request completed/)).toBeNull()
    expect(deleteMock).toHaveBeenCalledExactlyOnceWith(`/api/${resource}/${record(resource).id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` }, credentials: 'omit', signal: expect.any(AbortSignal),
    })
    expect(deleteMock.mock.calls[0][1]).not.toHaveProperty('body')
    listMock.mockImplementation(() => Promise.resolve(Response.json([])))
    await act(async () => pending.resolve(new Response(status === 204 ? null : '', { status })))
    await screen.findByText(`No ${resource} found.`)
    expect(screen.getByText(/removal request completed/)).toBeTruthy()
    expect(deleteMock).toHaveBeenCalledTimes(1)
  },
)

it.each(resources)('distinguishes confirmed %s removal from failed list refresh', async (resource) => {
  deleteMock.mockResolvedValue(new Response(null, { status: 204 }))
  await start(resource); await confirm(resource)
  listMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 500 })))
  remove(); await screen.findByRole('alert')
  expect(screen.getByText(/removal request completed/)).toBeTruthy()
  expect(screen.queryByText(/Deletion could not be confirmed/)).toBeNull()
  listMock.mockImplementation(() => Promise.resolve(Response.json([])))
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText(`No ${resource} found.`)
  expect(deleteMock).toHaveBeenCalledTimes(1)
})

it.each(resources.flatMap((resource) => [400, 403, 404, 409, 500, 502].map((status) => ({ resource, status }))))(
  'handles $resource DELETE $status honestly and reloads without retrying DELETE', async ({ resource, status }) => {
    deleteMock.mockResolvedValue(new Response('private database details', { status }))
    await start(resource); await confirm(resource); remove()
    const error = await screen.findByRole('alert')
    expect(error.textContent).toMatch(status === 403 ? /Deletion is not permitted/ : status === 404 ? /not found/
      : status === 409 ? /conflict/ : /could not be confirmed/)
    expect(error.textContent).not.toMatch(/private database details|linked inventory|foreign key/i)
    expect(screen.queryByText(/removal request completed/)).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Delete' }).disabled).toBe(true)
    oneHeader()
    fireEvent.click(screen.getByRole('button', { name: 'Reload list' }))
    await screen.findByRole('table')
    expect(deleteMock).toHaveBeenCalledTimes(1)
  },
)

it.each(resources)('handles %s network uncertainty without claiming success or retrying', async (resource) => {
  deleteMock.mockRejectedValue(new Error('private details'))
  await start(resource); await confirm(resource); remove()
  expect((await screen.findByRole('alert')).textContent).toContain('Deletion could not be confirmed')
  expect(screen.queryByText(/removal request completed/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Reload list' }))
  await screen.findByRole('table')
  expect(deleteMock).toHaveBeenCalledTimes(1)
})

it.each(resources)('expires only the current session on %s deletion 401', async (resource) => {
  deleteMock.mockResolvedValue(new Response(null, { status: 401 }))
  await start(resource); await confirm(resource); remove()
  expect((await screen.findByRole('alert')).textContent).toBe('Please sign in again to continue.')
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull()
})

it.each(resources)('does not leave conflicting create/edit/delete forms for %s', async (resource) => {
  await start(resource)
  const add = await screen.findByRole<HTMLButtonElement>('button', { name: `Add ${label(resource)}` })
  await waitFor(() => expect(add.disabled).toBe(false))
  fireEvent.click(add)
  expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  await confirm(resource)
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: resource === 'inventory' ? 'Edit quantity for inventory 41' : `Edit ${label(resource)} ${record(resource).id}` }))
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  await confirm(resource)
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  expect(deleteMock).not.toHaveBeenCalled()
})

it.each(resources.flatMap((resource) => ['navigation', 'logout'].flatMap((action) => ['success', '401'].map((outcome) => ({ resource, action, outcome })))))(
  'ignores obsolete $resource $outcome after $action', async ({ resource, action, outcome }) => {
    const pending = deferred(); deleteMock.mockReturnValue(pending.promise)
    await start(resource); await confirm(resource); remove()
    const signal = deleteMock.mock.calls[0][1]!.signal!
    if (action === 'navigation') fireEvent.click(screen.getByRole('button', { name: resource === 'products' ? 'Warehouses' : 'Products' }))
    else { fireEvent.click(screen.getByRole('button', { name: 'Logout' })); await signIn() }
    await act(async () => pending.resolve(new Response(null, { status: outcome === '401' ? 401 : 204 })))
    expect(signal.aborted).toBe(true)
    expect(screen.queryByText(/removal request completed/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    oneHeader()
    expect(deleteMock).toHaveBeenCalledTimes(1)
  },
)

it.each(resources.flatMap((resource) => ['success', '401'].map((outcome) => ({ resource, outcome }))))(
  'ignores obsolete $resource $outcome after selecting another item', async ({ resource, outcome }) => {
    const first = record(resource), second = { ...first, id: first.id + 1 }
    listMock.mockImplementation(() => Promise.resolve(Response.json([first, second])))
    const pending = deferred(); deleteMock.mockReturnValue(pending.promise)
    await start(resource); await confirm(resource); remove()
    const signal = deleteMock.mock.calls[0][1]!.signal!
    await confirm(resource, second.id)
    await act(async () => pending.resolve(new Response(null, { status: outcome === '401' ? 401 : 204 })))
    expect(signal.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
    expect(screen.queryByText(/removal request completed/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(deleteMock).toHaveBeenCalledTimes(1)
  },
)

it.each(resources.flatMap((resource) => ['success', '401'].map((outcome) => ({ resource, outcome }))))(
  'ignores obsolete $resource $outcome on direct session replacement', async ({ resource, outcome }) => {
    const pending = deferred(); deleteMock.mockReturnValue(pending.promise)
    const expire = vi.fn(), logout = vi.fn()
    const view = render(<Workspace session={session} logout={logout} expireSession={expire} />)
    if (resource !== 'products') fireEvent.click(screen.getByRole('button', { name: title(resource) }))
    await confirm(resource); remove()
    const signal = deleteMock.mock.calls[0][1]!.signal!
    view.rerender(<Workspace session={{ ...session }} logout={logout} expireSession={expire} />)
    await screen.findByRole('table')
    await act(async () => pending.resolve(new Response(null, { status: outcome === '401' ? 401 : 204 })))
    expect(signal.aborted).toBe(true)
    expect(expire).not.toHaveBeenCalled()
    expect(screen.queryByText(/removal request completed/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  },
)


it.each(['products', 'warehouses'] as const)('explains specific %s inventory-reference conflicts and permits dismissal', async (resource) => {
  deleteMock.mockResolvedValue(Response.json({ code: 'INVENTORY_REFERENCE_CONFLICT',
    message: `This ${label(resource)} is used by inventory and cannot be deleted.` }, { status: 409 }))
  await start(resource); await confirm(resource); remove()
  expect((await screen.findByRole('alert')).textContent).toBe(`Inventory still uses this ${label(resource)}. It cannot be deleted.`)
  expect(screen.getByRole('table')).toBeTruthy()
  expect(screen.queryByText(/removal request completed/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: `Delete ${label(resource)} ${record(resource).id}` })).toBeTruthy()
  expect(deleteMock).toHaveBeenCalledTimes(1)
})

it.each([null, [], {}, { code: 'OTHER_CONFLICT', message: 'private details' },
  { code: 1, message: 'private details' }, { code: 'INVENTORY_REFERENCE_CONFLICT' },
  { code: 'INVENTORY_REFERENCE_CONFLICT', message: {} }, { code: 'INVENTORY_REFERENCE_CONFLICT', message: '' }])(
  'keeps malformed/unrelated conflict body %# generic', async (body) => {
    deleteMock.mockResolvedValue(Response.json(body, { status: 409 }))
    await start('products'); await confirm('products'); remove()
    expect((await screen.findByRole('alert')).textContent).toBe('This item could not be deleted because of a conflict. Reload the list.')
    expect(screen.queryByText(/Inventory still uses/)).toBeNull()
    expect(deleteMock).toHaveBeenCalledTimes(1)
  },
)

it('keeps non-JSON conflicts generic', async () => {
  deleteMock.mockResolvedValue(new Response('not JSON', { status: 409 }))
  await start('warehouses'); await confirm('warehouses'); remove()
  expect((await screen.findByRole('alert')).textContent).toBe('This item could not be deleted because of a conflict. Reload the list.')
})

it('never classifies a server error as an inventory conflict based on its body', async () => {
  deleteMock.mockResolvedValue(Response.json({ code: 'INVENTORY_REFERENCE_CONFLICT', message: 'private database details' }, { status: 500 }))
  await start('products'); await confirm('products'); remove()
  expect((await screen.findByRole('alert')).textContent).toContain('Deletion could not be confirmed')
  expect(screen.queryByText(/Inventory still uses/)).toBeNull()
  expect(deleteMock).toHaveBeenCalledTimes(1)
})

it('does not invent a linked-parent conflict for inventory record deletion', async () => {
  deleteMock.mockResolvedValue(Response.json({ code: 'INVENTORY_REFERENCE_CONFLICT', message: 'private details' }, { status: 409 }))
  await start('inventory'); await confirm('inventory'); remove()
  expect((await screen.findByRole('alert')).textContent).toBe('This item could not be deleted because of a conflict. Reload the list.')
})
