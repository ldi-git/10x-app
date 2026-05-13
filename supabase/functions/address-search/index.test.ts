import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { handler } from './index.ts'

// ---------------------------------------------------------------------------
// env setup (mock mode — no SQL Server required)
// ---------------------------------------------------------------------------

Deno.env.set('MOCK_GEO_SIF', 'true')
Deno.env.set('SUPABASE_URL', 'http://localhost:54321')
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key')

// ---------------------------------------------------------------------------
// test doubles
// ---------------------------------------------------------------------------

function mockSupabase(user: { id: string } | null) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user },
          error: user === null ? new Error('Invalid JWT') : null,
        }),
    },
  }
}

const VALID_USER = mockSupabase({ id: 'test-uid' })
const AUTH_ERROR = mockSupabase(null)

function getReq(q: string, { auth = 'Bearer valid-token' }: { auth?: string | null } = {}): Request {
  const headers: Record<string, string> = {}
  if (auth !== null) headers['authorization'] = auth
  return new Request(`https://test/address-search?q=${encodeURIComponent(q)}`, { headers })
}

// ---------------------------------------------------------------------------
// CORS preflight
// ---------------------------------------------------------------------------

Deno.test('address-search handler: OPTIONS returns 200', async () => {
  const res = await handler(new Request('https://test/address-search', { method: 'OPTIONS' }))
  assertEquals(res.status, 200)
})

// ---------------------------------------------------------------------------
// authentication
// ---------------------------------------------------------------------------

Deno.test('address-search handler: missing Authorization header returns 401', async () => {
  const res = await handler(getReq('København', { auth: null }))
  assertEquals(res.status, 401)
  assertEquals((await res.json()).error, 'Unauthorized')
})

Deno.test('address-search handler: invalid JWT returns 401', async () => {
  const res = await handler(getReq('København'), { supabase: AUTH_ERROR })
  assertEquals(res.status, 401)
  assertEquals((await res.json()).error, 'Unauthorized')
})

Deno.test('address-search handler: null user (no error) returns 401', async () => {
  const noUser = {
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
  }
  const res = await handler(getReq('København'), { supabase: noUser })
  assertEquals(res.status, 401)
})

// ---------------------------------------------------------------------------
// q length guards
// ---------------------------------------------------------------------------

Deno.test('address-search handler: q shorter than 3 chars returns empty array', async () => {
  const res = await handler(getReq('ab'), { supabase: VALID_USER })
  assertEquals(res.status, 200)
  assertEquals(await res.json(), [])
})

Deno.test('address-search handler: q longer than 200 chars returns empty array', async () => {
  const res = await handler(getReq('a'.repeat(201)), { supabase: VALID_USER })
  assertEquals(res.status, 200)
  assertEquals(await res.json(), [])
})

Deno.test('address-search handler: q of exactly 3 chars proceeds (no short-circuit)', async () => {
  const res = await handler(getReq('pil'), { supabase: VALID_USER })
  assertEquals(res.status, 200)
  const body = await res.json()
  // 'pil' matches 'Pilegårdsparken 87, 3460 Birkerød'
  assertEquals(Array.isArray(body), true)
  assertEquals(body.length > 0, true)
})

// ---------------------------------------------------------------------------
// mock mode filtering
// ---------------------------------------------------------------------------

Deno.test('address-search handler: returns matching addresses in mock mode', async () => {
  const res = await handler(getReq('Østerbro'), { supabase: VALID_USER })
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.length, 1)
  assertEquals(body[0].bfe_number, 100442001)
  assertEquals(body[0].display, 'Østerbrogade 42, 2100 København Ø')
})

Deno.test('address-search handler: search is case-insensitive', async () => {
  const res = await handler(getReq('østerbro'), { supabase: VALID_USER })
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.length, 1)
  assertEquals(body[0].bfe_number, 100442001)
})

Deno.test('address-search handler: returns at most 10 results', async () => {
  // 'a' matches many addresses in the mock list
  const res = await handler(getReq('gade'), { supabase: VALID_USER })
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.length <= 10, true)
})

Deno.test('address-search handler: Birkerød is findable by partial match', async () => {
  const res = await handler(getReq('Birkerød'), { supabase: VALID_USER })
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.length, 1)
  assertEquals(body[0].bfe_number, 2379339)
})

Deno.test('address-search handler: no match returns empty array', async () => {
  const res = await handler(getReq('XYZnotfound'), { supabase: VALID_USER })
  assertEquals(res.status, 200)
  assertEquals(await res.json(), [])
})

Deno.test('address-search handler: result items have bfe_number and display fields', async () => {
  const res = await handler(getReq('Rådhus'), { supabase: VALID_USER })
  assertEquals(res.status, 200)
  const [item] = await res.json()
  assertEquals(typeof item.bfe_number, 'number')
  assertEquals(typeof item.display, 'string')
})
