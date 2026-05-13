import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import Auth from './components/Auth'
import Dashboard from './components/Dashboard'
import EstimatePage from './components/estimate/EstimatePage'
import './App.css'

type View = 'dashboard' | 'estimate'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('dashboard')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <div className="loading">Loading...</div>

  return (
    <div className="app">
      <header>
        <h1>Geomatic</h1>
        {session && (
          <nav className="header-nav">
            <button
              className={`nav-btn${view === 'dashboard' ? ' active' : ''}`}
              onClick={() => setView('dashboard')}
            >
              Notes
            </button>
            <button
              className={`nav-btn${view === 'estimate' ? ' active' : ''}`}
              onClick={() => setView('estimate')}
            >
              Price Estimator
            </button>
            <button onClick={() => supabase.auth.signOut()} className="sign-out">
              Sign out
            </button>
          </nav>
        )}
      </header>
      <main>
        {!session && <Auth />}
        {session && view === 'dashboard' && <Dashboard session={session} />}
        {session && view === 'estimate' && <EstimatePage session={session} />}
      </main>
    </div>
  )
}
