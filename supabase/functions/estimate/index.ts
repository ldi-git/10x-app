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
}

const MOCK_COMPARABLES = [
  { bfe: 100399001, address: 'Nabovej 4',        sale_price: 3100000, sale_date: '2025-03-12', living_area_m2: 138 },
  { bfe: 100399002, address: 'Sidegaden 7',       sale_price: 3400000, sale_date: '2025-01-08', living_area_m2: 151 },
  { bfe: 100399003, address: 'Parkstræde 11',     sale_price: 2950000, sale_date: '2024-11-22', living_area_m2: 129 },
  { bfe: 100399004, address: 'Bakkevej 3',        sale_price: 3650000, sale_date: '2024-09-15', living_area_m2: 162 },
  { bfe: 100399005, address: 'Engvej 19',         sale_price: 3200000, sale_date: '2024-07-30', living_area_m2: 141 },
  { bfe: 100399006, address: 'Lindegårdsvej 2',   sale_price: 2875000, sale_date: '2024-06-11', living_area_m2: 127 },
  { bfe: 100399007, address: 'Rosenvænget 8',     sale_price: 3550000, sale_date: '2024-04-05', living_area_m2: 156 },
  { bfe: 100399008, address: 'Møllevej 14',       sale_price: 3025000, sale_date: '2024-02-18', living_area_m2: 133 },
  { bfe: 100399009, address: 'Solbakken 6',       sale_price: 3350000, sale_date: '2023-12-03', living_area_m2: 148 },
  { bfe: 100399010, address: 'Skovvænget 22',     sale_price: 2800000, sale_date: '2023-10-14', living_area_m2: 124 },
]

function getConfig(): sql.config {
  const raw = Deno.env.get('GEO_SIF_CONN')!
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
  if (values.length === 0) return 0
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

type Comparable = { bfe: number; sale_price: number; sale_date: string; living_area_m2: number; address?: string }

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

  const { bfe_number } = await req.json()
  if (!bfe_number) {
    return new Response(JSON.stringify({ error: 'bfe_number required' }), {
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
    const pricePerM2Values = MOCK_COMPARABLES.map((c) => c.sale_price / c.living_area_m2)
    const pricePerM2 = Math.round(median(pricePerM2Values))
    const estimatedPrice = Math.round(pricePerM2 * prop.living_area_m2)
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
      comparable_count: MOCK_COMPARABLES.length,
      comparables: MOCK_COMPARABLES,
      interest_rate: interestRate,
      limited_data: false,
      coordinates: { lat: prop.lat, lng: prop.lng },
      ...(units && units.length > 1 ? { units } : {}),
    }

    const { error: insertError } = await supabase.from('estimates').insert({
      user_id: user.id,
      bfe_number,
      address_text: prop.address,
      estimated_price: estimatedPrice,
      price_per_m2: pricePerM2,
      comparable_count: MOCK_COMPARABLES.length,
      living_area_m2: prop.living_area_m2,
      build_year: prop.build_year,
      building_use: prop.building_use,
      municipality_code: prop.municipality_code,
      interest_rate: interestRate,
    })
    if (insertError) console.error('Failed to persist estimate:', insertError.message)

    return new Response(JSON.stringify(response), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const pool = await sql.connect(getConfig())
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

    const pricePerM2 = median(pricePerM2Values)
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
      price_per_m2: Math.round(pricePerM2),
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
      price_per_m2: Math.round(pricePerM2),
      comparable_count: comparables.length,
      living_area_m2,
      build_year,
      building_use,
      municipality_code: kommunekode,
      interest_rate: interestRate,
    })
    if (insertError) console.error('Failed to persist estimate:', insertError.message)

    return new Response(JSON.stringify(response), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } finally {
    pool.close()
  }
})
