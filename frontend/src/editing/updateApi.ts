import { productBody } from '../creation/createApi'
import type { ProductInput, WarehouseInput } from '../creation/createApi'
import { isProduct } from '../products/productsApi'
import { isWarehouse, ResourceError, validRecordId } from '../resources/resourceApi'

export type EditableResource = 'products' | 'warehouses'
export async function updateRecord(resource: EditableResource, id: number, input: ProductInput | WarehouseInput,
  token: string, signal: AbortSignal): Promise<void> {
  if (!validRecordId(id)) throw new ResourceError('This record cannot be edited.')
  const body = resource === 'products' && 'price' in input ? productBody(input)
    : resource === 'warehouses' && 'capacity' in input
      ? JSON.stringify({ name: input.name, location: input.location, capacity: input.capacity }) : null
  if (body === null) throw new ResourceError('Unable to submit this form.')
  let response: Response
  try {
    response = await fetch(`/api/${resource}/${id}`, { method: 'PUT', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, credentials: 'omit', signal, body })
  } catch { throw new ResourceError('Save could not be confirmed. Reload the list before trying again.') }
  if (response.status === 401) throw new ResourceError('Please sign in again to continue.', 401)
  if (response.status === 403) throw new ResourceError('Access denied. Editing is not permitted for your account.', 403)
  if (response.status === 400) throw new ResourceError('The details were rejected. Check the form and try again.', 400)
  if (response.status === 404) throw new ResourceError('This record was not found. Reload the list.', 404)
  if (response.status === 409) throw new ResourceError('These details conflict with another item. Check them before trying again.', 409)
  if (!response.ok) throw new ResourceError('Save could not be confirmed. Reload the list before trying again.', response.status)
  let data: unknown
  try { data = await response.json() } catch { throw new ResourceError('Save could not be confirmed. Reload the list before trying again.') }
  if (!(resource === 'products' ? isProduct(data) : isWarehouse(data)) || typeof data !== 'object'
    || data === null || !('id' in data) || data.id !== id) {
    throw new ResourceError('Save could not be confirmed. Reload the list before trying again.')
  }
}
