import { useState, useEffect, useCallback } from 'react'
import api from '../api/client.js'
import { mostraErrore } from '../utils/format.js'

const RUOLI = ['admin', 'viewer']

const stileRuolo = {
  admin:  { background: '#dbeafe', color: '#1d4ed8', fontWeight: 600 },
  viewer: { background: '#d1fae5', color: '#065f46', fontWeight: 600 },
}

const stileAttivo = {
  true:  { background: '#d1fae5', color: '#065f46' },
  false: { background: '#fee2e2', color: '#991b1b' },
}

const inputStyle = {
  padding: '7px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

const btnStyle = (bg, color) => ({
  background: bg, color, border: 'none',
  padding: '4px 10px', borderRadius: 4,
  fontSize: 11, cursor: 'pointer', fontWeight: 600,
  whiteSpace: 'nowrap',
})

export default function AdminUtenti() {
  const [utenti, setUtenti]     = useState([])
  const [loading, setLoading]   = useState(true)
  const [errore, setErrore]     = useState(null)

  // Form nuovo utente
  const [mostraForm, setMostraForm] = useState(false)
  const [form, setForm]             = useState({ username: '', email: '', password: '', ruolo: 'viewer' })
  const [salvando, setSalvando]     = useState(false)
  const [esitoForm, setEsitoForm]   = useState(null)

  // Reset password
  const [resetId, setResetId]           = useState(null)
  const [nuovaPassword, setNuovaPassword] = useState('')
  const [salvandoReset, setSalvandoReset] = useState(false)
  const [esitoReset, setEsitoReset]     = useState({})

  // Feedback per azioni riga
  const [esitoAzione, setEsitoAzione] = useState({})

  // Modal modifica
  const [editUtente, setEditUtente]   = useState(null)
  const [editForm, setEditForm]       = useState({})
  const [salvandoEdit, setSalvandoEdit] = useState(false)
  const [esitoEdit, setEsitoEdit]     = useState(null)

  // Modal permessi
  const [permUtente, setPermUtente]   = useState(null)   // utente di cui si gestiscono i permessi
  const [permModuli, setPermModuli]   = useState([])     // [{module_code, module_name, module_icon, puo_vedere, default_vedere}]
  const [caricandoPerm, setCaricandoPerm] = useState(false)
  const [salvandoPerm, setSalvandoPerm]   = useState(false)
  const [esitoPerm, setEsitoPerm]         = useState(null)

  const caricaUtenti = useCallback(async () => {
    try {
      setLoading(true)
      const { data } = await api.get('/admin/utenti')
      setUtenti(data)
      setErrore(null)
    } catch (err) {
      setErrore(mostraErrore(err))
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
      setEsitoForm({ ok: false, msg: mostraErrore(err) })
    } finally {
      setSalvando(false)
    }
  }

  // ---- Disattiva / riattiva ----
  async function toggleAttivo(utente) {
    try {
      await api.put(`/admin/utenti/${utente.id}`, { attivo: !utente.attivo })
      setEsitoAzione(prev => ({ ...prev, [utente.id]: { ok: true, msg: utente.attivo ? 'Disattivato' : 'Riattivato' } }))
      await caricaUtenti()
    } catch (err) {
      setEsitoAzione(prev => ({ ...prev, [utente.id]: { ok: false, msg: mostraErrore(err) } }))
    }
  }

  // ---- Cambio ruolo inline ----
  async function cambiaRuolo(utente, nuovoRuolo) {
    try {
      await api.put(`/admin/utenti/${utente.id}`, { ruolo: nuovoRuolo })
      await caricaUtenti()
    } catch (err) {
      setEsitoAzione(prev => ({ ...prev, [utente.id]: { ok: false, msg: mostraErrore(err) } }))
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
      setEsitoReset(prev => ({ ...prev, [userId]: { ok: false, msg: mostraErrore(err) } }))
    } finally {
      setSalvandoReset(false)
    }
  }

  // ---- Apri modal permessi ----
  async function apriPermessi(u) {
    setPermUtente(u)
    setPermModuli([])
    setEsitoPerm(null)
    setCaricandoPerm(true)
    try {
      const { data } = await api.get(`/admin/utenti/${u.id}/permessi`)
      setPermModuli(data)
    } catch (err) {
      setEsitoPerm({ ok: false, msg: mostraErrore(err, 'Errore caricamento permessi') })
    } finally {
      setCaricandoPerm(false)
    }
  }

  function togglePerm(code) {
    setPermModuli(prev => prev.map(m => m.module_code === code ? { ...m, puo_vedere: !m.puo_vedere } : m))
    setEsitoPerm(null)
  }

  async function salvaPerm() {
    setSalvandoPerm(true); setEsitoPerm(null)
    try {
      await api.put(`/admin/utenti/${permUtente.id}/permessi`,
        permModuli.map(m => ({ module_code: m.module_code, puo_vedere: m.puo_vedere }))
      )
      setEsitoPerm({ ok: true, msg: 'Permessi salvati' })
    } catch (err) {
      setEsitoPerm({ ok: false, msg: mostraErrore(err, 'Errore nel salvataggio') })
    } finally {
      setSalvandoPerm(false) }
  }

  // ---- Apri modal modifica ----
  function apriModifica(u) {
    setEditUtente(u)
    setEditForm({ username: u.username, email: u.email || '', ruolo: u.ruolo })
    setEsitoEdit(null)
  }

  // ---- Salva modifica ----
  async function handleSalvaModifica(e) {
    e.preventDefault()
    setSalvandoEdit(true)
    setEsitoEdit(null)
    try {
      await api.put(`/admin/utenti/${editUtente.id}`, {
        username: editForm.username,
        email: editForm.email || null,
        ruolo: editForm.ruolo,
      })
      setEsitoEdit({ ok: true, msg: 'Modifiche salvate' })
      await caricaUtenti()
      setTimeout(() => setEditUtente(null), 800)
    } catch (err) {
      setEsitoEdit({ ok: false, msg: mostraErrore(err) })
    } finally {
      setSalvandoEdit(false)
    }
  }

  // ---- Elimina utente ----
  async function handleElimina(u) {
    if (!confirm(`Eliminare definitivamente l'utente "${u.username}"?\nQuesta operazione non è reversibile.`)) return
    try {
      await api.delete(`/admin/utenti/${u.id}`)
      setEsitoAzione(prev => ({ ...prev, [u.id]: { ok: true, msg: 'Eliminato' } }))
      await caricaUtenti()
    } catch (err) {
      setEsitoAzione(prev => ({ ...prev, [u.id]: { ok: false, msg: mostraErrore(err) } }))
    }
  }

  return (
    <div>
      {/* ── Modal modifica ── */}
      {editUtente && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 10, padding: '28px 32px',
            width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          }}>
            <h3 style={{ margin: '0 0 20px', fontSize: 16, color: '#1e3a5f' }}>
              Modifica utente — {editUtente.username}
            </h3>
            <form onSubmit={handleSalvaModifica}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Username *</label>
                  <input
                    type="text"
                    value={editForm.username}
                    onChange={e => setEditForm(f => ({ ...f, username: e.target.value }))}
                    required maxLength={50}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Email</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Ruolo *</label>
                  <select
                    value={editForm.ruolo}
                    onChange={e => setEditForm(f => ({ ...f, ruolo: e.target.value }))}
                    style={inputStyle}
                  >
                    {RUOLI.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>

              {esitoEdit && (
                <div style={{
                  marginTop: 14, padding: '7px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                  background: esitoEdit.ok ? '#d1fae5' : '#fee2e2',
                  color: esitoEdit.ok ? '#065f46' : '#991b1b',
                }}>
                  {esitoEdit.msg}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setEditUtente(null)}
                  style={{ ...btnStyle('#e5e7eb', '#374151'), padding: '7px 18px', fontSize: 13 }}
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={salvandoEdit}
                  style={{ ...btnStyle('#3b82f6', '#fff'), padding: '7px 18px', fontSize: 13 }}
                >
                  {salvandoEdit ? 'Salvataggio…' : 'Salva modifiche'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal permessi moduli ── */}
      {permUtente && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 10, padding: '28px 32px',
            width: 460, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 16, color: '#1e3a5f' }}>
              Permessi moduli — {permUtente.username}
            </h3>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: '#6b7280' }}>
              Seleziona i moduli visibili per questo utente. Le modifiche sovrascrivono i permessi di ruolo solo dove diversi.
            </p>

            {caricandoPerm ? (
              <p style={{ color: '#9ca3af', fontSize: 13 }}>Caricamento…</p>
            ) : (
              <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {permModuli.map(m => {
                  const isOverride = m.puo_vedere !== m.default_vedere
                  return (
                    <label key={m.module_code} style={{
                      display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                      padding: '10px 14px', borderRadius: 8,
                      background: isOverride ? '#eff6ff' : '#f8fafc',
                      border: `1px solid ${isOverride ? '#bfdbfe' : '#e2e8f0'}`,
                    }}>
                      <input
                        type="checkbox"
                        checked={m.puo_vedere}
                        onChange={() => togglePerm(m.module_code)}
                        style={{ width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: 18, lineHeight: 1 }}>{m.module_icon}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', flex: 1 }}>{m.module_name}</span>
                      {isOverride && (
                        <span style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, background: '#dbeafe', padding: '2px 8px', borderRadius: 10 }}>
                          override
                        </span>
                      )}
                      {!isOverride && (
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>default ruolo</span>
                      )}
                    </label>
                  )
                })}
              </div>
            )}

            {esitoPerm && (
              <div style={{
                padding: '7px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600, marginBottom: 14,
                background: esitoPerm.ok ? '#d1fae5' : '#fee2e2',
                color: esitoPerm.ok ? '#065f46' : '#991b1b',
              }}>
                {esitoPerm.msg}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setPermUtente(null)}
                style={{ ...btnStyle('#e5e7eb', '#374151'), padding: '7px 18px', fontSize: 13 }}>
                Chiudi
              </button>
              <button onClick={salvaPerm} disabled={salvandoPerm || caricandoPerm}
                style={{ ...btnStyle('#3b82f6', '#fff'), padding: '7px 18px', fontSize: 13 }}>
                {salvandoPerm ? 'Salvataggio…' : 'Salva permessi'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                <input type="text" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  required maxLength={50} style={{ ...inputStyle }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 3 }}>Email</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  style={{ ...inputStyle }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 3 }}>Password * (min 6)</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  required minLength={6} style={{ ...inputStyle }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 3 }}>Ruolo *</label>
                <select value={form.ruolo} onChange={e => setForm(f => ({ ...f, ruolo: e.target.value }))} style={{ ...inputStyle }}>
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

            <button type="submit" disabled={salvando}
              style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {salvando ? 'Creazione…' : 'Crea utente'}
            </button>
          </form>
        </div>
      )}

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
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Azioni</th>
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
                          ...stileRuolo[u.ruolo],
                          border: 'none', cursor: 'pointer',
                          fontSize: 12, padding: '3px 8px', borderRadius: 20,
                        }}
                      >
                        {RUOLI.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, fontWeight: 600, ...stileAttivo[String(u.attivo)] }}>
                        {u.attivo ? 'Attivo' : 'Disattivo'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 12 }}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('it-IT') : '—'}
                    </td>
                    <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 12 }}>
                      {u.last_login ? new Date(u.last_login).toLocaleString('it-IT') : 'Mai'}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {/* Reset password inline */}
                      {resetId === u.id ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            type="password"
                            placeholder="Nuova password"
                            value={nuovaPassword}
                            onChange={e => setNuovaPassword(e.target.value)}
                            minLength={6}
                            style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, width: 130 }}
                          />
                          <button onClick={() => handleResetPassword(u.id)} disabled={salvandoReset}
                            style={btnStyle('#f59e0b', '#fff')}>
                            {salvandoReset ? '…' : 'Salva'}
                          </button>
                          <button onClick={() => { setResetId(null); setNuovaPassword('') }}
                            style={btnStyle('#e5e7eb', '#374151')}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button onClick={() => apriModifica(u)}
                            style={btnStyle('#3b82f6', '#fff')}>
                            Modifica
                          </button>
                          {u.ruolo !== 'admin' && (
                            <button onClick={() => apriPermessi(u)}
                              style={btnStyle('#7c3aed', '#fff')}>
                              Permessi
                            </button>
                          )}
                          <button onClick={() => { setResetId(u.id); setNuovaPassword(''); setEsitoReset(prev => ({ ...prev, [u.id]: null })) }}
                            style={btnStyle('#f59e0b', '#fff')}>
                            Reset pwd
                          </button>
                          <button onClick={() => toggleAttivo(u)}
                            style={btnStyle(u.attivo ? '#fee2e2' : '#d1fae5', u.attivo ? '#991b1b' : '#065f46')}>
                            {u.attivo ? 'Disattiva' : 'Riattiva'}
                          </button>
                          <button onClick={() => handleElimina(u)}
                            style={btnStyle('#dc2626', '#fff')}>
                            Elimina
                          </button>
                        </div>
                      )}

                      {/* Feedback riga */}
                      {(esitoAzione[u.id] || esitoReset[u.id]) && (() => {
                        const fb = esitoReset[u.id] || esitoAzione[u.id]
                        return (
                          <div style={{ fontSize: 11, fontWeight: 600, marginTop: 3, color: fb.ok ? '#059669' : '#dc2626' }}>
                            {fb.msg}
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
