import { isProduct } from '../products/productsApi'
import type { Product } from '../products/productsApi'

export type Warehouse = {
  id: number | null
  name: string | null
  location: string | null
  capacity: number
}
export type Inventory = {
  id: number | null
  product: Product | null
  warehouse: Warehouse | null
  quantity: number
}

export class ResourceError extends Error {
  readonly status: number | undefined
  constructor(message: string, status?: number) { super(message); this.status = status }
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
}
function id(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value))
}
export function isWarehouse(value: unknown): value is Warehouse {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return id(item.id) && nullableText(item.name) && nullableText(item.location) && integer(item.capacity)
}
export function isInventory(value: unknown): value is Inventory {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return id(item.id) && integer(item.quantity)
    && (item.product === null || isProduct(item.product))
    && (item.warehouse === null || isWarehouse(item.warehouse))
}

async function loadList<T>(resource: string, token: string, signal: AbortSignal,
  validate: (value: unknown) => value is T, selectable = false): Promise<T[]> {
  let response: Response
  try {
    response = await fetch(`/api/${resource}`, {
      headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', signal,
    })
  } catch {
    throw new ResourceError('Unable to connect. Check your connection and try again.')
  }
  if (response.status === 401) throw new ResourceError('Please sign in again to continue.', 401)
  if (response.status === 403) throw new ResourceError(`Access denied. You do not have permission to view ${resource}.`, 403)
  if (!response.ok) throw new ResourceError(`Unable to load ${resource}. Please try again later.`, response.status)
  let data: unknown
  try { data = await response.json() } catch {
    throw new ResourceError('Unexpected server response. Please try again later.')
  }
  if (!Array.isArray(data)) throw new ResourceError('Unexpected server response. Please try again later.')
  const records = selectable ? data.filter((record: unknown) => typeof record === 'object' && record !== null
    && 'id' in record && validRecordId(record.id)) : data
  if (!records.every(validate)) {
    throw new ResourceError('Unexpected server response. Please try again later.')
  }
  return records
}

export function loadWarehouses(token: string, signal: AbortSignal): Promise<Warehouse[]> {
  return loadList('warehouses', token, signal, isWarehouse)
}
export function loadInventory(token: string, signal: AbortSignal): Promise<Inventory[]> {
  return loadList('inventory', token, signal, isInventory)
}


export async function updateInventoryQuantity(id: number, quantity: number, token: string,
  signal: AbortSignal): Promise<Inventory> {
  let response: Response
  try {
    response = await fetch(`/api/inventory/${id}/quantity`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'omit', signal, body: JSON.stringify({ quantity }),
    })
  } catch {
    throw new ResourceError('Unable to confirm the save. Reload inventory to check the current quantity.')
  }
  if (response.status === 401) throw new ResourceError('Please sign in again to continue.', 401)
  if (response.status === 403) throw new ResourceError('Access denied. You do not have permission to change inventory quantities.', 403)
  if (response.status === 400) throw new ResourceError('The quantity was rejected. Reload inventory before editing again.', 400)
  if (response.status === 404) throw new ResourceError('This inventory record was not found. Reload inventory to check the list.', 404)
  if (!response.ok) throw new ResourceError('Unable to confirm the save. Reload inventory to check the current quantity.', response.status)
  let data: unknown
  try { data = await response.json() } catch {
    throw new ResourceError('Unexpected save response. Reload inventory to check the current quantity.')
  }
  if (!isInventory(data) || data.id !== id || data.quantity < 0) {
    throw new ResourceError('Unexpected save response. Reload inventory to check the current quantity.')
  }
  return data
}


export function validRecordId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export async function loadInventoryOptions(token: string, signal: AbortSignal) {
  const [products, warehouses] = await Promise.all([
    loadList('products', token, signal, isProduct, true),
    loadList('warehouses', token, signal, isWarehouse, true),
  ])
  return { products, warehouses }
}
