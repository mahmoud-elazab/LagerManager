import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../App'

const fetchMock = vi.fn<typeof fetch>()
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetchMock.mockReset() })
function open() {
  vi.stubGlobal('fetch', fetchMock)
  const view = render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Registration' }))
  expect(screen.queryByText(/Local registration allows anyone/)).toBeNull()
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: ' new password ' } })
  return view
}
it.each(['ADMIN', 'MANAGER', 'EMPLOYEE'])('registers %s and returns to prefilled sign in', async role => {
  fetchMock.mockResolvedValue(Response.json({ email: 'new@example.com' }, { status: 201 }))
  open()
  fireEvent.change(screen.getByLabelText('Role'), { target: { value: role } })
  fireEvent.click(screen.getByRole('button', { name: 'Register' }))
  await screen.findByText('Registration successful. Sign in with your new account.')
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
    body: JSON.stringify({ email: 'new@example.com', password: ' new password ', role }),
  })
  expect(screen.getByLabelText<HTMLInputElement>('Email').value).toBe('new@example.com')
  expect(screen.getByLabelText<HTMLInputElement>('Password').value).toBe('')
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
})
it.each([400, 409, 500])('shows safe registration errors for %s', async status => {
  fetchMock.mockResolvedValue(new Response('private details', { status }))
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Register' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain(status === 409 ? 'already exists' : status === 400 ? 'valid email' : 'could not be confirmed')
  expect(alert.textContent).not.toContain('private details')
})
it('rejects invalid input without a request and allows returning to sign in', async () => {
  const { container } = open()
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'é'.repeat(37) } })
  fireEvent.submit(container.querySelector('form')!)
  expect((await screen.findByRole('alert')).textContent).toContain('72 UTF-8 bytes')
  expect(fetchMock).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
  expect(screen.getByLabelText<HTMLInputElement>('Password').value).toBe('')
})
it('blocks repeated submissions while pending', async () => {
  fetchMock.mockReturnValue(new Promise(() => {}))
  const { container } = open()
  fireEvent.submit(container.querySelector('form')!)
  fireEvent.submit(container.querySelector('form')!)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Registering…' }).disabled).toBe(true)
})
