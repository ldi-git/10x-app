import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import sql from 'npm:mssql'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
    // Response shape: { columns: [...], data: [{ INSTRUMENT, Tid, INDHOLD }] }
    const rows: { INDHOLD: string }[] = json.data ?? []
    if (rows.length === 0) return null
    // Last entry is the most recent period
    const latest = rows[rows.length - 1].INDHOLD
    return latest ? parseFloat(latest) : null
  } catch {
    return null
  }
}

async function findComparables(
  pool: sql.ConnectionPool,
  kommunekode: string,
  buildingUse: number,
  livingArea: number,
  widened = false
): Promise<{ bfe: number; sale_price: number; sale_date: string; living_area_m2: number; address?: string }[]> {
  const areaMin = widened ? null : livingArea * 0.7
  const areaMax = widened ? null : livingArea * 1.3

  const req = pool.request()
    .input('kommunekode', sql.VarChar(4), kommunekode)
    .input('buildingUse', sql.Int, buildingUse)
    .input('areaMin', sql.Decimal(10, 2), areaMin)
    .input('areaMax', sql.Decimal(10, 2), areaMax)

  const areaClause = widened
    ? ''
    : 'AND b.byg039BygningensSamledeBoligAreal BETWEEN @areaMin AND @areaMax'

  const result = await req.query(`
    SELECT TOP 20
      ek.bestemtFastEjendomBFENr       AS bfe,
      h.kontantKøbesum                 AS sale_price,
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
    WHERE ek.overdragelsesmåde        = 'Almindelig fri handel'
      AND ek.registreringTil          IS NULL
      AND ek.overtagelsesdato         >= DATEADD(year, -3, GETDATE())
      AND h.kontantKøbesum            > 0
      AND b.kommunekode               = @kommunekode
      AND b.byg021BygningensAnvendelse = @buildingUse
      AND b.byg039BygningensSamledeBoligAreal > 0
      ${areaClause}
  `)

  return result.recordset
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Auth check
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

  const pool = await sql.connect(getConfig())
  try {
    // Step A: subject property features
    const subjectResult = await pool.request()
      .input('bfe', sql.BigInt, bfe_number)
      .query(`
        SELECT TOP 1
          b.byg039BygningensSamledeBoligAreal AS living_area_m2,
          b.byg021BygningensAnvendelse        AS building_use,
          b.[byg026Opførelsesår]         AS build_year,
          b.kommunekode,
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
          AND b.byg039BygningensSamledeBoligAreal > 0
        ORDER BY b.byg039BygningensSamledeBoligAreal DESC
      `)

    if (subjectResult.recordset.length === 0) {
      return new Response(JSON.stringify({ error: 'Property not found' }), {
        status: 404,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const subject = subjectResult.recordset[0]
    const { living_area_m2, building_use, build_year, kommunekode, address } = subject

    // Step B: comparables with fallback
    let comparables = await findComparables(pool, kommunekode, building_use, living_area_m2)
    let limitedData = false

    if (comparables.length < 5) {
      // Widen: drop area constraint
      comparables = await findComparables(pool, kommunekode, building_use, living_area_m2, true)
      limitedData = comparables.length < 5
    }

    // Step C: median price/m²
    const pricePerM2Values = comparables
      .filter((c) => c.living_area_m2 > 0)
      .map((c) => c.sale_price / c.living_area_m2)

    const pricePerM2 = median(pricePerM2Values)
    const estimatedPrice = Math.round(pricePerM2 * living_area_m2)

    // Step D: mortgage rate (non-blocking)
    const interestRate = await fetchMortgageRate()

    const response = {
      bfe_number,
      address: address ?? `BFE ${bfe_number}`,
      estimated_price: estimatedPrice,
      price_per_m2: Math.round(pricePerM2),
      living_area_m2,
      build_year: build_year,
      building_use,
      municipality_code: kommunekode,
      comparable_count: comparables.length,
      comparables: comparables.slice(0, 10),
      interest_rate: interestRate,
      limited_data: limitedData,
    }

    // Save to history
    await supabase.from('estimates').insert({
      user_id: user.id,
      bfe_number,
      address_text: response.address,
      estimated_price: estimatedPrice,
      price_per_m2: Math.round(pricePerM2),
      comparable_count: comparables.length,
      living_area_m2,
      build_year: build_year,
      building_use,
      municipality_code: kommunekode,
      interest_rate: interestRate,
    })

    return new Response(JSON.stringify(response), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } finally {
    pool.close()
  }
})
