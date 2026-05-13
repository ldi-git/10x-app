import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import sql from 'npm:mssql'
import proj4 from 'npm:proj4'

// ETRS89 / UTM zone 32N — Danish national coordinate system used in BBR
proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs')

function utmToWgs84(x: number, y: number): { lat: number; lng: number } | null {
  try {
    const [lng, lat] = proj4('EPSG:25832', 'WGS84', [x, y]) as [number, number]
    return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) }
  } catch {
    return null
  }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MockUnit { address: string; use_type: number; area_m2: number; rooms: number }
const MOCK_PROPERTIES: Record<number, {
  address: string; living_area_m2: number; build_year: number
  building_use: number; municipality_code: string; units?: MockUnit[]
  lat: number; lng: number
}> = {
  100654163: { address: 'Rådhuspladsen 7, 1550 København V',   living_area_m2: 187, build_year: 1903, building_use: 120, municipality_code: '0101', lat: 55.676100, lng: 12.569700 },
  100442001: { address: 'Østerbrogade 42, 2100 København Ø',   living_area_m2: 134, build_year: 1962, building_use: 120, municipality_code: '0101', lat: 55.704100, lng: 12.576300 },
  100442002: { address: 'Nørrebrogade 18, 2200 København N',   living_area_m2: 420, build_year: 1935, building_use: 140, municipality_code: '0101', lat: 55.692800, lng: 12.549800,
    units: [
      { address: 'Nørrebrogade 18, st. th., 2200 København N',  use_type: 140, area_m2:  88, rooms: 3 },
      { address: 'Nørrebrogade 18, st. tv., 2200 København N',  use_type: 140, area_m2:  76, rooms: 3 },
      { address: 'Nørrebrogade 18, 1. th., 2200 København N',   use_type: 140, area_m2:  92, rooms: 4 },
      { address: 'Nørrebrogade 18, 1. tv., 2200 København N',   use_type: 140, area_m2:  82, rooms: 3 },
      { address: 'Nørrebrogade 18, 2. th., 2200 København N',   use_type: 140, area_m2:  82, rooms: 3 },
    ]
  },
  100442003: { address: 'Vesterbrogade 55, 1620 København V',  living_area_m2: 112, build_year: 1948, building_use: 130, municipality_code: '0101', lat: 55.672000, lng: 12.550700 },
  200103001: { address: 'Aarhus Allé 12, 8000 Aarhus C',       living_area_m2: 158, build_year: 1971, building_use: 120, municipality_code: '0751', lat: 56.153500, lng: 10.208900 },
  200103002: { address: 'Åboulevarden 27, 8000 Aarhus C',      living_area_m2: 560, build_year: 1989, building_use: 140, municipality_code: '0751', lat: 56.157400, lng: 10.202100,
    units: [
      { address: 'Åboulevarden 27, st., 8000 Aarhus C',         use_type: 140, area_m2: 104, rooms: 4 },
      { address: 'Åboulevarden 27, 1. th., 8000 Aarhus C',      use_type: 140, area_m2:  98, rooms: 4 },
      { address: 'Åboulevarden 27, 1. tv., 8000 Aarhus C',      use_type: 140, area_m2:  87, rooms: 3 },
      { address: 'Åboulevarden 27, 2. th., 8000 Aarhus C',      use_type: 140, area_m2: 115, rooms: 4 },
      { address: 'Åboulevarden 27, 2. tv., 8000 Aarhus C',      use_type: 140, area_m2:  87, rooms: 3 },
      { address: 'Åboulevarden 27, 3. th., 8000 Aarhus C',      use_type: 140, area_m2:  69, rooms: 2 },
    ]
  },
  300201001: { address: 'Kongensgade 8, 5000 Odense C',        living_area_m2: 145, build_year: 1967, building_use: 120, municipality_code: '0461', lat: 55.397200, lng: 10.389900 },
  400301001: { address: 'Algade 33, 9000 Aalborg',             living_area_m2: 122, build_year: 1958, building_use: 120, municipality_code: '0851', lat: 57.048800, lng:  9.920500 },
  500401001: { address: 'Skomagergade 14, 4000 Roskilde',      living_area_m2: 139, build_year: 1974, building_use: 120, municipality_code: '0265', lat: 55.646000, lng: 12.081000 },
  600501001: { address: 'Skolegade 5, 7100 Vejle',             living_area_m2: 116, build_year: 1983, building_use: 120, municipality_code: '0630', lat: 55.711300, lng:  9.536700 },
  2379339:   { address: 'Pilegårdsparken 87, 3460 Birkerød',   living_area_m2: 135, build_year: 1968, building_use: 120, municipality_code: '0230', lat: 55.842594, lng: 12.405423 },
}

type Comparable = { bfe: number; sale_price: number; sale_date: string; living_area_m2: number; address?: string }

// Keyed by `${municipality_code}_${building_use}`.
// 0101_120: real open-market sales from Stag_Datafordeler_EJF (kommunekode 0101, byg021=120, 2024-2026).
// All other keys: realistic market-level data (see geo-sif query results — staging DB has no coverage
// outside Copenhagen, so prices are calibrated to known Danish market levels per municipality).
const MOCK_COMPARABLES: Record<string, Comparable[]> = {
  // København — etagebolig (use_type 120) — real geo-sif BFEs
  '0101_120': [
    { bfe: 701811, sale_price: 6795000, sale_date: '2026-06-01', living_area_m2: 120 },
    { bfe: 701741, sale_price: 6700000, sale_date: '2026-03-01', living_area_m2: 101 },
    { bfe: 701738, sale_price: 6000000, sale_date: '2026-04-01', living_area_m2:  98 },
    { bfe: 706327, sale_price: 6750000, sale_date: '2026-02-01', living_area_m2: 122 },
    { bfe: 701913, sale_price: 6895000, sale_date: '2025-06-01', living_area_m2: 128 },
    { bfe: 701266, sale_price: 7495000, sale_date: '2025-06-01', living_area_m2: 140 },
    { bfe: 701877, sale_price: 5495000, sale_date: '2025-04-01', living_area_m2: 114 },
    { bfe: 701290, sale_price: 6000000, sale_date: '2025-03-01', living_area_m2: 120 },
    { bfe: 702297, sale_price: 5800000, sale_date: '2025-03-01', living_area_m2:  97 },
    { bfe: 706600, sale_price: 4950000, sale_date: '2024-11-15', living_area_m2: 112 },
  ],
  // København — rækkehus (use_type 130) — ~38 000 kr/m²
  '0101_130': [
    { bfe: 710001, sale_price: 4650000, sale_date: '2025-10-01', living_area_m2: 118 },
    { bfe: 710002, sale_price: 3550000, sale_date: '2025-08-01', living_area_m2: 104 },
    { bfe: 710003, sale_price: 5200000, sale_date: '2025-06-01', living_area_m2: 135 },
    { bfe: 710004, sale_price: 4100000, sale_date: '2025-03-01', living_area_m2: 108 },
    { bfe: 710005, sale_price: 4900000, sale_date: '2024-12-01', living_area_m2: 128 },
    { bfe: 710006, sale_price: 3750000, sale_date: '2024-09-01', living_area_m2:  98 },
    { bfe: 710007, sale_price: 5600000, sale_date: '2024-06-01', living_area_m2: 145 },
    { bfe: 710008, sale_price: 4450000, sale_date: '2024-03-01', living_area_m2: 116 },
    { bfe: 710009, sale_price: 3250000, sale_date: '2023-12-01', living_area_m2:  88 },
    { bfe: 710010, sale_price: 4350000, sale_date: '2023-09-01', living_area_m2: 113 },
  ],
  // København — etagehus/bygning (use_type 140) — 1 real BFE + market-level data ~66 000 kr/m²
  '0101_140': [
    { bfe: 706758, sale_price: 16500000, sale_date: '2024-03-01', living_area_m2: 186 },
    { bfe: 711001, sale_price: 28000000, sale_date: '2025-09-01', living_area_m2: 420 },
    { bfe: 711002, sale_price: 18500000, sale_date: '2025-06-01', living_area_m2: 280 },
    { bfe: 711003, sale_price: 35000000, sale_date: '2025-03-01', living_area_m2: 530 },
    { bfe: 711004, sale_price: 22000000, sale_date: '2024-12-01', living_area_m2: 335 },
    { bfe: 711005, sale_price: 14500000, sale_date: '2024-09-01', living_area_m2: 220 },
    { bfe: 711006, sale_price: 42000000, sale_date: '2024-06-01', living_area_m2: 635 },
    { bfe: 711007, sale_price: 12000000, sale_date: '2024-01-01', living_area_m2: 183 },
    { bfe: 711008, sale_price: 31500000, sale_date: '2023-10-01', living_area_m2: 476 },
    { bfe: 711009, sale_price: 19500000, sale_date: '2023-07-01', living_area_m2: 296 },
  ],
  // Aarhus — etagebolig (use_type 120) — market-level ~28 000 kr/m²
  // (BFE 745466 from staging DB excluded: 13 314 kr/m² indicates andelsbolig, now filtered by enh023Boligtype='1')
  '0751_120': [
    { bfe: 746010, sale_price:  3050000, sale_date: '2024-10-01', living_area_m2: 108 },
    { bfe: 746001, sale_price:  4550000, sale_date: '2025-10-01', living_area_m2: 155 },
    { bfe: 746002, sale_price:  3200000, sale_date: '2025-07-01', living_area_m2: 112 },
    { bfe: 746003, sale_price:  5100000, sale_date: '2025-04-01', living_area_m2: 178 },
    { bfe: 746004, sale_price:  2750000, sale_date: '2025-01-01', living_area_m2:  97 },
    { bfe: 746005, sale_price:  4200000, sale_date: '2024-09-01', living_area_m2: 146 },
    { bfe: 746006, sale_price:  2450000, sale_date: '2024-06-01', living_area_m2:  86 },
    { bfe: 746007, sale_price:  3750000, sale_date: '2024-03-01', living_area_m2: 132 },
    { bfe: 746008, sale_price:  2950000, sale_date: '2023-12-01', living_area_m2: 103 },
    { bfe: 746009, sale_price:  4900000, sale_date: '2023-09-01', living_area_m2: 171 },
  ],
  // Aarhus — etagehus/bygning (use_type 140) — market-level ~27 000 kr/m²
  '0751_140': [
    { bfe: 747001, sale_price: 15500000, sale_date: '2025-10-01', living_area_m2: 567 },
    { bfe: 747002, sale_price:  9800000, sale_date: '2025-07-01', living_area_m2: 372 },
    { bfe: 747003, sale_price: 19500000, sale_date: '2025-04-01', living_area_m2: 715 },
    { bfe: 747004, sale_price: 12500000, sale_date: '2025-01-01', living_area_m2: 462 },
    { bfe: 747005, sale_price:  8200000, sale_date: '2024-10-01', living_area_m2: 308 },
    { bfe: 747006, sale_price: 14000000, sale_date: '2024-07-01', living_area_m2: 520 },
    { bfe: 747007, sale_price: 11000000, sale_date: '2024-04-01', living_area_m2: 410 },
    { bfe: 747008, sale_price: 17000000, sale_date: '2024-01-01', living_area_m2: 630 },
    { bfe: 747009, sale_price: 13500000, sale_date: '2023-10-01', living_area_m2: 498 },
    { bfe: 747010, sale_price:  7000000, sale_date: '2023-07-01', living_area_m2: 265 },
  ],
  // Odense — etagebolig (use_type 120) — market-level ~20 000 kr/m²
  '0461_120': [
    { bfe: 755001, sale_price: 3200000, sale_date: '2025-10-01', living_area_m2: 148 },
    { bfe: 755002, sale_price: 2100000, sale_date: '2025-07-01', living_area_m2: 103 },
    { bfe: 755003, sale_price: 3800000, sale_date: '2025-04-01', living_area_m2: 174 },
    { bfe: 755004, sale_price: 1700000, sale_date: '2025-01-01', living_area_m2:  86 },
    { bfe: 755005, sale_price: 2800000, sale_date: '2024-10-01', living_area_m2: 133 },
    { bfe: 755006, sale_price: 1550000, sale_date: '2024-07-01', living_area_m2:  78 },
    { bfe: 755007, sale_price: 3500000, sale_date: '2024-04-01', living_area_m2: 161 },
    { bfe: 755008, sale_price: 2250000, sale_date: '2024-01-01', living_area_m2: 111 },
    { bfe: 755009, sale_price: 2000000, sale_date: '2023-10-01', living_area_m2:  99 },
    { bfe: 755010, sale_price: 2500000, sale_date: '2023-07-01', living_area_m2: 122 },
  ],
  // Aalborg — etagebolig (use_type 120) — market-level ~20 000 kr/m²
  // (staging DB has terrace house sales 752687-752702; no type-120 data available)
  '0851_120': [
    { bfe: 757001, sale_price: 2200000, sale_date: '2025-10-01', living_area_m2: 110 },
    { bfe: 757002, sale_price: 1650000, sale_date: '2025-07-01', living_area_m2:  84 },
    { bfe: 757003, sale_price: 2600000, sale_date: '2025-04-01', living_area_m2: 131 },
    { bfe: 757004, sale_price: 1450000, sale_date: '2025-01-01', living_area_m2:  74 },
    { bfe: 757005, sale_price: 2400000, sale_date: '2024-10-01', living_area_m2: 121 },
    { bfe: 757006, sale_price: 1800000, sale_date: '2024-07-01', living_area_m2:  91 },
    { bfe: 757007, sale_price: 2850000, sale_date: '2024-04-01', living_area_m2: 144 },
    { bfe: 757008, sale_price: 1950000, sale_date: '2024-01-01', living_area_m2:  99 },
    { bfe: 757009, sale_price: 2100000, sale_date: '2023-10-01', living_area_m2: 107 },
    { bfe: 757010, sale_price: 2300000, sale_date: '2023-07-01', living_area_m2: 116 },
  ],
  // Roskilde — etagebolig (use_type 120) — market-level ~31 000 kr/m²
  '0265_120': [
    { bfe: 732001, sale_price: 4300000, sale_date: '2025-10-01', living_area_m2: 138 },
    { bfe: 732002, sale_price: 3100000, sale_date: '2025-07-01', living_area_m2: 101 },
    { bfe: 732003, sale_price: 5100000, sale_date: '2025-04-01', living_area_m2: 163 },
    { bfe: 732004, sale_price: 2600000, sale_date: '2025-01-01', living_area_m2:  85 },
    { bfe: 732005, sale_price: 4700000, sale_date: '2024-10-01', living_area_m2: 152 },
    { bfe: 732006, sale_price: 2350000, sale_date: '2024-07-01', living_area_m2:  77 },
    { bfe: 732007, sale_price: 5600000, sale_date: '2024-04-01', living_area_m2: 179 },
    { bfe: 732008, sale_price: 3600000, sale_date: '2024-01-01', living_area_m2: 116 },
    { bfe: 732009, sale_price: 2800000, sale_date: '2023-10-01', living_area_m2:  91 },
    { bfe: 732010, sale_price: 4050000, sale_date: '2023-07-01', living_area_m2: 130 },
  ],
  // Vejle — etagebolig (use_type 120) — market-level ~23 000 kr/m²
  '0630_120': [
    { bfe: 735001, sale_price: 2600000, sale_date: '2025-10-01', living_area_m2: 112 },
    { bfe: 735002, sale_price: 1900000, sale_date: '2025-07-01', living_area_m2:  84 },
    { bfe: 735003, sale_price: 3100000, sale_date: '2025-04-01', living_area_m2: 134 },
    { bfe: 735004, sale_price: 1650000, sale_date: '2025-01-01', living_area_m2:  74 },
    { bfe: 735005, sale_price: 2850000, sale_date: '2024-10-01', living_area_m2: 123 },
    { bfe: 735006, sale_price: 1750000, sale_date: '2024-07-01', living_area_m2:  79 },
    { bfe: 735007, sale_price: 3400000, sale_date: '2024-04-01', living_area_m2: 147 },
    { bfe: 735008, sale_price: 2150000, sale_date: '2024-01-01', living_area_m2:  95 },
    { bfe: 735009, sale_price: 2400000, sale_date: '2023-10-01', living_area_m2: 105 },
    { bfe: 735010, sale_price: 2700000, sale_date: '2023-07-01', living_area_m2: 119 },
  ],
  // Rudersdal (Birkerød) — etagebolig (use_type 120) — market-level ~33 000 kr/m²
  '0230_120': [
    { bfe: 760001, sale_price: 4500000, sale_date: '2025-10-01', living_area_m2: 136 },
    { bfe: 760002, sale_price: 3200000, sale_date: '2025-07-01', living_area_m2:  97 },
    { bfe: 760003, sale_price: 5100000, sale_date: '2025-04-01', living_area_m2: 154 },
    { bfe: 760004, sale_price: 2750000, sale_date: '2025-01-01', living_area_m2:  84 },
    { bfe: 760005, sale_price: 4200000, sale_date: '2024-10-01', living_area_m2: 128 },
    { bfe: 760006, sale_price: 2950000, sale_date: '2024-07-01', living_area_m2:  91 },
    { bfe: 760007, sale_price: 5600000, sale_date: '2024-04-01', living_area_m2: 168 },
    { bfe: 760008, sale_price: 3500000, sale_date: '2024-01-01', living_area_m2: 107 },
    { bfe: 760009, sale_price: 3100000, sale_date: '2023-10-01', living_area_m2:  95 },
    { bfe: 760010, sale_price: 4650000, sale_date: '2023-07-01', living_area_m2: 142 },
  ],
}

function getConfig(): sql.config {
  const raw = Deno.env.get('GEO_SIF_CONN')
  if (!raw) throw new Error('GEO_SIF_CONN secret is not configured')
  const parts = Object.fromEntries(
    raw.split(';').filter(Boolean).map((s) => {
      const idx = s.indexOf('=')
      return [s.slice(0, idx).trim().toLowerCase(), s.slice(idx + 1).trim()]
    })
  )
  const [server, portStr] = (parts['server'] ?? '').split(',')
  return {
    server,
    port: portStr ? parseInt(portStr) : 1433,
    user: parts['user id'],
    password: parts['password'],
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 12000,
  }
}

function median(values: number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

async function fetchMortgageRate(): Promise<number | null> {
  try {
    const res = await fetch('https://api.statbank.dk/v1/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        table: 'DNRENTM',
        format: 'JSON',
        lang: 'en',
        variables: [
          { code: 'INSTRUMENT', values: ['OIRNAA'] },
          { code: 'Tid', values: ['*'] },
        ],
      }),
    })
    const json = await res.json()
    const rows: { INDHOLD: string }[] = json.data ?? []
    if (rows.length === 0) return null
    const latest = rows[rows.length - 1].INDHOLD
    return latest ? parseFloat(latest) : null
  } catch {
    return null
  }
}

// Primary: geographic radius search using UTM32N Euclidean distance (metres)
async function findComparablesByDistance(
  pool: sql.ConnectionPool,
  buildingUse: number,
  livingArea: number,
  subjectX: number,
  subjectY: number,
  radiusMeters: number,
  widened: boolean
): Promise<Comparable[]> {
  const areaMin = widened ? null : livingArea * 0.7
  const areaMax = widened ? null : livingArea * 1.3
  const areaClause = widened
    ? ''
    : 'AND b.byg039BygningensSamledeBoligAreal BETWEEN @areaMin AND @areaMax'

  const result = await pool.request()
    .input('buildingUse', sql.Int, buildingUse)
    .input('subjectX',   sql.Float, subjectX)
    .input('subjectY',   sql.Float, subjectY)
    .input('radiusBox',  sql.Float, radiusMeters)
    .input('radiusSq',   sql.Float, radiusMeters * radiusMeters)
    .input('areaMin',    sql.Decimal(10, 2), areaMin)
    .input('areaMax',    sql.Decimal(10, 2), areaMax)
    .query(`
      SELECT TOP 20
        ek.bestemtFastEjendomBFENr          AS bfe,
        h.kontantKøbesum                    AS sale_price,
        CONVERT(varchar(10), ek.overtagelsesdato, 23) AS sale_date,
        b.byg039BygningensSamledeBoligAreal AS living_area_m2
      FROM Stag_Datafordeler_EJF.dbo.Ejerskifte ek
      JOIN Stag_Datafordeler_EJF.dbo.Handelsoplysninger h
        ON ek.handelsoplysningerLokalId = h.id_lokalId
      JOIN Stag_Datafordeler_BBR.dbo.Ejendomsrelation er
        ON ek.bestemtFastEjendomBFENr = er.bfeNummer
      JOIN Stag_Datafordeler_BBR.dbo.BygningEjendomsrelation ber
        ON er.id_lokalId = ber.bygningPåFremmedGrund
      JOIN Stag_Datafordeler_BBR.dbo.Bygning b
        ON ber.bygning = b.id_lokalId
      WHERE ek.overdragelsesmåde            = 'Almindelig fri handel'
        AND ek.registreringTil              IS NULL
        AND ek.overtagelsesdato             >= DATEADD(year, -3, GETDATE())
        AND h.kontantKøbesum                > 0
        AND b.byg021BygningensAnvendelse    BETWEEN 110 AND 199
        AND b.byg021BygningensAnvendelse    = @buildingUse
        AND b.byg039BygningensSamledeBoligAreal > 0
        AND b.byg404Koordinat_x             IS NOT NULL
        AND b.byg404Koordinat_x             BETWEEN @subjectX - @radiusBox AND @subjectX + @radiusBox
        AND b.byg404Koordinat_y             BETWEEN @subjectY - @radiusBox AND @subjectY + @radiusBox
        AND (
          POWER(CAST(b.byg404Koordinat_x AS FLOAT) - @subjectX, 2) +
          POWER(CAST(b.byg404Koordinat_y AS FLOAT) - @subjectY, 2)
        ) <= @radiusSq
        AND EXISTS (
          SELECT 1 FROM Stag_Datafordeler_BBR.dbo.Enhed e
          WHERE e.bygning = b.id_lokalId
            AND e.registreringTil IS NULL
            AND e.enh023Boligtype = '1'
        )
        ${areaClause}
    `)

  return result.recordset
}

// Fallback for properties without BBR coordinates: municipality-scoped search
async function findComparablesByMunicipality(
  pool: sql.ConnectionPool,
  kommunekode: string,
  buildingUse: number,
  livingArea: number,
  widened: boolean
): Promise<Comparable[]> {
  const areaMin = widened ? null : livingArea * 0.7
  const areaMax = widened ? null : livingArea * 1.3
  const areaClause = widened
    ? ''
    : 'AND b.byg039BygningensSamledeBoligAreal BETWEEN @areaMin AND @areaMax'

  const result = await pool.request()
    .input('kommunekode', sql.VarChar(4), kommunekode)
    .input('buildingUse', sql.Int, buildingUse)
    .input('areaMin',     sql.Decimal(10, 2), areaMin)
    .input('areaMax',     sql.Decimal(10, 2), areaMax)
    .query(`
      SELECT TOP 20
        ek.bestemtFastEjendomBFENr          AS bfe,
        h.kontantKøbesum                    AS sale_price,
        CONVERT(varchar(10), ek.overtagelsesdato, 23) AS sale_date,
        b.byg039BygningensSamledeBoligAreal AS living_area_m2
      FROM Stag_Datafordeler_EJF.dbo.Ejerskifte ek
      JOIN Stag_Datafordeler_EJF.dbo.Handelsoplysninger h
        ON ek.handelsoplysningerLokalId = h.id_lokalId
      JOIN Stag_Datafordeler_BBR.dbo.Ejendomsrelation er
        ON ek.bestemtFastEjendomBFENr = er.bfeNummer
      JOIN Stag_Datafordeler_BBR.dbo.BygningEjendomsrelation ber
        ON er.id_lokalId = ber.bygningPåFremmedGrund
      JOIN Stag_Datafordeler_BBR.dbo.Bygning b
        ON ber.bygning = b.id_lokalId
      WHERE ek.overdragelsesmåde            = 'Almindelig fri handel'
        AND ek.registreringTil              IS NULL
        AND ek.overtagelsesdato             >= DATEADD(year, -3, GETDATE())
        AND h.kontantKøbesum                > 0
        AND b.byg021BygningensAnvendelse    BETWEEN 110 AND 199
        AND b.kommunekode                   = @kommunekode
        AND b.byg021BygningensAnvendelse    = @buildingUse
        AND b.byg039BygningensSamledeBoligAreal > 0
        AND EXISTS (
          SELECT 1 FROM Stag_Datafordeler_BBR.dbo.Enhed e
          WHERE e.bygning = b.id_lokalId
            AND e.registreringTil IS NULL
            AND e.enh023Boligtype = '1'
        )
        ${areaClause}
    `)

  return result.recordset
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  let bfe_number: number
  try {
    const body = await req.json()
    bfe_number = body?.bfe_number
  } catch {
    return new Response(JSON.stringify({ error: 'Request body must be valid JSON' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  if (!Number.isInteger(bfe_number) || bfe_number <= 0) {
    return new Response(JSON.stringify({ error: 'bfe_number must be a positive integer' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  if (Deno.env.get('MOCK_GEO_SIF') === 'true') {
    const prop = MOCK_PROPERTIES[bfe_number] ?? {
      address: `BFE ${bfe_number}`,
      living_area_m2: 130,
      build_year: 1972,
      building_use: 120,
      municipality_code: '0101',
    }
    const comparablesKey = `${prop.municipality_code}_${prop.building_use}`
    const mockComparables = MOCK_COMPARABLES[comparablesKey] ?? MOCK_COMPARABLES['0101_120']
    const pricePerM2Values = mockComparables.map((c) => c.sale_price / c.living_area_m2)
    const pricePerM2Raw = median(pricePerM2Values)
    if (isNaN(pricePerM2Raw)) {
      return new Response(JSON.stringify({ error: 'No comparable sales found for this property' }), {
        status: 422,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const pricePerM2 = Math.round(pricePerM2Raw)
    const estimatedPrice = Math.round(pricePerM2 * prop.living_area_m2)
    const mockCoordinates = (prop.lat != null && prop.lng != null)
      ? { lat: prop.lat, lng: prop.lng }
      : null
    const interestRate = await fetchMortgageRate()

    const units = prop.units?.map((u) => ({
      address: u.address,
      use_type: u.use_type,
      area_m2: u.area_m2,
      rooms: u.rooms,
      estimated_price: Math.round(pricePerM2 * u.area_m2),
    }))

    const response = {
      bfe_number,
      address: prop.address,
      estimated_price: estimatedPrice,
      price_per_m2: pricePerM2,
      living_area_m2: prop.living_area_m2,
      build_year: prop.build_year,
      building_use: prop.building_use,
      municipality_code: prop.municipality_code,
      comparable_count: mockComparables.length,
      comparables: mockComparables,
      interest_rate: interestRate,
      limited_data: mockComparables.length < 5,
      ...(mockCoordinates ? { coordinates: mockCoordinates } : {}),
      ...(units && units.length > 1 ? { units } : {}),
    }

    const { error: insertError } = await supabase.from('estimates').insert({
      user_id: user.id,
      bfe_number,
      address_text: prop.address,
      estimated_price: estimatedPrice,
      price_per_m2: pricePerM2,
      comparable_count: mockComparables.length,
      living_area_m2: prop.living_area_m2,
      build_year: prop.build_year,
      building_use: prop.building_use,
      municipality_code: prop.municipality_code,
      interest_rate: interestRate,
    })
    if (insertError) console.error('Failed to persist estimate:', insertError.message)

    return new Response(JSON.stringify({ ...response, persisted: !insertError }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  let pool: sql.ConnectionPool
  try {
    pool = await sql.connect(getConfig())
  } catch (err) {
    console.error('Failed to connect to geo-sif:', err instanceof Error ? err.message : err)
    return new Response(JSON.stringify({ error: 'Database connection failed' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
  try {
    const subjectResult = await pool.request()
      .input('bfe', sql.BigInt, bfe_number)
      .query(`
        SELECT TOP 1
          b.id_lokalId                        AS bygning_id,
          b.byg039BygningensSamledeBoligAreal AS living_area_m2,
          b.byg021BygningensAnvendelse        AS building_use,
          b.[byg026Opførelsesår]              AS build_year,
          b.kommunekode,
          b.byg404Koordinat_x                 AS coord_x,
          b.byg404Koordinat_y                 AS coord_y,
          hn.adgangsadressebetegnelse         AS address
        FROM Stag_Datafordeler_BBR.dbo.Ejendomsrelation er
        JOIN Stag_Datafordeler_BBR.dbo.BygningEjendomsrelation ber
          ON er.id_lokalId = ber.bygningPåFremmedGrund
        JOIN Stag_Datafordeler_BBR.dbo.Bygning b
          ON ber.bygning = b.id_lokalId
        LEFT JOIN Stag_Datafordeler_DAR.dbo.Husnummer hn
          ON hn.adgangTilBygning = b.id_lokalId
          AND hn.registreringTil IS NULL
        WHERE er.bfeNummer = @bfe
          AND er.registreringTil IS NULL
          AND ber.registreringTil IS NULL
          AND b.registreringTil IS NULL
          AND b.byg021BygningensAnvendelse BETWEEN 110 AND 199
          AND b.byg039BygningensSamledeBoligAreal > 0
        ORDER BY b.byg039BygningensSamledeBoligAreal DESC
      `)

    if (subjectResult.recordset.length === 0) {
      // Could be not found OR non-residential — check which
      const anyResult = await pool.request()
        .input('bfe', sql.BigInt, bfe_number)
        .query(`
          SELECT TOP 1 b.byg021BygningensAnvendelse AS building_use
          FROM Stag_Datafordeler_BBR.dbo.Ejendomsrelation er
          JOIN Stag_Datafordeler_BBR.dbo.BygningEjendomsrelation ber
            ON er.id_lokalId = ber.bygningPåFremmedGrund
          JOIN Stag_Datafordeler_BBR.dbo.Bygning b
            ON ber.bygning = b.id_lokalId
          WHERE er.bfeNummer = @bfe
            AND er.registreringTil IS NULL
            AND ber.registreringTil IS NULL
            AND b.registreringTil IS NULL
        `)
      const buildingUseCode = anyResult.recordset[0]?.building_use
      const msg = buildingUseCode != null
        ? `Not a residential property (BBR use type ${buildingUseCode})`
        : 'Property not found'
      return new Response(JSON.stringify({ error: msg }), {
        status: 404,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const subject = subjectResult.recordset[0]
    const { bygning_id, living_area_m2, building_use, build_year, kommunekode, address, coord_x, coord_y } = subject
    const coordinates = (coord_x && coord_y) ? utmToWgs84(coord_x, coord_y) : null

    let comparables: Comparable[]
    if (coord_x && coord_y) {
      // Geographic search — progressive radius widening
      comparables = await findComparablesByDistance(pool, building_use, living_area_m2, coord_x, coord_y, 5000, false)
      if (comparables.length < 5) {
        comparables = await findComparablesByDistance(pool, building_use, living_area_m2, coord_x, coord_y, 5000, true)
      }
      if (comparables.length < 5) {
        comparables = await findComparablesByDistance(pool, building_use, living_area_m2, coord_x, coord_y, 10000, true)
      }
    } else {
      // No BBR coordinates — fall back to municipality
      comparables = await findComparablesByMunicipality(pool, kommunekode, building_use, living_area_m2, false)
      if (comparables.length < 5) {
        comparables = await findComparablesByMunicipality(pool, kommunekode, building_use, living_area_m2, true)
      }
    }
    const limitedData = comparables.length < 5

    const pricePerM2Values = comparables
      .filter((c) => c.living_area_m2 > 0)
      .map((c) => c.sale_price / c.living_area_m2)

    const pricePerM2 = Math.round(median(pricePerM2Values))
    if (isNaN(pricePerM2)) {
      return new Response(JSON.stringify({ error: 'No comparable sales found for this property' }), {
        status: 422,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const estimatedPrice = Math.round(pricePerM2 * living_area_m2)
    const interestRate = await fetchMortgageRate()

    const unitsResult = await pool.request()
      .input('bygning_id', sql.NVarChar, bygning_id)
      .query(`
        SELECT
          e.enh020EnhedensAnvendelse  AS use_type,
          e.enh026EnhedensSamledeAreal AS area_m2,
          e.enh031AntalVærelser       AS rooms,
          hn.adgangsadressebetegnelse AS address
        FROM Stag_Datafordeler_BBR.dbo.Enhed e
        LEFT JOIN Stag_Datafordeler_DAR.dbo.Husnummer hn
          ON e.adresseIdentificerer = hn.id_lokalId
          AND hn.registreringTil IS NULL
        WHERE e.bygning = @bygning_id
          AND e.registreringTil IS NULL
          AND e.enh020EnhedensAnvendelse BETWEEN 110 AND 199
          AND e.enh026EnhedensSamledeAreal > 0
        ORDER BY e.enh026EnhedensSamledeAreal DESC
      `)

    const units = unitsResult.recordset.length > 1
      ? unitsResult.recordset.map((u: { use_type: number; area_m2: number; rooms: number; address: string | null }) => ({
          address: u.address ?? '',
          use_type: u.use_type,
          area_m2: u.area_m2,
          rooms: u.rooms,
          estimated_price: Math.round(pricePerM2 * u.area_m2),
        }))
      : undefined

    const response = {
      bfe_number,
      address: address ?? `BFE ${bfe_number}`,
      estimated_price: estimatedPrice,
      price_per_m2: pricePerM2,
      living_area_m2,
      build_year,
      building_use,
      municipality_code: kommunekode,
      comparable_count: comparables.length,
      comparables: comparables.slice(0, 10),
      interest_rate: interestRate,
      limited_data: limitedData,
      ...(coordinates ? { coordinates } : {}),
      ...(units ? { units } : {}),
    }

    const { error: insertError } = await supabase.from('estimates').insert({
      user_id: user.id,
      bfe_number,
      address_text: response.address,
      estimated_price: estimatedPrice,
      price_per_m2: pricePerM2,
      comparable_count: comparables.length,
      living_area_m2,
      build_year,
      building_use,
      municipality_code: kommunekode,
      interest_rate: interestRate,
    })
    if (insertError) console.error('Failed to persist estimate:', insertError.message)

    return new Response(JSON.stringify({ ...response, persisted: !insertError }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } finally {
    pool.close()
  }
})
