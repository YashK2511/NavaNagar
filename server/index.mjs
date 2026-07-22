import { createServer } from 'node:http'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT ?? 8787)
const dataFile = resolve(process.env.DATA_FILE ?? `${root}/server/data/navanagar.json`)
const aiModel = process.env.AI_MODEL ?? 'gpt-5.4-mini'
const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173'
const emptyStore = () => ({ cities: [], recommendations: [], drafts: [] })

const scenarioSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string', minLength: 20, maxLength: 360 },
    zones: {
      type: 'array', minItems: 2, maxItems: 4,
      items: { type: 'object', additionalProperties: false, properties: {
        label: { type: 'string', minLength: 3, maxLength: 64 }, rationale: { type: 'string', minLength: 10, maxLength: 180 }, priority: { type: 'string', enum: ['high', 'medium'] },
        polygon: { type: 'array', minItems: 4, maxItems: 6, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } },
      }, required: ['label', 'rationale', 'priority', 'polygon'] },
    },
    candidates: {
      type: 'array', minItems: 3, maxItems: 3,
      items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', enum: ['A', 'B', 'C'] }, label: { type: 'string', minLength: 3, maxLength: 64 }, note: { type: 'string', minLength: 10, maxLength: 180 },
        coordinates: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
      }, required: ['id', 'label', 'note', 'coordinates'] },
    },
    riskCorridor: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } } },
  },
  required: ['summary', 'zones', 'candidates', 'riskCorridor'],
}

function isHyderabadCoordinate(value) {
  return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'number' && Number.isFinite(item))
    && value[0] >= 78.28 && value[0] <= 78.66 && value[1] >= 17.27 && value[1] <= 17.58
}

function validScenarioDraft(draft) {
  return draft && typeof draft === 'object' && typeof draft.summary === 'string'
    && Array.isArray(draft.zones) && draft.zones.length >= 2 && draft.zones.length <= 4
    && draft.zones.every((zone) => zone && typeof zone.label === 'string' && typeof zone.rationale === 'string' && ['high', 'medium'].includes(zone.priority) && Array.isArray(zone.polygon) && zone.polygon.length >= 4 && zone.polygon.every(isHyderabadCoordinate))
    && Array.isArray(draft.candidates) && draft.candidates.length === 3
    && ['A', 'B', 'C'].every((id) => draft.candidates.some((candidate) => candidate?.id === id))
    && draft.candidates.every((candidate) => candidate && typeof candidate.label === 'string' && typeof candidate.note === 'string' && isHyderabadCoordinate(candidate.coordinates))
    && Array.isArray(draft.riskCorridor) && draft.riskCorridor.length >= 2 && draft.riskCorridor.every(isHyderabadCoordinate)
}

function outputText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text
  const content = Array.isArray(payload.output) ? payload.output.flatMap((item) => Array.isArray(item.content) ? item.content : []) : []
  const text = content.find((item) => typeof item?.text === 'string')?.text
  return typeof text === 'string' ? text : undefined
}

async function generateScenarioDraft(requestText) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('Live AI is not configured. Add OPENAI_API_KEY to .env.local, then restart npm run api.')
    error.statusCode = 503
    throw error
  }
  const upstream = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: aiModel,
      input: [
        { role: 'system', content: 'You draft illustrative planning scenarios for a hackathon map. You must not claim factual municipal data, legal ownership, real parcel availability, real population values, or verified hazards. Return only a cautious hypothetical scenario. Coordinates must stay inside Hyderabad bounds: longitude 78.28–78.66 and latitude 17.27–17.58. Return 2–4 simple non-self-intersecting zone polygons, A/B/C candidate points, and one short corridor. Describe uncertainty in the summary.' },
        { role: 'user', content: `Create an AI-assisted draft map scenario for this planning request: ${requestText}` },
      ],
      text: { format: { type: 'json_schema', name: 'hyderabad_planning_draft', strict: true, schema: scenarioSchema } },
      max_output_tokens: 1800,
    }),
  })
  const payload = await upstream.json()
  if (!upstream.ok) {
    const message = upstream.status === 429
      ? 'Live AI is unavailable because this API account has no available quota. Add API billing or credits in the OpenAI platform, then restart npm run api.'
      : payload?.error?.message ?? 'The AI provider rejected this scenario request.'
    const error = new Error(message)
    error.statusCode = upstream.status
    throw error
  }
  const text = outputText(payload)
  if (!text) throw new Error('The AI response did not contain a usable scenario draft.')
  const draft = JSON.parse(text)
  if (!validScenarioDraft(draft)) throw new Error('The AI response did not satisfy the map safety checks. Try a more specific planning request.')
  return draft
}

async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(dataFile, 'utf8'))
    return {
      cities: Array.isArray(parsed.cities) ? parsed.cities : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
    }
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return emptyStore()
    throw error
  }
}

async function writeStore(store) {
  await mkdir(dirname(dataFile), { recursive: true })
  const temporaryFile = `${dataFile}.tmp`
  await writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  await rename(temporaryFile, dataFile)
}

function send(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  response.end(JSON.stringify(payload))
}

async function readJson(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 2_000_000) throw new Error('Request body is too large.')
  }
  if (!body) throw new Error('A JSON request body is required.')
  const parsed = JSON.parse(body)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Request body must be a JSON object.')
  return parsed
}

function validCity(city, id) {
  return city && typeof city === 'object' && !Array.isArray(city) && city.id === id && typeof city.name === 'string'
}

function validRecommendation(record) {
  return record && typeof record === 'object' && !Array.isArray(record)
    && typeof record.id === 'string' && typeof record.cityId === 'string' && record.winner && typeof record.winner === 'object'
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') return send(response, 204, {})
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    const cityMatch = url.pathname.match(/^\/api\/cities\/([^/]+)$/)

    if (request.method === 'GET' && url.pathname === '/api/health') {
      const store = await readStore()
      return send(response, 200, { ok: true, storage: 'local-json', cities: store.cities.length, recommendations: store.recommendations.length, drafts: store.drafts.length, aiConfigured: Boolean(process.env.OPENAI_API_KEY) })
    }
    if (request.method === 'GET' && url.pathname === '/api/ai/status') return send(response, 200, { configured: Boolean(process.env.OPENAI_API_KEY), model: aiModel })
    if (request.method === 'POST' && url.pathname === '/api/ai/scenario') {
      const body = await readJson(request)
      if (typeof body.request !== 'string' || body.request.trim().length < 8 || body.request.length > 800) return send(response, 400, { error: 'Provide a planning request between 8 and 800 characters.' })
      const draft = await generateScenarioDraft(body.request.trim())
      const store = await readStore()
      const record = { id: `${Date.now()}-ai-draft`, createdAt: new Date().toISOString(), request: body.request.trim(), draft }
      store.drafts = [record, ...store.drafts].slice(0, 30)
      await writeStore(store)
      return send(response, 200, { draft, record, provenance: 'AI-assisted draft scenario — validate all locations and evidence with municipal sources.' })
    }
    if (request.method === 'GET' && url.pathname === '/api/ai/drafts') {
      const store = await readStore()
      return send(response, 200, { drafts: store.drafts })
    }
    if (request.method === 'DELETE' && url.pathname === '/api/ai/drafts') {
      const store = await readStore()
      store.drafts = []
      await writeStore(store)
      return send(response, 204, {})
    }
    if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
      return send(response, 200, await readStore())
    }
    if (request.method === 'GET' && url.pathname === '/api/cities') {
      const store = await readStore()
      return send(response, 200, { cities: store.cities })
    }
    if (cityMatch && request.method === 'PUT') {
      const id = decodeURIComponent(cityMatch[1])
      const city = await readJson(request)
      if (!validCity(city, id)) return send(response, 400, { error: 'City id and name are required, and the URL id must match city.id.' })
      const store = await readStore()
      store.cities = [...store.cities.filter((item) => item.id !== id), city]
      await writeStore(store)
      return send(response, 200, { city })
    }
    if (cityMatch && request.method === 'DELETE') {
      const id = decodeURIComponent(cityMatch[1])
      const store = await readStore()
      store.cities = store.cities.filter((item) => item.id !== id)
      await writeStore(store)
      return send(response, 204, {})
    }
    if (request.method === 'GET' && url.pathname === '/api/recommendations') {
      const store = await readStore()
      return send(response, 200, { recommendations: store.recommendations })
    }
    if (request.method === 'POST' && url.pathname === '/api/recommendations') {
      const recommendation = await readJson(request)
      if (!validRecommendation(recommendation)) return send(response, 400, { error: 'Recommendation id, cityId, and winner are required.' })
      const store = await readStore()
      store.recommendations = [recommendation, ...store.recommendations.filter((item) => item.id !== recommendation.id)].slice(0, 100)
      await writeStore(store)
      return send(response, 201, { recommendation })
    }
    if (request.method === 'DELETE' && url.pathname === '/api/recommendations') {
      const store = await readStore()
      store.recommendations = []
      await writeStore(store)
      return send(response, 204, {})
    }
    return send(response, 404, { error: 'Route not found.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.'
    const status = error && typeof error === 'object' && typeof error.statusCode === 'number' ? error.statusCode : message.includes('JSON') || message.includes('required') || message.includes('large') ? 400 : 500
    return send(response, status, { error: message })
  }
})

server.listen(port, () => {
  console.log(`NavaNagar API listening on http://localhost:${port}`)
})
