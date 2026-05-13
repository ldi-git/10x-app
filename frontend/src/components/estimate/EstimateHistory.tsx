import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../supabaseClient'

interface HistoryRow {
  id: string
  bfe_number: number
  address_text: string
  estimated_price: number
  created_at: string
}

function fmt(n: number) {
  return new Intl.NumberFormat('da-DK').format(Math.round(n))
}

export default function EstimateHistory({ session }: { session: Session }) {
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('estimates')
      .select('id, bfe_number, address_text, estimated_price, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setRows(data)
        setLoading(false)
      })
  }, [session.user.id])

  async function deleteRow(id: string) {
    await supabase.from('estimates').delete().eq('id', id)
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  if (loading) return <p>Loading history...</p>
  if (rows.length === 0) return <p className="empty">No saved estimates yet.</p>

  return (
    <div className="estimate-history">
      <h3>My estimate history</h3>
      <ul className="history-list">
        {rows.map((r) => (
          <li key={r.id} className="history-row">
            <div className="history-info">
              <span className="history-address">{r.address_text}</span>
              <span className="history-price">{fmt(r.estimated_price)} kr</span>
              <span className="history-date">
                {new Date(r.created_at).toLocaleDateString('da-DK')}
              </span>
            </div>
            <button className="delete-btn" onClick={() => deleteRow(r.id)}>×</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
