import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import sql from 'npm:mssql'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getConfig(): sql.config {
  const raw = Deno.env.get('GEO_SIF_CONN')!
  // Expected format: Server=host,port;User Id=u;Password=p;TrustServerCertificate=True
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
