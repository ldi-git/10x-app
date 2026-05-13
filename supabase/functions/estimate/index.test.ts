import {
  assertEquals,
  assertObjectMatch,
} from 'https://deno.land/std@0.168.0/testing/asserts.ts'
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

function mockSupabase(
  user: { id: string } | null,
  insertError: { message: string } | null = null,
) {
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user },
          error: user === null ? new Error('Invalid JWT') : null,
        }),
    },
    from: (_table: string) => ({
      insert: (_data: unknown) => Promise.resolve({ error: insertError }),
    }),
  }
}

const VALID_USER   = mockSupabase({ id: 'test-uid' })
const AUTH_ERROR   = mockSupabase(null)          // getUser returns error
const INSERT_FAIL  = mockSupabase({ id: 'test-uid' }, { message: 'DB write error' })
const NO_RATE      = () => Promise.resolve(null)

function postReq(
  body: unknown,
  { auth = 'Bearer valid-token' }: { auth?: string | null } = {},
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth !== null) headers['authorization'] = auth
  return new Request('https://test/estimate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// CORS preflight
// ---------------------------------------------------------------------------

Deno.test('estimate handler: OPTIONS returns 200', async () => {
  const res = await handler(new Request('https://test/estimate', { method: 'OPTIONS' }))
  assertEquals(res.status, 200)
})

// ---------------------------------------------------------------------------
// authentication
// ---------------------------------------------------------------------------

Deno.test('estimate handler: missing Authorization header returns 401', async () => {
  const res = await handler(postReq({ bfe_number: 100654163 }, { auth: null }))
  assertEquals(res.status, 401)
  assertEquals((await res.json()).error, 'Unauthorized')
})

Deno.test('estimate handler: invalid JWT (getUser error) returns 401', async () => {
  const res = await handler(
    postReq({ bfe_number: 100654163 }),
    { supabase: AUTH_ERROR, fetchRate: NO_RATE },
  )
  assertEquals(res.status, 401)
  assertEquals((await res.json()).error, 'Unauthorized')
})

Deno.test('estimate handler: getUser returning null user returns 401', async () => {
  // null user, no error — exercises the !user branch independently
  const noUserSupabase = {
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  }
  const res = await handler(
    postReq({ bfe_number: 100654163 }),
    { supabase: noUserSupabase, fetchRate: NO_RATE },
  )
  assertEquals(res.status, 401)
})

// ---------------------------------------------------------------------------
// input validation
// ---------------------------------------------------------------------------

Deno.test('estimate handler: non-JSON body returns 400', async () => {
  const req = new Request('https://test/estimate', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'Content-Type': 'text/plain' },
    body: 'not-json',
  })
  const res = await handler(req, { supabase: VALID_USER, fetchRate: NO_RATE })
  assertEquals(res.status, 400)
  assertEquals((await res.json()).error, 'Request body must be valid JSON')
})

Deno.test('estimate handler: missing bfe_number returns 400', async () => {
  const res = await handler(
    postReq({}),
    { supabase: VALID_USER, fetchRate: NO_RATE },
  )
  assertEquals(res.status, 400)
  assertEquals((await res.json()).error, 'bfe_number must be a positive integer')
})

Deno.test('estimate handler: bfe_number = 0 returns 400', async () => {
  const res = await handler(postReq({ bfe_number: 0 }), { supabase: VALID_USER, fetchRate: NO_RATE })
  assertEquals(res.status, 400)
})

Deno.test('estimate handler: bfe_number = -1 returns 400', async () => {
  const res = await handler(postReq({ bfe_number: -1 }), { supabase: VALID_USER, fetchRate: NO_RATE })
  assertEquals(res.status, 400)
})

Deno.test('estimate handler: bfe_number = 1.5 (non-integer) returns 400', async () => {
  const res = await handler(postReq({ bfe_number: 1.5 }), { supabase: VALID_USER, fetchRate: NO_RATE })
  assertEquals(res.status, 400)
})

Deno.test('estimate handler: bfe_number = "abc" (string) returns 400', async () => {
  const res = await handler(postReq({ bfe_number: 'abc' }), { supabase: VALID_USER, fetchRate: NO_RATE })
  assertEquals(res.status, 400)
})

// ---------------------------------------------------------------------------
// happy path — mock mode
// ---------------------------------------------------------------------------

Deno.test('estimate handler: known BFE returns 200', async () => {
  const res = await handler(
    postReq({ bfe_number: 100654163 }),
    { supabase: VALID_USER, fetchRate: NO_RATE },
  )
  assertEquals(res.status, 200)
})

Deno.test('estimate handler: response body has all required fields', async () => {
  const res = await handler(
    postReq({ bfe_number: 100654163 }),
    { supabase: VALID_USER, fetchRate: NO_RATE },
  )
  const body = await res.json()
  assertObjectMatch(body, {
    bfe_number: 100654163,
    address: 'Rådhuspladsen 7, 1550 København V',
    living_area_m2: 187,
    build_year: 1903,
    building_use: 120,
    municipality_code: '0101',
  })
  assertEquals(typeof body.estimated_price, 'number')
  assertEquals(typeof body.price_per_m2, 'number')
  assertEquals(typeof body.comparable_count, 'number')
  assertEquals(Array.isArray(body.comparables), true)
  assertEquals(typeof body.persisted, 'boolean')
})

Deno.test('estimate handler: estimated_price and price_per_m2 are positive integers', async () => {
  const res = await handler(
    postReq({ bfe_number: 100654163 }),
    { supabase: VALID_USER, fetchRate: NO_RATE },
  )
  const body = await res.json()
  assertEquals(Number.isInteger(body.estimated_price), true)
  assertEquals(Number.isInteger(body.price_per_m2), true)
  assertEquals(body.estimated_price > 0, true)
  assertEquals(body.price_per_m2 > 0, true)
})

Deno.test('estimate handler: comparable_count matches filtered comparables used in median', async () => {
  const res = await handler(
    postReq({ bfe_number: 100654163 }),
    { supabase: VALID_USER, fetchRate: NO_RATE },
  )
  const body = await res.json()
  // All 10 mock comparables for 0101_120 have living_area_m2 > 0
  assertEquals(body.comparable_count, 10)
})

Deno.test('estimate handler: coordinates included for property with lat/lng', async () => {
  const res = await handler(
    postReq({ bfe_number: 100654163 }),
    { supabase: VALID_USER, fetchRate: NO_RATE },
  )
  const body = await res.json()
  assertEquals(typeof body.coordinates?.lat, 'number')
  assertEquals(typeof body.coordinates?.lng, 'number')
})

Deno.test('estimate handler: interest_rate is null when fetchRate returns null', async () => {
  const res = await handler(
    postReq({ bfe_number: 100654163 }),
    { supabase: VALID_USER, fetchRate: NO_RATE },
  )
  assertEquals((await res.json()).interest_rate, null)
})

Deno.test('estimate handler: interest_rate propagates value from fetchRate', async () => {
  const res = await handler(
    postReq({ bfe_number: 100654163 }),
    { supabase: VALID_USER, fetchRate: () => Promise.resolve(3.5) },
  )
  assertEquals((await res.json()).interest_rate, 3.5)
})

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

Deno.test('estimate handler: persisted is true when insert succeeds', async () => {
  const res = await handler(
    postReq({ bfe_number: 100654163 }),
    { supabase: VALID_USER, fetchRate: NO_RATE },
  )
  assertEquals((await res.json()).persisted, true)
})

Deno.test('estimate handler: persisted is false when Supabase insert fails', async () => {
  const res = await handler(
    postReq({ bfe_number: 100654163 }),
    { supabase: INSERT_FAIL, fetchRate: NO_RATE },
  )
  const body = await res.json()
  // still 200 — estimate is returned even when persist fails
  assertEquals(res.status, 200)
  assertEquals(body.persisted, false)
  assertEquals(typeof body.estimated_price, 'number')
})

// ---------------------------------------------------------------------------
// building with multiple units
// ---------------------------------------------------------------------------

Deno.test('estimate handler: multi-unit building includes units array', async () => {
  // BFE 100442002 (Nørrebrogade 18) has 5 mock units
  const res = await handler(
    postReq({ bfe_number: 100442002 }),
    { supabase: VALID_USER, fetchRate: NO_RATE },
  )
  const body = await res.json()
  assertEquals(Array.isArray(body.units), true)
  assertEquals(body.units.length > 1, true)
  assertEquals(typeof body.units[0].estimated_price, 'number')
})
