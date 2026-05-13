import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import sql from 'npm:mssql'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MOCK_ADDRESSES = [
  { bfe_number: 100654163, display: 'Rådhuspladsen 7, 1550 København V' },
  { bfe_number: 100442001, display: 'Østerbrogade 42, 2100 København Ø' },
  { bfe_number: 100442002, display: 'Nørrebrogade 18, 2200 København N' },
  { bfe_number: 100442003, display: 'Vesterbrogade 55, 1620 København V' },
  { bfe_number: 200103001, display: 'Aarhus Allé 12, 8000 Aarhus C' },
  { bfe_number: 200103002, display: 'Åboulevarden 27, 8000 Aarhus C' },
  { bfe_number: 300201001, display: 'Kongensgade 8, 5000 Odense C' },
  { bfe_number: 400301001, display: 'Algade 33, 9000 Aalborg' },
  { bfe_number: 500401001, display: 'Skomagergade 14, 4000 Roskilde' },
  { bfe_number: 600501001, display: 'Skolegade 5, 7100 Vejle' },
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const q = new URL(req.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 3) {
    return new Response(JSON.stringify([]), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  if (Deno.env.get('MOCK_GEO_SIF') === 'true') {
    const lower = q.toLowerCase()
    const results = MOCK_ADDRESSES.filter((a) =>
      a.display.toLowerCase().includes(lower)
    ).slice(0, 10)
    return new Response(JSON.stringify(results), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const pool = await sql.connect(getConfig())
  try {
    const result = await pool.request()
      .input('q', sql.NVarChar, `%${q}%`)
      .query(`
        SELECT TOP 10
          er.bfeNummer,
          hn.adgangsadressebetegnelse AS display
        FROM Stag_Datafordeler_DAR.dbo.Husnummer hn
        JOIN Stag_Datafordeler_BBR.dbo.Bygning b
          ON hn.adgangTilBygning = b.id_lokalId
        JOIN Stag_Datafordeler_BBR.dbo.BygningEjendomsrelation ber
          ON b.id_lokalId = ber.bygning
        JOIN Stag_Datafordeler_BBR.dbo.Ejendomsrelation er
          ON ber.bygningPåFremmedGrund = er.id_lokalId
        WHERE hn.registreringTil IS NULL
          AND b.registreringTil IS NULL
          AND ber.registreringTil IS NULL
          AND er.registreringTil IS NULL
          AND er.bfeNummer IS NOT NULL
          AND hn.adgangsadressebetegnelse LIKE @q
      `)

    const rows = result.recordset.map((r: { bfeNummer: number; display: string }) => ({
      bfe_number: r.bfeNummer,
      display: r.display,
    }))

    return new Response(JSON.stringify(rows), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } finally {
    pool.close()
  }
})
