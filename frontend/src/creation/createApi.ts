import { isProduct } from '../products/productsApi'
import { isWarehouse, isInventory, ResourceError } from '../resources/resourceApi'

export type ProductInput = { name: string; sku: string; description: string | null; category: string | null; price: string }
export type WarehouseInput = { name: string; location: string; capacity: number }
export type InventoryInput = { productId: number; warehouseId: number; quantity: number }
export type CreationInput = ProductInput | WarehouseInput | InventoryInput
export type CreationResource = 'products' | 'warehouses' | 'inventory'

export function wholeNumber(value: string): boolean {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647
}
export function decimalPrice(value: string): boolean {
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)
}
export function exactDecimal(value: string): string {
  const [whole, fraction] = value.split('.')
  const canonical = (whole || '0').replace(/^0+(?=\d)/, '')
  return fraction === undefined ? canonical : `${canonical}.${fraction || '0'}`
}

export async function createRecord(resource: CreationResource, input: CreationInput, token: string,
  signal: AbortSignal): Promise<void> {
  let body: string
  if (resource === 'products' && 'price' in input) {
    body = productBody(input)
  } else if (resource === 'warehouses' && 'capacity' in input) {
    body = JSON.stringify({ name: input.name, location: input.location, capacity: input.capacity })
  } else if (resource === 'inventory' && 'productId' in input) {
    body = JSON.stringify({ productId: input.productId, warehouseId: input.warehouseId, quantity: input.quantity })
  } else throw new ResourceError('Unable to submit this form.')
  let response: Response
  try {
    response = await fetch(`/api/${resource}`, { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, credentials: 'omit', signal, body })
  } catch { throw new ResourceError('Creation could not be confirmed. Reload the list before trying again.') }
  if (response.status === 401) throw new ResourceError('Please sign in again to continue.', 401)
  if (response.status === 403) throw new ResourceError('Access denied. You no longer have permission to create this item.', 403)
  if (response.status === 400) throw new ResourceError('The details were rejected. Check the form and try again.', 400)
  if (response.status === 404) throw new ResourceError('The selected item was not found. Reload the options before trying again.', 404)
  if (response.status === 409) throw new ResourceError('These details conflict with an existing item. Check them before trying again.', 409)
  if (!response.ok) throw new ResourceError('Creation could not be confirmed. Reload the list before trying again.', response.status)
  let data: unknown
  try { data = await response.json() } catch {
    throw new ResourceError('Creation could not be confirmed. Reload the list before trying again.')
  }
  if (!(resource === 'products' ? isProduct(data) : resource === 'warehouses' ? isWarehouse(data) : isInventory(data))
    || typeof data !== 'object' || data === null || !('id' in data) || typeof data.id !== 'number' || data.id <= 0) {
    throw new ResourceError('Creation could not be confirmed. Reload the list before trying again.')
  }
}


export function productBody(input: ProductInput): string {
  if (!decimalPrice(input.price)) throw new ResourceError('Enter a valid price.')
  return JSON.stringify({ name: input.name, sku: input.sku, description: input.description,
    category: input.category }).slice(0, -1) + `,"price":${exactDecimal(input.price)}}`
}
