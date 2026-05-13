import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'

interface Note {
  id: string
  title: string
  body: string | null
  created_at: string
}

export default function Dashboard({ session }: { session: Session }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchNotes()
  }, [])

  async function fetchNotes() {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error && data) setNotes(data)
    setLoading(false)
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    const { data, error } = await supabase
      .from('notes')
      .insert({ title, body, user_id: session.user.id })
      .select()
      .single()

    if (!error && data) {
      setNotes([data, ...notes])
      setTitle('')
      setBody('')
    }
  }

  async function deleteNote(id: string) {
    await supabase.from('notes').delete().eq('id', id)
    setNotes(notes.filter(n => n.id !== id))
  }

  return (
    <div className="dashboard">
      <p className="welcome">Signed in as <strong>{session.user.email}</strong></p>

      <form className="note-form" onSubmit={addNote}>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Note title"
          required
        />
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Note body (optional)"
          rows={3}
        />
        <button type="submit">Add note</button>
      </form>

      {loading ? (
        <p>Loading notes...</p>
      ) : notes.length === 0 ? (
        <p className="empty">No notes yet. Add one above.</p>
      ) : (
        <ul className="notes-list">
          {notes.map(note => (
            <li key={note.id} className="note-card">
              <div className="note-content">
                <h3>{note.title}</h3>
                {note.body && <p>{note.body}</p>}
                <time>{new Date(note.created_at).toLocaleDateString()}</time>
              </div>
              <button className="delete-btn" onClick={() => deleteNote(note.id)}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
