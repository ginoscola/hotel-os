import { useState, useEffect, useCallback } from 'react'
import api from '../api/client.js'

const RUOLI = ['admin', 'viewer']

const stileRuolo = {
  admin: { background: '#dbeafe', color: '#1d4ed8', fontWeight: 600 },
  viewer: { background: '#d1fae5', color: '#065f46', fontWeight: 600 },
}

const stileAttivo = {
  true:  { background: '#d1fae5', color: '#065f46' },
  false: { background: '#fee2e2', color: '#991b1b' },
}

export default function AdminUtenti() {
  const [utenti, setUtenti] = useState([])
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState(null)

  // Stato form nuovo utente
  const [mostraForm, setMostraForm] = useState(false)
  const [form, setForm] = useState({ username: '', email: '', password: '', ruolo: 'viewer' })
  const [salvando, setSalvando] = useState(false)
  const [esitoForm, setEsitoForm] = useState(null)

  // Reset password
  const [resetId, setResetId] = useState(null)
  const [nuovaPassword, setNuovaPassword] = useState('')
  const [salvandoReset, setSalvandoReset] = useState(false)
  const [esitoReset, setEsitoReset] = useState({})

  // Feedback per disattivazione
  const [esitoAzione, setEsitoAzione] = useState({})

  const caricaUtenti = useCallback(async () => {
    try {
      setLoading(true)
      const { data } = await api.get('/admin/utenti')
      setUtenti(data)
      setErrore(null)
    } catch (err) {
      setErrore(err.response?.data?.detail || err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { caricaUtenti() }, [caricaUtenti])

  // ---- Crea utente ----
  async function handleCreaUtente(e) {
    e.preventDefault()
    setSalvando(true)
    setEsitoForm(null)
    try {
      await api.post('/admin/utenti', form)
      setEsitoForm({ ok: true, msg: `Utente "${form.username}" creato con successo.` })
      setForm({ username: '', email: '', password: '', ruolo: 'viewer' })
      setMostraForm(false)
      await caricaUtenti()
    } catch (err) {
      const msg = err.response?.data?.detail || err.message
      setEsitoForm({ ok: false, msg: typeof msg === 'string' ? msg : JSON.stringify(msg) })
    } finally {
      setSalvando(false)
    }
  }

  // ---- Disattiva / riattiva ----
  async function toggleAttivo(utente) {
    const nuovoStato = !utente.attivo
    try {
      await api.put(`/admin/utenti/${utente.id}`, { attivo: nuovoStato })
      setEsitoAzione(prev => ({
        ...prev,
        [utente.id]: { ok: true, msg: nuovoStato ? 'Riattivato' : 'Disattivato' },
      }))
      await caricaUtenti()
    } catch (err) {
      const msg = err.response?.data?.detail || err.message
      setEsitoAzione(prev => ({
        ...prev,
        [utente.id]: { ok: false, msg: typeof msg === 'string' ? msg : JSON.stringify(msg) },
      }))
    }
  }

  // ---- Cambio ruolo ----
  async function cambiaRuolo(utente, nuovoRuolo) {
    try {
      await api.put(`/admin/utenti/${utente.id}`, { ruolo: nuovoRuolo })
      await caricaUtenti()
    } catch (err) {
      const msg = err.response?.data?.detail || err.message
      setEsitoAzione(prev => ({
        ...prev,
        [utente.id]: { ok: false, msg: typeof msg === 'string' ? msg : JSON.stringify(msg) },
      }))
    }
  }

  // ---- Reset password ----
  async function handleResetPassword(userId) {
    if (!nuovaPassword || nuovaPassword.length < 6) {
      setEsitoReset(prev => ({ ...prev, [userId]: { ok: false, msg: 'Password minimo 6 caratteri' } }))
      return
    }
    setSalvandoReset(true)
    try {
      await api.post(`/admin/utenti/${userId}/reset-password`, { password: nuovaPassword })
      setEsitoReset(prev => ({ ...prev, [userId]: { ok: true, msg: 'Password aggiornata' } }))
      setResetId(null)
      setNuovaPassword('')
    } catch (err) {
      const msg = err.response?.data?.detail || err.message
      setEsitoReset(prev => ({ ...prev, [userId]: { ok: false, msg: typeof msg === 'string' ? msg : JSON.stringify(msg) } }))
    } finally {
      setSalvandoReset(false)
    }
  }

  const inputStyle = {
    padding: '7px 10px',
    fontSize: 13,
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0 }}>Gestione Utenti</h2>
        <button
          onClick={() => { setMostraForm(v => !v); setEsitoForm(null) }}
          style={{
            background: '#3b82f6', color: '#fff', border: 'none',
            padding: '8px 18px', borderRadius: 6, fontSize: 14,
            fontWeight: 600, cursor: 'pointer',
          }}
        >
          {mostraForm ? '✕ Annulla' : '+ Nuovo utente'}
        </button>
      </div>

      {/* Form nuovo utente */}
      {mostraForm && (
        <div className="card" style={{ marginBottom: '1.5rem', border: '1px solid #bfdbfe', background: '#eff6ff' }}>
          <h3 style={{ marginTop: 0, color: '#1e40af' }}>Nuovo utente</h3>
          <form onSubmit={handleCreaUtente}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 3 }}>Username *</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  required
                  maxLength={50}
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 3 }}>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 3 }}>Password * (min 6)</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  required
                  minLength={6}
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 3 }}>Ruolo *</label>
                <select
                  value={form.ruolo}
                  onChange={e => setForm(f => ({ ...f, ruolo: e.target.value }))}
                  style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                >
                  {RUOLI.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>

            {esitoForm && (
              <div style={{
                padding: '8px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600, marginBottom: 12,
                background: esitoForm.ok ? '#d1fae5' : '#fee2e2',
                color: esitoForm.ok ? '#065f46' : '#991b1b',
              }}>
                {esitoForm.msg}
              </div>
            )}

            <button
              type="submit"
              disabled={salvando}
              style={{
                background: '#3b82f6', color: '#fff', border: 'none',
                padding: '8px 20px', borderRadius: 6, fontSize: 13,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              {salvando ? 'Creazione…' : 'Crea utente'}
            </button>
          </form>
        </div>
      )}

      {/* Feedback globale dopo creazione */}
      {!mostraForm && esitoForm?.ok && (
        <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600, marginBottom: 12, background: '#d1fae5', color: '#065f46' }}>
          {esitoForm.msg}
        </div>
      )}

      {/* Tabella utenti */}
      <div className="card">
        {loading ? (
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Caricamento utenti…</p>
        ) : errore ? (
          <p style={{ color: '#dc2626', fontSize: 13 }}>Errore: {errore}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Username</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600 }}>Email</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Ruolo</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Stato</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Creato il</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Ultimo accesso</th>
                  <th style={{ padding: '8px 12px' }}></th>
                </tr>
              </thead>
              <tbody>
                {utenti.map(u => (
                  <tr key={u.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{u.username}</td>
                    <td style={{ padding: '8px 12px', color: '#6b7280' }}>{u.email || '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <select
                        value={u.ruolo}
                        onChange={e => cambiaRuolo(u, e.target.value)}
                        style={{
                          ...inputStyle,
                          ...stileRuolo[u.ruolo],
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: 12,
                          padding: '3px 8px',
                          borderRadius: 20,
                        }}
                      >
                        {RUOLI.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <span style={{
                        fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 600,
                        ...stileAttivo[String(u.attivo)],
                      }}>
                        {u.attivo ? 'Attivo' : 'Disattivo'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 12 }}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('it-IT') : '—'}
                    </td>
                    <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 12 }}>
                      {u.last_login ? new Date(u.last_login).toLocaleString('it-IT') : 'Mai'}
                    </td>
                    <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                      {/* Reset password inline */}
                      {resetId === u.id ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="password"
                            placeholder="Nuova password"
                            value={nuovaPassword}
                            onChange={e => setNuovaPassword(e.target.value)}
                            minLength={6}
                            style={{ ...inputStyle, width: 130, fontSize: 12 }}
                          />
                          <button
                            onClick={() => handleResetPassword(u.id)}
                            disabled={salvandoReset}
                            style={{ background: '#f59e0b', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                          >
                            {salvandoReset ? '…' : 'Salva'}
                          </button>
                          <button
                            onClick={() => { setResetId(null); setNuovaPassword(''); setEsitoReset(prev => ({ ...prev, [u.id]: null })) }}
                            style={{ background: '#e5e7eb', color: '#374151', border: 'none', padding: '4px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <button
                            onClick={() => { setResetId(u.id); setNuovaPassword(''); setEsitoReset(prev => ({ ...prev, [u.id]: null })) }}
                            style={{ background: '#f59e0b', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                          >
                            Reset pwd
                          </button>
                          <button
                            onClick={() => toggleAttivo(u)}
                            style={{
                              background: u.attivo ? '#fee2e2' : '#d1fae5',
                              color: u.attivo ? '#991b1b' : '#065f46',
                              border: 'none',
                              padding: '4px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600,
                            }}
                          >
                            {u.attivo ? 'Disattiva' : 'Riattiva'}
                          </button>
                        </div>
                      )}
                      {/* Feedback azione */}
                      {(esitoAzione[u.id] || esitoReset[u.id]) && (() => {
                        const feedback = esitoReset[u.id] || esitoAzione[u.id]
                        return (
                          <div style={{ fontSize: 11, fontWeight: 600, marginTop: 3, color: feedback.ok ? '#059669' : '#dc2626' }}>
                            {feedback.msg}
                          </div>
                        )
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
