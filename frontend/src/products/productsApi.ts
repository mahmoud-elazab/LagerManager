export type Product = {
  id: number | null
  name: string | null
  sku: string | null
  category: string | null
  quantity: number
  price: number | null
}

export class ProductsError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isProduct(value: unknown): value is Product {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (item.id === null || (typeof item.id === 'number' && Number.isSafeInteger(item.id)))
    && nullableText(item.name) && nullableText(item.sku) && nullableText(item.category)
    && typeof item.quantity === 'number' && Number.isInteger(item.quantity)
    && item.quantity >= -2147483648 && item.quantity <= 2147483647
    && (item.price === null || (typeof item.price === 'number' && Number.isFinite(item.price)))
}

export async function loadProducts(token: string, signal: AbortSignal): Promise<Product[]> {
  let response: Response
  try {
    response = await fetch('/api/products', {
      headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', signal,
    })
  } catch {
    throw new ProductsError('Unable to connect. Check your connection and try again.')
  }
  if (response.status === 401) throw new ProductsError('Please sign in again to continue.', 401)
  if (response.status === 403) throw new ProductsError('Access denied. You do not have permission to view products.', 403)
  if (!response.ok) throw new ProductsError('Unable to load products. Please try again later.', response.status)
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new ProductsError('Unexpected product response. Please try again later.')
  }
  if (!Array.isArray(data) || !data.every(isProduct)) {
    throw new ProductsError('Unexpected product response. Please try again later.')
  }
  return data
}
