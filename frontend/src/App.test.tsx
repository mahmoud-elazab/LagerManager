import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const fetchMock = vi.fn<typeof fetch>()
const successBody = { token: 'fictional-test-token', tokenType: 'Bearer' }

beforeEach(() => {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    input === '/api/auth/me' ? Promise.resolve(Response.json({ email: 'fictional@example.com', role: 'EMPLOYEE' })) : input === '/api/products' ? Promise.resolve(Response.json([])) : fetchMock(input, init))
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function fillForm() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'fictional@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: ' fictional password ' } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('login and logout', () => {
  it('sends the exact input, accepts a valid response, and logs out without retaining credentials', async () => {
    fetchMock.mockResolvedValue(Response.json(successBody))
    const localWrite = vi.spyOn(Storage.prototype, 'setItem')
    const cookieWrite = vi.spyOn(document, 'cookie', 'set')
    render(<App />)
    const password = screen.getByLabelText<HTMLInputElement>('Password')
    expect(password.type).toBe('password')
    expect(password.autocomplete).toBe('current-password')
    expect(screen.getByLabelText<HTMLInputElement>('Email').autocomplete).toBe('username')
    fillForm()
    submit()
    await screen.findByRole('heading', { name: 'Products' })
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
      body: JSON.stringify({ email: 'fictional@example.com', password: ' fictional password ' }),
    })
    expect(password.value).toBe('')
    expect(screen.queryByText(successBody.token)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
    expect(screen.getByLabelText<HTMLInputElement>('Password').value).toBe('')
    expect(screen.getByLabelText<HTMLInputElement>('Email').value).toBe('')
    expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(localWrite).not.toHaveBeenCalled()
    expect(cookieWrite).not.toHaveBeenCalled()
  })

  it('requires login on a fresh app mount', async () => {
    fetchMock.mockResolvedValue(Response.json(successBody))
    const first = render(<App />)
    fillForm()
    submit()
    await screen.findByRole('button', { name: 'Logout' })
    first.unmount()
    render(<App />)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })

  it.each([
    [401, 'Sign in failed. Check your email and password.'],
    [400, 'Enter a valid email and password.'],
    [500, 'The server could not complete sign in. Please try again later.'],
    [502, 'The server could not complete sign in. Please try again later.'],
  ])('handles HTTP %s with a safe accessible error', async (status, message) => {
    fetchMock.mockResolvedValue(new Response('private server exception details', { status }))
    render(<App />)
    fillForm()
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(screen.queryByText('private server exception details')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sign in' }).disabled).toBe(false)
  })

  it('handles network rejection without exposing exception text and permits retry', async () => {
    fetchMock.mockRejectedValueOnce(new Error('private network exception details'))
    fetchMock.mockResolvedValueOnce(Response.json(successBody))
    render(<App />)
    fillForm()
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Unable to connect. Check your connection and try again.')
    expect(screen.queryByText('private network exception details')).toBeNull()
    submit()
    await screen.findByRole('button', { name: 'Logout' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([null, {}, { token: '', tokenType: 'Bearer' }, { token: ' ', tokenType: 'Bearer' },
    { token: 42, tokenType: 'Bearer' }, { token: 'fictional', tokenType: 'Basic' }, { token: 'fictional' },
    { token: 'with whitespace', tokenType: 'Bearer' }])('rejects malformed successful response %#', async (body) => {
    fetchMock.mockResolvedValue(Response.json(body))
    render(<App />)
    fillForm()
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Unexpected server response. Please try again later.')
    expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull()
  })

  it('rejects non-JSON successful responses', async () => {
    fetchMock.mockResolvedValue(new Response('<html>unexpected</html>', { status: 200 }))
    render(<App />)
    fillForm()
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Unexpected server response. Please try again later.')
  })

  it('blocks duplicate submissions while pending', async () => {
    let resolve!: (response: Response) => void
    fetchMock.mockImplementation(() => new Promise<Response>((done) => { resolve = done }))
    const { container } = render(<App />)
    fillForm()
    const form = container.querySelector('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Signing in…' }).disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('Email').disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('Password').disabled).toBe(true)
    expect(form.getAttribute('aria-busy')).toBe('true')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => resolve(Response.json(successBody)))
    await screen.findByRole('button', { name: 'Logout' })
  })

  it('requires both fields without sending empty credentials', async () => {
    const { container } = render(<App />)
    expect(screen.getByLabelText<HTMLInputElement>('Email').required).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('Password').required).toBe(true)
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Enter a valid email and password.'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
