import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { WorkspaceHeader } from './WorkspaceHeader'
import { InventoryScreen } from './InventoryScreen'

const session = { token: 'fictional-test-session', tokenType: 'Bearer' as const }
const product = { description: null, id: 9, name: 'Fictional crate', sku: 'DEMO', category: null, quantity: 999, price: null }
const warehouse = { id: 8, name: 'Fictional depot', location: 'Example location', capacity: 80 }
const item = { id: 37, product, warehouse, quantity: 12 }
const fetchMock = vi.fn<typeof fetch>()
const patchMock = vi.fn<typeof fetch>()
const getMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  getMock.mockImplementation(() => Promise.resolve(Response.json([item])))
  fetchMock.mockImplementation((url, init) => {
    if (url === '/api/auth/me') return Promise.resolve(Response.json({ email: 'fictional@example.com', role: 'EMPLOYEE' }))
    if (url === '/api/auth/login') return Promise.resolve(Response.json(session))
    if (init?.method === 'PATCH') return patchMock(url, init)
    if (url === '/api/inventory') return getMock(url, init)
    return Promise.resolve(Response.json([]))
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetchMock.mockReset(); patchMock.mockReset(); getMock.mockReset() })

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => { resolve = done })
  return { promise, resolve }
}
async function start() {
  const view = render(<><WorkspaceHeader logout={vi.fn()} /><InventoryScreen session={session} logout={vi.fn()} expireSession={vi.fn()} /></>)
  await screen.findByRole('button', { name: 'Edit quantity for inventory 37' })
  return view
}
function edit() { fireEvent.click(screen.getByRole('button', { name: 'Edit quantity for inventory 37' })) }
function change(value: string) { fireEvent.change(screen.getByLabelText('Quantity for inventory 37'), { target: { value } }) }
function save() { fireEvent.click(screen.getByRole('button', { name: 'Save' })) }

it('shows current quantity, discards Cancel and never changes associations', async () => {
  await start(); edit()
  expect(screen.getByLabelText<HTMLInputElement>('Quantity for inventory 37').value).toBe('12')
  change('45')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('cell', { name: '12' })).toBeTruthy()
  expect(screen.getByRole('cell', { name: product.name })).toBeTruthy()
  expect(screen.getByRole('cell', { name: warehouse.name })).toBeTruthy()
  expect(patchMock).not.toHaveBeenCalled()
  edit()
  expect(screen.getByLabelText<HTMLInputElement>('Quantity for inventory 37').value).toBe('12')
})

it.each([0, 25, 2147483647])('sends exact ID-based PATCH for quantity %s and updates only after confirmed success', async (quantity) => {
  const pending = deferred()
  patchMock.mockReturnValue(pending.promise)
  await start(); edit(); change(String(quantity)); save()
  expect(screen.getByRole('cell', { name: '12' })).toBeTruthy()
  expect(screen.queryByText('Quantity updated for inventory 37.')).toBeNull()
  expect(patchMock).toHaveBeenCalledExactlyOnceWith('/api/inventory/37/quantity', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
    credentials: 'omit', signal: expect.any(AbortSignal), body: JSON.stringify({ quantity }),
  })
  await act(async () => pending.resolve(Response.json({ ...item, quantity })))
  expect((await screen.findByRole('status')).textContent).toBe('Quantity updated for inventory 37.')
  expect(screen.getByRole('cell', { name: String(quantity) })).toBeTruthy()
  expect(screen.getByRole('cell', { name: product.name })).toBeTruthy()
  expect(screen.getByRole('cell', { name: warehouse.location })).toBeTruthy()
  expect(screen.queryByRole('cell', { name: String(product.quantity) })).toBeNull()
})

it('never replaces associations from a quantity response', async () => {
  patchMock.mockResolvedValue(Response.json({ ...item, quantity: 20,
    product: { ...product, name: 'Changed association' }, warehouse: null }))
  await start(); edit(); change('20'); save()
  await screen.findByText('Quantity updated for inventory 37.')
  expect(screen.getByRole('cell', { name: product.name })).toBeTruthy()
  expect(screen.getByRole('cell', { name: warehouse.name })).toBeTruthy()
  expect(screen.queryByText('Changed association')).toBeNull()
})

it.each(['', ' ', '-1', '1.5', '1.0', '2147483648', '999999999999999999999', 'abc', '1e3', '+1'])(
  'rejects invalid input %# without any mutation', async (value) => {
    await start(); edit(); change(value); save()
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid stock quantity using zero or a positive whole number.')
    expect(patchMock).not.toHaveBeenCalled()
  },
)

it('prevents duplicate saves and shows saving state', async () => {
  const pending = deferred()
  patchMock.mockReturnValue(pending.promise)
  await start(); edit(); change('15')
  const form = screen.getByLabelText('Quantity for inventory 37').closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Saving…' }).disabled).toBe(true)
  expect(screen.getByLabelText<HTMLInputElement>('Quantity for inventory 37').disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toBe('Saving quantity…')
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
  expect(patchMock).toHaveBeenCalledTimes(1)
  await act(async () => pending.resolve(Response.json({ ...item, quantity: 15 })))
  await screen.findByText('Quantity updated for inventory 37.')
})

it('only offers editing for positive safe inventory IDs and targets the selected record', async () => {
  getMock.mockResolvedValue(Response.json([item, { ...item, id: 91, quantity: 4 },
    { ...item, id: null }, { ...item, id: 0 }, { ...item, id: -1 }]))
  patchMock.mockResolvedValue(Response.json({ ...item, id: 91, quantity: 6 }))
  await start()
  expect(screen.getAllByRole('button', { name: /Edit quantity/ })).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Edit quantity for inventory 91' }))
  fireEvent.change(screen.getByLabelText('Quantity for inventory 91'), { target: { value: '6' } })
  save()
  await screen.findByText('Quantity updated for inventory 91.')
  expect(patchMock.mock.calls[0][0]).toBe('/api/inventory/91/quantity')
  const firstRow = screen.getByRole('button', { name: 'Edit quantity for inventory 37' }).closest('tr')!
  expect(within(firstRow).getByRole('cell', { name: '12' })).toBeTruthy()
})

it.each([400, 403, 404, 500])('handles HTTP %s without automatic mutation retry and reloads via GET', async (status) => {
  patchMock.mockResolvedValue(new Response('private details', { status }))
  await start(); edit(); change('25'); save()
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toMatch(status === 403 ? /Access denied/ : status === 404 ? /not found/ : status === 400 ? /rejected/ : /Unable to confirm/)
  expect(screen.queryByText('private details')).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
  expect(screen.getByRole('cell', { name: '12' })).toBeTruthy()
  getMock.mockImplementation(() => Promise.resolve(Response.json([{ ...item, quantity: 25 }])))
  fireEvent.click(screen.getByRole('button', { name: 'Reload inventory' }))
  await screen.findByRole('cell', { name: '25' })
  expect(patchMock).toHaveBeenCalledTimes(1)
  expect(getMock).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
})

it.each(['network', 'json', 'shape', 'id', 'nested', 'negative'])('handles ambiguous %s failure without claiming success or resending', async (failure) => {
  if (failure === 'network') patchMock.mockRejectedValue(new Error('private details'))
  else if (failure === 'json') patchMock.mockResolvedValue(new Response('invalid JSON'))
  else patchMock.mockResolvedValue(Response.json(failure === 'shape' ? {} : failure === 'id'
    ? { ...item, id: 38, quantity: 25 } : failure === 'nested' ? { ...item, product: {} }
      : { ...item, quantity: -1 }))
  await start(); edit(); change('25'); save()
  expect((await screen.findByRole('alert')).textContent).toMatch(/Reload inventory/)
  expect(screen.queryByText('Quantity updated for inventory 37.')).toBeNull()
  expect(screen.getByRole('cell', { name: '12' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Reload inventory' })).toBeTruthy()
  expect(patchMock).toHaveBeenCalledTimes(1)
})

async function signIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'fictional@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional-input' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('heading', { name: 'Products' })
}
async function appInventory() {
  render(<App />); await signIn()
  fireEvent.click(screen.getByRole('button', { name: 'Inventory' }))
  await screen.findByRole('button', { name: 'Edit quantity for inventory 37' })
}

it('expires only the current session for a save 401', async () => {
  patchMock.mockResolvedValue(new Response(null, { status: 401 }))
  await appInventory(); edit(); change('25'); save()
  expect((await screen.findByRole('alert')).textContent).toBe('Please sign in again to continue.')
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull()
})

it.each(['navigate', 'logout'].flatMap((action) => ['success', '401'].map((outcome) => ({ action, outcome }))))(
  'ignores stale save $outcome after $action and a new view/session', async ({ action, outcome }) => {
    const pending = deferred()
    patchMock.mockReturnValue(pending.promise)
    await appInventory(); edit(); change('25'); save()
    const signal = patchMock.mock.calls[0][1]!.signal!
    if (action === 'navigate') fireEvent.click(screen.getByRole('button', { name: 'Products' }))
    else {
      fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
      await signIn()
    }
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 })
      : Response.json({ ...item, quantity: 25 })))
    expect(screen.getByRole('heading', { name: 'Products' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
    expect(screen.queryByText('Quantity updated for inventory 37.')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }))
    await screen.findByRole('cell', { name: '12' })
    expect(patchMock).toHaveBeenCalledTimes(1)
  },
)

it.each(['success', '401'])('ignores stale save %s after a direct session change', async (outcome) => {
  const pending = deferred()
  patchMock.mockReturnValue(pending.promise)
  const expire = vi.fn()
  const logout = vi.fn()
  const view = render(<InventoryScreen session={session} logout={logout} expireSession={expire} />)
  await screen.findByRole('button', { name: 'Edit quantity for inventory 37' })
  edit(); change('25'); save()
  const signal = patchMock.mock.calls[0][1]!.signal!
  view.rerender(<InventoryScreen session={{ ...session }} logout={logout} expireSession={expire} />)
  await screen.findByRole('button', { name: 'Edit quantity for inventory 37' })
  await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 })
    : Response.json({ ...item, quantity: 25 })))
  expect(signal.aborted).toBe(true)
  expect(expire).not.toHaveBeenCalled()
  expect(screen.getByRole('cell', { name: '12' })).toBeTruthy()
  expect(screen.queryByText('Quantity updated for inventory 37.')).toBeNull()
})
