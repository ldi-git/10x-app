import {
  assert,
  assertEquals,
  assertAlmostEquals,
} from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { median, parseConnectionString, utmToWgs84 } from './lib.ts'

// ---------------------------------------------------------------------------
// median()
// ---------------------------------------------------------------------------

Deno.test('median: empty array returns NaN', () => {
  assert(Number.isNaN(median([])))
})

Deno.test('median: single element returns that element', () => {
  assertEquals(median([55000]), 55000)
})

Deno.test('median: odd count returns middle element after sorting', () => {
  assertEquals(median([70000, 30000, 50000]), 50000)
})

Deno.test('median: even count returns average of two middle elements', () => {
  assertEquals(median([10000, 20000, 30000, 40000]), 25000)
})

Deno.test('median: even count two elements', () => {
  assertEquals(median([40000, 60000]), 50000)
})

Deno.test('median: large even set', () => {
  assertEquals(median([5000, 6000, 7000, 8000, 9000, 10000]), 7500)
})

Deno.test('median: all identical values', () => {
  assertEquals(median([50000, 50000, 50000]), 50000)
})

Deno.test('median: does not mutate the input array', () => {
  const input = [30000, 10000, 20000]
  median(input)
  assertEquals(input, [30000, 10000, 20000])
})

Deno.test('median: Infinity in input propagates (no living_area_m2 > 0 guard in caller)', () => {
  // A comparable with living_area_m2 = 0 produces Infinity. The median of
  // [Infinity, 50000, 60000] is 60000 (Infinity sorts last, mid element is 60000).
  // The isNaN guard in the caller does NOT catch Infinity — callers must filter
  // living_area_m2 > 0 before calling median.
  const withInfinity = median([Infinity, 50000, 60000])
  assertEquals(withInfinity, 60000)
  // But if Infinity is the sole or median value, it propagates unchecked:
  assert(!Number.isNaN(median([Infinity])))
  assertEquals(median([Infinity]), Infinity)
})

// ---------------------------------------------------------------------------
// parseConnectionString()
// ---------------------------------------------------------------------------

Deno.test('parseConnectionString: parses server, port, user, password', () => {
  const cfg = parseConnectionString('Server=geo-sif,1433;User Id=sa;Password=secret;')
  assertEquals(cfg.server, 'geo-sif')
  assertEquals(cfg.port, 1433)
  assertEquals(cfg.user, 'sa')
  assertEquals(cfg.password, 'secret')
})

Deno.test('parseConnectionString: defaults to port 1433 when not in Server key', () => {
  const cfg = parseConnectionString('Server=geo-sif;User Id=sa;Password=secret;')
  assertEquals(cfg.server, 'geo-sif')
  assertEquals(cfg.port, 1433)
})

Deno.test('parseConnectionString: preserves password containing equals sign', () => {
  // indexOf('=') finds the first = (the key/value separator), slice(idx+1) keeps
  // everything after it — so = characters inside values are preserved.
  const cfg = parseConnectionString('Server=geo-sif;User Id=sa;Password=p@ss=word==;')
  assertEquals(cfg.password, 'p@ss=word==')
})

Deno.test('parseConnectionString: sets fixed options and requestTimeout', () => {
  const cfg = parseConnectionString('Server=geo-sif;User Id=sa;Password=secret;')
  assertEquals(cfg.options.encrypt, false)
  assertEquals(cfg.options.trustServerCertificate, true)
  assertEquals(cfg.requestTimeout, 12000)
})

Deno.test('parseConnectionString: missing keys produce undefined fields', () => {
  // A minimal connection string with only Server — user/password are undefined
  const cfg = parseConnectionString('Server=geo-sif;')
  assertEquals(cfg.server, 'geo-sif')
  assertEquals(cfg.user, undefined)
  assertEquals(cfg.password, undefined)
})

// ---------------------------------------------------------------------------
// utmToWgs84()
// ---------------------------------------------------------------------------

Deno.test('utmToWgs84: Copenhagen coordinate (Østerbro/Nordhavn area)', () => {
  // UTM32N (725461, 6177066) → verified against proj4 output 2026-05-13.
  const result = utmToWgs84(725461, 6177066)
  assert(result !== null, 'expected non-null result for valid UTM32N input')
  assertAlmostEquals(result.lat, 55.686904, 0.001)
  assertAlmostEquals(result.lng, 12.586938, 0.001)
})

Deno.test('utmToWgs84: Birkerød coordinate matches verified WGS84', () => {
  // BBR byg404Koordinat for BFE 2379339 (Pilegårdsparken 87, 3460 Birkerød).
  // Expected WGS84 verified via inverse UTM32N formula on 2026-05-13.
  const result = utmToWgs84(713204.86, 6193806.55)
  assert(result !== null, 'expected non-null result for valid UTM32N input')
  assertAlmostEquals(result.lat, 55.8426, 0.001)
  assertAlmostEquals(result.lng, 12.4054, 0.001)
})

Deno.test('utmToWgs84: lat/lng axis order is correct for Denmark', () => {
  // Denmark: lat ~55-57°N, lng ~8-15°E — lat is always greater than lng.
  // This guards against proj4 returning [lat, lng] instead of [lng, lat].
  const result = utmToWgs84(725461, 6177066)
  assert(result !== null)
  assert(
    result.lat > result.lng,
    `lat (${result.lat}) should be greater than lng (${result.lng}) for Danish coordinates`,
  )
})

Deno.test('utmToWgs84: returns null on NaN input', () => {
  assertEquals(utmToWgs84(NaN, NaN), null)
})
