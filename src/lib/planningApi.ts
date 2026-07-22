const apiUrl = import.meta.env.VITE_PLANNING_API_URL || 'http://localhost:8787'

type BackendBootstrap<TCity, TRecommendation> = {
  cities: TCity[]
  recommendations: TRecommendation[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error ?? `Backend request failed (${response.status}).`)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

export function loadBackend<TCity, TRecommendation>() {
  return request<BackendBootstrap<TCity, TRecommendation>>('/api/bootstrap')
}

export function saveCity(city: { id: string }) {
  return request(`/api/cities/${encodeURIComponent(city.id)}`, { method: 'PUT', body: JSON.stringify(city) })
}

export function removeCity(cityId: string) {
  return request<void>(`/api/cities/${encodeURIComponent(cityId)}`, { method: 'DELETE' })
}

export function saveRecommendation(record: { id: string }) {
  return request('/api/recommendations', { method: 'POST', body: JSON.stringify(record) })
}

export function clearRecommendations() {
  return request<void>('/api/recommendations', { method: 'DELETE' })
}
