import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'

const session = { token: 'fictional-memory-session', tokenType: 'Bearer' }
const product = { id: 11, name: 'Fictional bolts', sku: 'BOLT-TEST', description: null, category: null, price: 2.5, totalStock: 10 }
const warehouse = { id: 21, name: 'Fictional depot', location: 'Test hall', capacity: 100 }
const inventory = { id: 31, product, warehouse, quantity: 10 }
const movement = { id: 41, inventoryId: 31, type: 'RECEIVE', quantityChange: 10, previousQuantity: 0,
  resultingQuantity: 10, timestamp: '2026-10-29T10:00:00Z', actor: 'counter@example.test', reason: 'Initial delivery' }
const fetchMock = vi.fn<typeof fetch>()
const historyMock = vi.fn<typeof fetch>()
const stockMock = vi.fn<typeof fetch>()
const listMock = vi.fn<typeof fetch>()
let role = 'EMPLOYEE'
beforeEach(() => {
  role = 'EMPLOYEE'
  historyMock.mockImplementation(() => Promise.resolve(Response.json([movement])))
  stockMock.mockImplementation(() => Promise.resolve(Response.json({ ...inventory, quantity: 12 })))
  listMock.mockImplementation((url) => Promise.resolve(Response.json(url === '/api/products' ? [product]
    : url === '/api/warehouses' ? [warehouse] : [inventory])))
  fetchMock.mockImplementation((url, init) => {
    if (url === '/api/auth/login') return Promise.resolve(Response.json(session))
    if (url === '/api/auth/me') return Promise.resolve(Response.json({ email: 'fictional@example.test', role }))
    if (String(url).endsWith('/movements')) return init?.method === 'POST' ? stockMock(url, init) : historyMock(url, init)
    if (init?.method === 'PATCH') return stockMock(url, init)
    return listMock(url, init)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetchMock.mockReset(); historyMock.mockReset(); stockMock.mockReset(); listMock.mockReset() })
function deferred() { let resolve!: (response: Response) => void; const promise = new Promise<Response>((done) => { resolve = done }); return { promise, resolve } }
async function login() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'fictional@example.test' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional-input' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('table', { name: 'Products' })
}
async function start() { render(<App />); await login(); fireEvent.click(screen.getByRole('button', { name: 'Inventory' })); await screen.findByRole('table', { name: 'Inventory' }) }
function edit(type = 'RECEIVE') {
  fireEvent.click(screen.getByRole('button', { name: 'Edit quantity for inventory 31' }))
  fireEvent.change(screen.getByLabelText('Operation'), { target: { value: type } })
}
function enter(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
function save() { fireEvent.click(screen.getByRole('button', { name: 'Save' })) }

it.each(['ADMIN', 'MANAGER', 'EMPLOYEE'])('allows %s to use stock operations and history without changing creation permissions', async (value) => {
  role = value; await start()
  expect(screen.queryByRole('button', { name: 'Add inventory' }) !== null).toBe(value !== 'EMPLOYEE')
  edit(); enter('Items to receive', '2'); enter('Reason', 'Delivery'); save()
  await screen.findByText('Quantity updated for inventory 31.')
  fireEvent.click(screen.getByRole('button', { name: 'History for inventory 31' }))
  await screen.findByRole('table', { name: 'Stock movements' })
  expect(screen.getByRole('cell', { name: 'counter@example.test' })).toBeTruthy()
})
it.each(['RECEIVE', 'ISSUE'])('sends an exact %s request once and waits for confirmation', async (type) => {
  const pending = deferred(); stockMock.mockReturnValue(pending.promise)
  await start(); edit(type); enter(type === 'RECEIVE' ? 'Items to receive' : 'Items to issue', '2'); enter('Reason', 'Delivery check')
  const form = screen.getByRole('button', { name: 'Save' }).closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  expect(stockMock).toHaveBeenCalledExactlyOnceWith('/api/inventory/31/movements', {
    method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, credentials: 'omit',
    signal: expect.any(AbortSignal), body: JSON.stringify({ type, quantity: 2, reason: 'Delivery check' }),
  })
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy()
  expect(screen.getByRole('cell', { name: '10' })).toBeTruthy()
  const result = type === 'RECEIVE' ? 12 : 8
  await act(async () => pending.resolve(Response.json({ ...inventory, quantity: result })))
  expect(await screen.findByRole('cell', { name: String(result) })).toBeTruthy()
  expect(stockMock).toHaveBeenCalledTimes(1)
})
it('requires a meaningful reason for adjustments and sends it through the legacy PATCH', async () => {
  await start(); edit('ADJUST'); enter('Quantity for inventory 31', '0'); save()
  expect(screen.getByRole('alert').textContent).toMatch(/meaningful reason/); expect(stockMock).not.toHaveBeenCalled()
  enter('Reason (required)', 'Cycle count'); save()
  await waitFor(() => expect(stockMock).toHaveBeenCalledTimes(1))
  expect(stockMock.mock.calls[0][0]).toBe('/api/inventory/31/quantity')
  expect(JSON.parse(stockMock.mock.calls[0][1]!.body as string)).toEqual({ quantity: 0, reason: 'Cycle count' })
})
it.each(['', '-1', '0', '1.5', '2147483648'])('rejects invalid receipt quantity %s without a request', async (value) => {
  await start(); edit(); enter('Items to receive', value); save()
  expect(screen.getByRole('alert')).toBeTruthy(); expect(stockMock).not.toHaveBeenCalled()
})
it('Cancel does not submit a movement', async () => {
  await start(); edit(); enter('Items to receive', '5'); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(stockMock).not.toHaveBeenCalled(); expect(screen.getByRole('cell', { name: '10' })).toBeTruthy()
})
it.each([400, 403, 404, 409, 500])('handles movement HTTP %s safely without automatic retries', async (status) => {
  stockMock.mockResolvedValue(new Response('private server detail', { status }))
  await start(); edit(); enter('Items to receive', '2'); save()
  const alert = await screen.findByRole('alert'); expect(alert.textContent).not.toContain('private server detail')
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy(); expect(stockMock).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Quantity updated for inventory 31.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Reload inventory' })); await screen.findByRole('button', { name: 'Edit quantity for inventory 31' })
  expect(stockMock).toHaveBeenCalledTimes(1)
})
it.each(['network', 'json', 'id', 'null'])('handles uncertain %s outcomes without false success or resend', async (failure) => {
  if (failure === 'network') stockMock.mockRejectedValue(new Error('private failure'))
  else stockMock.mockResolvedValue(failure === 'json' ? new Response('invalid JSON') : Response.json(failure === 'null' ? null : { ...inventory, id: 99 }))
  await start(); edit(); enter('Items to receive', '2'); save()
  expect((await screen.findByRole('alert')).textContent).toMatch(/could not be confirmed/)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
  expect(stockMock).toHaveBeenCalledTimes(1); expect(screen.queryByText('Quantity updated for inventory 31.')).toBeNull()
})
it('expires a current session on movement 401', async () => {
  stockMock.mockResolvedValue(new Response(null, { status: 401 }))
  await start(); edit(); enter('Items to receive', '2'); save()
  await screen.findByRole('button', { name: 'Sign in' }); expect(screen.getByRole('alert').textContent).toMatch(/sign in again/)
})
it.each(['navigate', 'logout'].flatMap((action) => ['success', '401'].map((outcome) => ({ action, outcome }))))(
  'ignores pending movement $outcome after $action and a newer screen/session', async ({ action, outcome }) => {
    const pending = deferred(); stockMock.mockReturnValue(pending.promise)
    await start(); edit(); enter('Items to receive', '2'); save()
    const signal = stockMock.mock.calls[0][1]!.signal!
    fireEvent.click(screen.getByRole('button', { name: action === 'navigate' ? 'Warehouses' : 'Logout' }))
    if (action === 'logout') await login()
    await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 }) : Response.json({ ...inventory, quantity: 12 })))
    expect(signal.aborted).toBe(true); expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
    expect(screen.queryByText('Quantity updated for inventory 31.')).toBeNull()
  },
)
it('loads readable authenticated history and handles an empty history', async () => {
  await start(); fireEvent.click(screen.getByRole('button', { name: 'History for inventory 31' }))
  await screen.findByRole('table', { name: 'Stock movements' })
  expect(historyMock).toHaveBeenCalledWith('/api/inventory/31/movements', { headers: { Authorization: `Bearer ${session.token}` }, credentials: 'omit', signal: expect.any(AbortSignal) })
  expect(screen.getByRole('cell', { name: '+10' })).toBeTruthy(); expect(screen.getByRole('cell', { name: 'Initial delivery' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close history' })); historyMock.mockResolvedValue(Response.json([]))
  fireEvent.click(screen.getByRole('button', { name: 'History for inventory 31' })); await screen.findByText('No stock movements yet.')
})
it.each([null, {}, [{ ...movement, inventoryId: 99 }], [{ ...movement, quantityChange: 99 }], [{ ...movement, actor: '' }], [{ ...movement, timestamp: 'invalid' }]])(
  'rejects malformed history %# and retries only the read', async (body) => {
    historyMock.mockResolvedValue(Response.json(body)); await start(); fireEvent.click(screen.getByRole('button', { name: 'History for inventory 31' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Unexpected history/)
    historyMock.mockResolvedValue(Response.json([movement])); fireEvent.click(screen.getByRole('button', { name: 'Retry history' }))
    await screen.findByRole('table', { name: 'Stock movements' }); expect(stockMock).not.toHaveBeenCalled()
  },
)
it.each([401, 403, 404, 500])('handles history HTTP %s safely', async (status) => {
  historyMock.mockResolvedValue(new Response('private details', { status })); await start(); fireEvent.click(screen.getByRole('button', { name: 'History for inventory 31' }))
  const error = await screen.findByRole('alert'); expect(error.textContent).not.toContain('private details')
  expect(screen.queryByRole('button', { name: 'Sign in' }) !== null).toBe(status === 401)
})
it.each(['success', '401'])('ignores obsolete history %s after logout/new login', async (outcome) => {
  const pending = deferred(); historyMock.mockReturnValue(pending.promise)
  await start(); fireEvent.click(screen.getByRole('button', { name: 'History for inventory 31' })); await waitFor(() => expect(historyMock).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Logout' })); await login()
  await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 }) : Response.json([movement])))
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy(); expect(screen.queryByRole('table', { name: 'Stock movements' })).toBeNull()
})
it('displays Total stock and never offers independent stock in product forms', async () => {
  role = 'ADMIN'; render(<App />); await login()
  expect(screen.getByRole('columnheader', { name: 'Total stock' })).toBeTruthy()
  expect(screen.getByRole('cell', { name: '10' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Add product' })); expect(screen.queryByLabelText('Quantity')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); fireEvent.click(screen.getByRole('button', { name: 'Edit product 11' }))
  expect(screen.queryByLabelText('Quantity')).toBeNull(); expect(screen.getByLabelText('Description')).toBeTruthy()
})

it.each(['network', 'json'])('handles history %s failure and retries safely', async (failure) => {
  if (failure === 'network') historyMock.mockRejectedValue(new Error('private history error'))
  else historyMock.mockResolvedValue(new Response('not JSON'))
  await start(); fireEvent.click(screen.getByRole('button', { name: 'History for inventory 31' }))
  const alert = await screen.findByRole('alert'); expect(alert.textContent).not.toContain('private history error')
  historyMock.mockResolvedValue(Response.json([movement])); fireEvent.click(screen.getByRole('button', { name: 'Retry history' }))
  await screen.findByRole('table', { name: 'Stock movements' }); expect(stockMock).not.toHaveBeenCalled()
})
it('accepts derived totals larger than a single inventory integer without using a legacy field', async () => {
  listMock.mockResolvedValue(Response.json([{ ...product, totalStock: 3000000000 }]))
  render(<App />); await login()
  expect(screen.getByRole('cell', { name: '3000000000' })).toBeTruthy()
})
