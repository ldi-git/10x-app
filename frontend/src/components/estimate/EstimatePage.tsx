import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../supabaseClient'
import AddressSearch from './AddressSearch'
import EstimateCard, { type EstimateResult } from './EstimateCard'
import EstimateHistory from './EstimateHistory'

export default function EstimatePage({ session }: { session: Session }) {
  const [selectedBfe, setSelectedBfe] = useState<number | null>(null)
  const [result, setResult] = useState<EstimateResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyKey, setHistoryKey] = useState(0)

  async function runEstimate() {
    if (!selectedBfe) return
    setLoading(true)
    setError(null)
    setResult(null)

    const { data: { session: s } } = await supabase.auth.getSession()
    const token = s?.access_token
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/estimate`

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ bfe_number: selectedBfe }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }

      const data: EstimateResult = await res.json()
      setResult(data)
      setHistoryKey((k) => k + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Estimate failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="estimate-page">
      <h2>House Price Estimator</h2>

      <div className="estimate-form">
        <AddressSearch
          onSelect={(bfe) => setSelectedBfe(bfe)}
          disabled={loading}
        />
        <button
          className="estimate-btn"
          onClick={runEstimate}
          disabled={!selectedBfe || loading}
        >
          {loading ? 'Estimating...' : 'Estimate'}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {result && <EstimateCard result={result} />}

      <EstimateHistory key={historyKey} session={session} />
    </div>
  )
}
