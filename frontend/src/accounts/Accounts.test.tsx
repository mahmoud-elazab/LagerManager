import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../App'
import { validAccountInput } from '../auth/accountValidation'

const session = { token: 'fictional-account-session', tokenType: 'Bearer' }
const admin = { id: 1, email: 'admin@accounts.example', role: 'ADMIN', enabled: true }
const member = { id: 2, email: 'member@accounts.example', role: 'EMPLOYEE', enabled: true }
let role = 'ADMIN'
let rows = [admin, member]
const accounts = vi.fn<typeof fetch>()
const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  role = 'ADMIN'; rows = [admin, member]
  accounts.mockImplementation(() => Promise.resolve(Response.json(rows)))
  fetchMock.mockImplementation((url, init) => {
    if (url === '/api/auth/login') return Promise.resolve(Response.json(session))
    if (url === '/api/auth/me') return Promise.resolve(Response.json({ email: admin.email, role }))
    if (String(url).startsWith('/api/accounts')) return accounts(url, init)
    return Promise.resolve(Response.json([]))
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); accounts.mockReset(); fetchMock.mockReset() })
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
async function signIn() {
  change('Email', admin.email); change('Password', 'fictional-password')
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByText(`Signed in as ${admin.email}`)
}
async function start() {
  render(<App />); await signIn()
  fireEvent.click(screen.getByRole('button', { name: 'Accounts' }))
  await screen.findByRole('cell', { name: member.email })
}
function edit() { fireEvent.click(screen.getByRole('button', { name: `Edit ${member.email}` })) }
function save() { fireEvent.click(screen.getByRole('button', { name: 'Save' })) }
function fillNew() {
  fireEvent.click(screen.getByRole('button', { name: 'Add account' }))
  change('Email', 'new@accounts.example'); change('Password', ' exact password ')
}
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(done => { resolve = done })
  return { promise, resolve }
}

it.each(['MANAGER', 'EMPLOYEE'])('hides Accounts for %s without loading management data', async value => {
  role = value; render(<App />); await signIn()
  expect(screen.queryByRole('button', { name: 'Accounts' })).toBeNull()
  expect(accounts).not.toHaveBeenCalled()
})
it('waits for confirmed Admin role before showing Accounts and loads only on selection', async () => {
  const pending = deferred()
  fetchMock.mockImplementation((url, init) => url === '/api/auth/me' ? pending.promise
    : url === '/api/auth/login' ? Promise.resolve(Response.json(session)) : String(url).startsWith('/api/accounts')
    ? accounts(url, init) : Promise.resolve(Response.json([])))
  render(<App />)
  change('Email', admin.email); change('Password', 'password')
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  await screen.findByRole('heading', { name: 'Products' })
  expect(screen.queryByRole('button', { name: 'Accounts' })).toBeNull()
  expect(accounts).not.toHaveBeenCalled()
  await act(async () => pending.resolve(Response.json({ email: admin.email, role: 'ADMIN' })))
  fireEvent.click(await screen.findByRole('button', { name: 'Accounts' }))
  await screen.findByRole('table', { name: 'Accounts' })
  expect(accounts).toHaveBeenLastCalledWith('/api/accounts', {
    method: 'GET', headers: { Authorization: `Bearer ${session.token}` }, credentials: 'omit', signal: expect.any(AbortSignal),
  })
  for (const name of ['Email', 'Role', 'Enabled']) expect(screen.getByRole('columnheader', { name })).toBeTruthy()
})
it.each(['ADMIN', 'MANAGER', 'EMPLOYEE'])('creates a %s account with selected enabled status', async value => {
  await start(); fillNew(); change('Role', value); change('Enabled', 'false')
  const created = { id: 3, email: 'new@accounts.example', role: value, enabled: false }
  accounts.mockImplementation((_url, init) => {
    if (init?.method === 'POST') { rows = [...rows, created]; return Promise.resolve(Response.json(created, { status: 201 })) }
    return Promise.resolve(Response.json(rows))
  })
  const password = screen.getByLabelText<HTMLInputElement>('Password')
  save()
  await screen.findByText('Account saved.')
  await screen.findByRole('cell', { name: created.email })
  const post = accounts.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(post).toEqual(['/api/accounts', {
    method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, credentials: 'omit',
    signal: expect.any(AbortSignal), body: JSON.stringify({ email: created.email, password: ' exact password ', role: value, enabled: false }),
  }])
  expect(screen.queryByLabelText('Password')).toBeNull()
  expect(password.type).toBe('password')
  expect(password.value).toBe('')
})
it('updates role/status using only those fields and refreshes the list', async () => {
  await start(); edit(); change('Role', 'MANAGER'); change('Enabled', 'false')
  expect(screen.queryByLabelText('Password')).toBeNull()
  expect(screen.queryByLabelText('Email')).toBeNull()
  accounts.mockImplementation((_url, init) => {
    if (init?.method === 'PUT') { rows = [admin, { ...member, role: 'MANAGER', enabled: false }]; return Promise.resolve(Response.json(rows[1])) }
    return Promise.resolve(Response.json(rows))
  })
  save()
  await screen.findByText('Account saved.')
  await screen.findByRole('cell', { name: 'No' })
  expect(accounts.mock.calls.find(([, init]) => init?.method === 'PUT')).toEqual(['/api/accounts/2', {
    method: 'PUT', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, credentials: 'omit',
    signal: expect.any(AbortSignal), body: JSON.stringify({ role: 'MANAGER', enabled: false }),
  }])
})
it.each(['role', 'enabled'])('ends the current session after removing own Admin access via %s', async field => {
  await start(); fireEvent.click(screen.getByRole('button', { name: `Edit ${admin.email}` }))
  change(field === 'role' ? 'Role' : 'Enabled', field === 'role' ? 'EMPLOYEE' : 'false')
  accounts.mockResolvedValue(Response.json({ ...admin, ...(field === 'role' ? { role: 'EMPLOYEE' } : { enabled: false }) }))
  save()
  await screen.findByRole('heading', { name: 'Sign in' })
})
it.each(['bad-email', 'blank-password', 'long-password'])('rejects %s locally and Cancel sends no mutation', async mode => {
  await start(); fillNew()
  if (mode === 'bad-email') change('Email', 'invalid')
  else change('Password', mode === 'blank-password' ? ' ' : 'é'.repeat(37))
  save()
  expect((await screen.findByRole('alert')).textContent).toContain('valid email')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(accounts.mock.calls.filter(([, init]) => init?.method !== 'GET')).toHaveLength(0)
})
it.each([400, 409])('handles creation %s safely and allows correction', async status => {
  await start(); fillNew(); accounts.mockResolvedValue(new Response('private details', { status }))
  save()
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain(status === 409 ? 'already exists' : 'Check the account details')
  expect(alert.textContent).not.toContain('private details')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false)
})
it('prevents duplicate submissions while pending', async () => {
  await start(); fillNew()
  const pending = deferred(); accounts.mockReturnValue(pending.promise)
  const form = screen.getByRole('button', { name: 'Save' }).closest('form')!
  fireEvent.submit(form); fireEvent.submit(form)
  expect(accounts.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Saving…' }).disabled).toBe(true)
})
it.each(['network', '500', 'malformed', 'mismatched-id'])('requires read-only reload after uncertain %s update', async mode => {
  await start(); edit()
  if (mode === 'network') accounts.mockRejectedValueOnce(new Error('private network details'))
  else accounts.mockResolvedValueOnce(mode === '500' ? new Response('private details', { status: 500 })
    : Response.json(mode === 'malformed' ? null : { ...member, id: 99 }))
  save()
  expect((await screen.findByRole('alert')).textContent).toContain('could not be confirmed')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true)
  const puts = accounts.mock.calls.filter(([, init]) => init?.method === 'PUT').length
  fireEvent.click(screen.getByRole('button', { name: 'Reload accounts' }))
  await screen.findByRole('button', { name: 'Add account' })
  expect(accounts.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(puts)
})
it('retains login on 403 and ends login on current-request 401', async () => {
  await start(); edit(); accounts.mockResolvedValue(new Response(null, { status: 403 })); save()
  expect((await screen.findByRole('alert')).textContent).toContain('Only Admins')
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
  accounts.mockResolvedValue(new Response(null, { status: 401 }))
  fireEvent.click(screen.getByRole('button', { name: 'Reload accounts' }))
  await screen.findByRole('heading', { name: 'Sign in' })
})
it.each(['success', '401'])('ignores stale mutation %s after leaving Accounts', async outcome => {
  await start(); edit()
  const pending = deferred(); accounts.mockReturnValue(pending.promise); save()
  const request = accounts.mock.calls.find(([, init]) => init?.method === 'PUT')!
  fireEvent.click(screen.getByRole('button', { name: 'Products' }))
  expect(request[1]?.signal?.aborted).toBe(true)
  await act(async () => pending.resolve(outcome === '401' ? new Response(null, { status: 401 }) : Response.json(member)))
  expect(screen.getByRole('heading', { name: 'Products' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
  expect(screen.queryByText('Account saved.')).toBeNull()
})
it.each([null, {}, [{ ...member, enabled: 'false' }], [{ ...member, role: 'OWNER' }]])('rejects malformed account list %#', async data => {
  accounts.mockResolvedValue(Response.json(data))
  render(<App />); await signIn(); fireEvent.click(screen.getByRole('button', { name: 'Accounts' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Unexpected account response')
  expect(screen.queryByRole('button', { name: 'Add account' })).toBeNull()
})
it('shows empty lists and retries a failed list load', async () => {
  accounts.mockResolvedValueOnce(new Response(null, { status: 500 })).mockResolvedValue(Response.json([]))
  render(<App />); await signIn(); fireEvent.click(screen.getByRole('button', { name: 'Accounts' }))
  await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('No accounts found.')
  await waitFor(() => expect(accounts).toHaveBeenCalledTimes(2))
})

it('keeps confirmed save feedback separate from a failed list refresh', async () => {
  await start(); edit()
  accounts.mockImplementation((_url, init) => Promise.resolve(init?.method === 'PUT'
    ? Response.json(member) : new Response(null, { status: 500 })))
  save()
  await screen.findByText('Account saved.')
  expect((await screen.findByRole('alert')).textContent).toContain('Unable to load accounts')
  expect(accounts.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1)
})
it('ignores an obsolete list 401 after navigating away', async () => {
  const pending = deferred(); accounts.mockReturnValue(pending.promise)
  render(<App />); await signIn(); fireEvent.click(screen.getByRole('button', { name: 'Accounts' }))
  await screen.findByText('Loading accounts…')
  fireEvent.click(screen.getByRole('button', { name: 'Products' }))
  await act(async () => pending.resolve(new Response(null, { status: 401 })))
  expect(screen.getByRole('heading', { name: 'Products' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Logout' })).toBeTruthy()
})

it('rejects an email incompatible with sign-in before sending an account-create request', async () => {
  await start(); fillNew(); change('Email', 'worker@bad_host.example')
  const before = fetchMock.mock.calls.length
  save()
  expect((await screen.findByRole('alert')).textContent).toContain('Enter a valid email')
  expect(fetchMock).toHaveBeenCalledTimes(before)
  expect(accounts.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
})

it.each([
  ['worker+shift@sub-domain.example', true],
  ["o'hara@dept.example", true],
  ['worker@bad_host.example', false],
  ['worker@-host.example', false],
  ['worker@host-.example', false],
  ['worker@' + 'a'.repeat(64) + '.example', false],
])('keeps creation email validation compatible with the email input: %s', (email, valid) => {
  const input = document.createElement('input')
  input.type = 'email'; input.value = email
  expect(input.validity.valid).toBe(valid)
  expect(validAccountInput(email, 'password', 'EMPLOYEE')).toBe(valid)
})
