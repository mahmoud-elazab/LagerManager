import { isInventory, ResourceError } from './resourceApi'
import type { Inventory } from './resourceApi'

export type MovementType = 'RECEIVE' | 'ISSUE' | 'ADJUST'
export type StockMovement = { id: number; inventoryId: number; type: MovementType; quantityChange: number;
  previousQuantity: number; resultingQuantity: number; timestamp: string; actor: string; reason: string }
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 2147483647
}
function isMovement(value: unknown, inventoryId: number): value is StockMovement {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'number' && Number.isSafeInteger(row.id) && row.id > 0 && row.inventoryId === inventoryId
    && ['RECEIVE', 'ISSUE', 'ADJUST'].includes(String(row.type)) && integer(row.previousQuantity) && integer(row.resultingQuantity)
    && typeof row.quantityChange === 'number' && Number.isSafeInteger(row.quantityChange)
    && row.previousQuantity + row.quantityChange === row.resultingQuantity && row.quantityChange !== 0
    && (row.type !== 'RECEIVE' || row.quantityChange > 0) && (row.type !== 'ISSUE' || row.quantityChange < 0)
    && typeof row.timestamp === 'string' && Number.isFinite(Date.parse(row.timestamp))
    && typeof row.actor === 'string' && Boolean(row.actor.trim()) && typeof row.reason === 'string' && Boolean(row.reason.trim())
}
export async function loadMovements(id: number, token: string, signal: AbortSignal): Promise<StockMovement[]> {
  let response: Response
  try { response = await fetch(`/api/inventory/${id}/movements`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', signal }) }
  catch { throw new ResourceError('Unable to load stock history. Check your connection and try again.') }
  if (response.status === 401) throw new ResourceError('Please sign in again to continue.', 401)
  if (response.status === 403) throw new ResourceError('Access denied. Stock history is unavailable.', 403)
  if (response.status === 404) throw new ResourceError('This inventory record was not found. Reload inventory.', 404)
  if (!response.ok) throw new ResourceError('Unable to load stock history. Please try again later.')
  let data: unknown
  try { data = await response.json() } catch { throw new ResourceError('Unexpected history response. Please try again later.') }
  if (!Array.isArray(data) || !data.every((row) => isMovement(row, id))) throw new ResourceError('Unexpected history response. Please try again later.')
  return data
}
export async function recordMovement(id: number, type: MovementType, quantity: number, reason: string, token: string,
  signal: AbortSignal): Promise<Inventory> {
  let response: Response
  try {
    response = await fetch(`/api/inventory/${id}/movements`, { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, credentials: 'omit', signal,
      body: JSON.stringify({ type, quantity, reason: reason.trim() }) })
  } catch { throw new ResourceError('Stock change could not be confirmed. Reload inventory before trying again.') }
  if (response.status === 401) throw new ResourceError('Please sign in again to continue.', 401)
  if (response.status === 403) throw new ResourceError('Access denied. You cannot change this stock.', 403)
  if (response.status === 400) throw new ResourceError('The stock details were rejected. Check quantity and reason.', 400)
  if (response.status === 404) throw new ResourceError('This inventory record was not found. Reload inventory.', 404)
  if (response.status === 409) throw new ResourceError('Stock could not be changed. Reload inventory and check the available quantity.', 409)
  if (!response.ok) throw new ResourceError('Stock change could not be confirmed. Reload inventory before trying again.', response.status)
  let data: unknown
  try { data = await response.json() } catch { throw new ResourceError('Stock change could not be confirmed. Reload inventory before trying again.') }
  if (!isInventory(data) || data.id !== id || data.quantity < 0) throw new ResourceError('Stock change could not be confirmed. Reload inventory before trying again.')
  return data
}
