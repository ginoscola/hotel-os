import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { formatEuro, mostraErrore } from '../utils/format'
import { inpSt, thSt, tdSt, isAdmin, fmtD, meseNome } from '../utils/corrispettiviHelpers'

const annoCorrente = new Date().getFullYear()
const oggiIso = new Date().toISOString().slice(0, 10)

const TIPI = [
  ['versamento', 'Versamento in banca', '#dc2626'],
  ['rettifica', 'Rettifica (± contante)', '#d97706'],
  ['saldo_iniziale', 'Saldo iniziale', '#2563eb'],
]
const tipoLabel = t => (TIPI.find(x => x[0] === t) || [t, t])[1]
const tipoColore = t => (TIPI.find(x => x[0] === t) || [t, t, '#64748b'])[2]

const FORM_VUOTO = { id: null, tipo: 'versamento', data: oggiIso, importo: '', note: '' }

export default function TabCassa() {
  const [anno, setAnno] = useState(annoCorrente)
  const [riep, setRiep] = useState(null)
  const [movimenti, setMovimenti] = useState([])
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  const [form, setForm] = useState(FORM_VUOTO)
  const [saving, setSaving] = useState(false)
  const admin = isAdmin()

  const carica = useCallback(async () => {
    setLoading(true)
    setErrore(null)
    try {
      const [r, m] = await Promise.all([
        api.get('/corrispettivi/cassa/riepilogo', { params: { anno } }),
        api.get('/corrispettivi/cassa/movimenti', { params: { anno } }),
      ])
      setRiep(r.data)
      setMovimenti(m.data)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore nel caricamento'))
    } finally {
      setLoading(false)
    }
  }, [anno])

  useEffect(() => { carica() }, [carica])

  const salva = async () => {
    if (!form.importo && form.importo !== 0) { setErrore('Inserire un importo'); return }
    if (form.tipo !== 'rettifica' && (parseFloat(form.importo) || 0) < 0) {
      setErrore(`L'importo di un ${tipoLabel(form.tipo).toLowerCase()} non può essere negativo (usa "Rettifica" per un'uscita di contante).`)
      return
    }
    setSaving(true)
    setErrore(null)
    try {
      const body = {
        tipo: form.tipo, data: form.data,
        importo: parseFloat(form.importo) || 0, note: form.note || null,
      }
      if (form.id) await api.put(`/corrispettivi/cassa/movimenti/${form.id}`, body)
      else await api.post('/corrispettivi/cassa/movimenti', body)
      setForm(FORM_VUOTO)
      carica()
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore salvataggio'))
    } finally {
      setSaving(false)
    }
  }

  const elimina = async (id) => {
    if (!window.confirm('Eliminare questo movimento?')) return
    try {
      await api.delete(`/corrispettivi/cassa/movimenti/${id}`)
      if (form.id === id) setForm(FORM_VUOTO)
      carica()
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore eliminazione'))
    }
  }

  const modifica = (m) => setForm({
    id: m.id, tipo: m.tipo, data: m.data, importo: String(m.importo), note: m.note || '',
  })

  const t = riep?.totali || {}
  // Dal più recente in alto al più vecchio in fondo (il saldo iniziale resta ultimo).
  const movimentiOrdinati = [...movimenti].sort(
    (a, b) => b.data.localeCompare(a.data) || b.id - a.id
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 600 }}>Anno:</label>
          <select value={anno} onChange={e => setAnno(Number(e.target.value))} style={{ ...inpSt, padding: '5px 10px' }}>
            {[2024, 2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {loading && <p style={{ color: '#94a3b8', padding: '2rem 0' }}>Caricamento…</p>}
      {errore && <p style={{ color: '#ef4444' }}>{errore}</p>}

      {!loading && riep && (
        <>
          {/* Card saldo corrente */}
          <div style={{
            background: 'linear-gradient(135deg,#1e3a5f,#2c5282)', color: '#fff',
            borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem', maxWidth: 460,
          }}>
            <div style={{ fontSize: '0.8rem', opacity: 0.85, marginBottom: 4 }}>
              Cassa contante disponibile {anno}
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.5px' }}>
              {formatEuro(riep.saldo_corrente)}
            </div>
            <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: 8 }}>
              {riep.saldo_iniziale
                ? `Saldo iniziale ${formatEuro(riep.saldo_iniziale.importo)} al 1° ${meseNome(new Date(riep.saldo_iniziale.data).getMonth() + 1)} ${new Date(riep.saldo_iniziale.data).getFullYear()}`
                : 'Nessun saldo iniziale impostato — il progressivo parte da 0'}
            </div>
            <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: 4 }}>
              + {formatEuro(t.contante_incassato || 0)} incassato · − {formatEuro(t.versamenti || 0)} versato
              {t.rettifiche ? ` · ${t.rettifiche > 0 ? '+' : '−'} ${formatEuro(Math.abs(t.rettifiche))} rettifiche` : ''}
            </div>
          </div>

          {/* Tabella mensile */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '1.25rem', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', color: '#1e293b', fontWeight: 700 }}>
              Movimento cassa per mese
            </h3>
            {riep.mesi.length === 0 ? (
              <p style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.85rem' }}>Nessun dato per l'anno {anno}.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thSt, textAlign: 'left' }}>Mese</th>
                      <th style={thSt}>Contante incassato</th>
                      <th style={thSt}>Versamenti</th>
                      <th style={thSt}>Rettifiche</th>
                      <th style={{ ...thSt, background: '#1e293b' }}>Saldo fine mese</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riep.mesi.map((m, idx) => (
                      <tr key={m.mese} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                        <td style={{ ...tdSt, textAlign: 'left', background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                          {meseNome(m.mese)}
                        </td>
                        <td style={{ ...tdSt, background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>{formatEuro(m.contante_incassato)}</td>
                        <td style={{ ...tdSt, background: idx % 2 === 0 ? '#fff' : '#f8fafc', color: m.versamenti ? '#dc2626' : '#cbd5e1' }}>
                          {m.versamenti ? '− ' + formatEuro(m.versamenti) : '—'}
                        </td>
                        <td style={{ ...tdSt, background: idx % 2 === 0 ? '#fff' : '#f8fafc', color: m.rettifiche ? '#d97706' : '#cbd5e1' }}>
                          {m.rettifiche ? (m.rettifiche > 0 ? '+ ' : '− ') + formatEuro(Math.abs(m.rettifiche)) : '—'}
                        </td>
                        <td style={{ ...tdSt, fontWeight: 700, background: idx % 2 === 0 ? '#f1f5f9' : '#e8edf3' }}>
                          {formatEuro(m.saldo_fine_mese)}
                        </td>
                      </tr>
                    ))}
                    <tr className="riga-totale">
                      <td style={{ ...tdSt, textAlign: 'left', background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>TOTALE</td>
                      <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right' }}>{formatEuro(t.contante_incassato || 0)}</td>
                      <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right' }}>− {formatEuro(t.versamenti || 0)}</td>
                      <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right' }}>
                        {(t.rettifiche || 0) >= 0 ? '+ ' : '− '}{formatEuro(Math.abs(t.rettifiche || 0))}
                      </td>
                      <td style={{ background: '#1e3a5f', color: '#fff', padding: '5px 8px', fontSize: '0.85rem', fontWeight: 800, textAlign: 'right' }}>{formatEuro(riep.saldo_corrente)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ marginTop: '0.9rem', fontSize: '0.73rem', color: '#94a3b8', fontStyle: 'italic' }}>
              «Contante incassato» = riga Contante della tab Tipo Incasso (DPH/CLB/INT + MMS/BON).
              Include l'eventuale tassa di soggiorno pagata in contanti (denaro fisicamente in cassa,
              da girare al Comune).
            </p>
          </div>

          {/* Gestione movimenti (admin) */}
          {admin && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '1.25rem' }}>
              <h3 style={{ margin: '0 0 1rem', fontSize: '0.95rem', color: '#1e293b', fontWeight: 700 }}>
                {form.id ? 'Modifica movimento' : 'Aggiungi movimento'}
              </h3>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  <div style={{ marginBottom: 3 }}>Tipo</div>
                  <select value={form.tipo} onChange={e => setForm(f => {
                    // Solo la rettifica accetta il segno: passando a versamento/saldo iniziale
                    // normalizzo un eventuale importo negativo rimasto da una bozza di rettifica.
                    const tipo = e.target.value
                    const importo = tipo !== 'rettifica' && f.importo
                      ? String(Math.abs(parseFloat(f.importo) || 0))
                      : f.importo
                    return { ...f, tipo, importo }
                  })} style={{ ...inpSt, padding: '6px 8px' }}>
                    {TIPI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  <div style={{ marginBottom: 3 }}>Data</div>
                  <input type="date" value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} style={{ ...inpSt, padding: '6px 8px' }} />
                </label>
                <label style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  <div style={{ marginBottom: 3 }}>Importo {form.tipo === 'rettifica' ? '(± con segno)' : '(solo positivo)'}</div>
                  <input type="number" step="0.01" min={form.tipo === 'rettifica' ? undefined : '0'}
                    value={form.importo} placeholder="0.00"
                    onChange={e => setForm(f => ({ ...f, importo: e.target.value }))}
                    style={{ ...inpSt, padding: '6px 8px', width: 120, textAlign: 'right' }} />
                </label>
                <label style={{ fontSize: '0.75rem', color: '#64748b', flex: '1 1 160px' }}>
                  <div style={{ marginBottom: 3 }}>Note</div>
                  <input type="text" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={{ ...inpSt, padding: '6px 8px', width: '100%', boxSizing: 'border-box' }} />
                </label>
                <button onClick={salva} disabled={saving}
                  style={{ ...inpSt, cursor: 'pointer', background: '#1e3a5f', color: '#fff', border: 'none', padding: '7px 16px' }}>
                  {saving ? '…' : form.id ? 'Salva' : 'Aggiungi'}
                </button>
                {form.id && (
                  <button onClick={() => setForm(FORM_VUOTO)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '7px 12px' }}>
                    Annulla
                  </button>
                )}
              </div>
              {form.tipo === 'saldo_iniziale' && (
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: '0.5rem 0 0' }}>
                  Il saldo iniziale viene registrato al 1° del mese della data indicata.
                </p>
              )}

              <table style={{ minWidth: 480, marginTop: '1.25rem' }}>
                <thead>
                  <tr>
                    <th style={{ ...thSt, textAlign: 'left' }}>Data</th>
                    <th style={{ ...thSt, textAlign: 'left' }}>Tipo</th>
                    <th style={thSt}>Importo</th>
                    <th style={{ ...thSt, textAlign: 'left' }}>Note</th>
                    <th style={thSt}></th>
                  </tr>
                </thead>
                <tbody>
                  {movimentiOrdinati.length === 0 && (
                    <tr><td colSpan={5} style={{ ...tdSt, textAlign: 'left', color: '#94a3b8', fontStyle: 'italic' }}>Nessun movimento.</td></tr>
                  )}
                  {movimentiOrdinati.map((m, idx) => (
                    <tr key={m.id} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                      <td style={{ ...tdSt, textAlign: 'left', background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>{fmtD(m.data)}</td>
                      <td style={{ ...tdSt, textAlign: 'left', background: idx % 2 === 0 ? '#fff' : '#f8fafc', color: tipoColore(m.tipo), fontWeight: 600 }}>{tipoLabel(m.tipo)}</td>
                      <td style={{ ...tdSt, background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>{formatEuro(m.importo)}</td>
                      <td style={{ ...tdSt, textAlign: 'left', background: idx % 2 === 0 ? '#fff' : '#f8fafc', color: '#64748b' }}>{m.note || '—'}</td>
                      <td style={{ ...tdSt, background: idx % 2 === 0 ? '#fff' : '#f8fafc', whiteSpace: 'nowrap' }}>
                        <button onClick={() => modifica(m)} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.78rem' }}>Modifica</button>
                        <button onClick={() => elimina(m.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.78rem', marginLeft: 6 }}>Elimina</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
