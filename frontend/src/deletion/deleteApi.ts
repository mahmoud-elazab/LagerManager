import { ResourceError, validRecordId } from '../resources/resourceApi'

export type DeletableResource = 'products' | 'warehouses' | 'inventory'

export async function deleteRecord(resource: DeletableResource, id: number, token: string,
  signal: AbortSignal): Promise<void> {
  if (!validRecordId(id)) throw new ResourceError('This item cannot be deleted.')
  let response: Response
  try {
    response = await fetch(`/api/${resource}/${id}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', signal,
    })
  } catch {
    throw new ResourceError('Deletion could not be confirmed. Reload the list to check whether the item still exists.')
  }
  if (response.status === 401) throw new ResourceError('Please sign in again to continue.', 401)
  if (response.status === 403) throw new ResourceError('Access denied. Deletion is not permitted for your account.', 403)
  if (response.status === 404) throw new ResourceError('This item was not found. Reload the list.', 404)
  if (response.status === 409) {
    let body: unknown
    try { body = await response.json() } catch { body = null }
    if (resource !== 'inventory' && typeof body === 'object' && body !== null && 'code' in body
      && body.code === 'INVENTORY_REFERENCE_CONFLICT' && 'message' in body
      && typeof body.message === 'string' && Boolean(body.message.trim())) {
      throw new ResourceError(`Inventory still uses this ${resource === 'products' ? 'product' : 'warehouse'}. It cannot be deleted.`, 409)
    }
    if (resource === 'inventory' && typeof body === 'object' && body !== null && 'code' in body
      && body.code === 'STOCK_HISTORY_CONFLICT') {
      throw new ResourceError('Inventory with stock or movement history cannot be deleted.', 409)
    }
    throw new ResourceError('This item could not be deleted because of a conflict. Reload the list.', 409)
  }
  if (!response.ok) throw new ResourceError('Deletion could not be confirmed. Reload the list to check whether the item still exists.', response.status)
  // Existing DELETE controllers return void; successful empty responses require no JSON parsing.
}
