import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api/client'
import { mostraErrore } from '../utils/format'
import { isAdmin, fmtD, thSt, tdSt } from '../utils/corrispettiviHelpers'

export default function TabImport({ onImportato }) {
  const [trascina, setTrascina] = useState(false)
  const [caricamento, setCaricamento] = useState(false)
  const [esito, setEsito] = useState(null)
  const [isTest, setIsTest] = useState(false)
  const [onConflict, setOnConflict] = useState('salta')
  const [storico, setStorico] = useState([])
  const [loadStor, setLoadStor] = useState(true)
  const inputRef = useRef()

  const caricaStorico = useCallback(async () => {
    try {
      const { data } = await api.get('/corrispettivi/import/storico')
      setStorico(data)
    } catch { /* ignora */ }
    finally { setLoadStor(false) }
  }, [])

  useEffect(() => { caricaStorico() }, [caricaStorico])

  const gestisciFile = async (file) => {
    if (!file) return
    if (!file.name.toLowerCase().match(/\.(xlsx|xls)$/)) {
      setEsito({ ok: false, msg: 'Seleziona un file Excel (.xlsx)' })
      return
    }
    setCaricamento(true)
    setEsito(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const { data } = await api.post(
        `/corrispettivi/import?is_test=${isTest}&on_conflict=${onConflict}`,
        form, { headers: { 'Content-Type': 'multipart/form-data' } }
      )
      const strutStr = data.strutture?.join(', ') || '—'
      const parts = [`${data.n_inseriti} inseriti`]
      if (data.n_aggiornati) parts.push(`${data.n_aggiornati} aggiornati`)
      if (data.n_saltati) parts.push(`${data.n_saltati} saltati (già presenti)`)
      if (data.n_protetti) parts.push(`${data.n_protetti} protetti (modificati manualmente)`)
      if (data.n_esclusi) parts.push(`${data.n_esclusi} esclusi (CP/FD)`)
      setEsito({
        ok: true,
        msg: `Import completato: ${parts.join(', ')}`,
        sub: `Strutture: ${strutStr} · Periodo: ${fmtD(data.periodo?.da)} – ${fmtD(data.periodo?.a)}`,
        warnings: data.warnings,
      })
      caricaStorico()
      onImportato()
    } catch (err) {
      setEsito({ ok: false, msg: mostraErrore(err) })
    } finally {
      setCaricamento(false)
    }
  }

  const eliminaImport = async (id) => {
    if (!window.confirm('Eliminare questa sessione di import?')) return
    try {
      await api.delete(`/corrispettivi/import/${id}?conferma=true`)
      caricaStorico()
      onImportato()
    } catch (err) { alert(mostraErrore(err)) }
  }

  return (
    <div style={{ maxWidth: 820 }}>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setTrascina(true) }}
        onDragLeave={() => setTrascina(false)}
        onDrop={(e) => { e.preventDefault(); setTrascina(false); gestisciFile(e.dataTransfer.files[0]) }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${trascina ? '#2563eb' : '#94a3b8'}`,
          borderRadius: 12, padding: '2.5rem', textAlign: 'center',
          cursor: 'pointer', background: trascina ? '#eff6ff' : '#f8fafc',
          transition: 'all .15s', marginBottom: '1rem',
        }}
      >
        <input ref={inputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }}
          onChange={(e) => gestisciFile(e.target.files[0])} />
        {caricamento ? (
          <p style={{ color: '#64748b', margin: 0 }}>Caricamento in corso…</p>
        ) : (
          <>
            <p style={{ fontSize: '2rem', margin: 0 }}>📊</p>
            <p style={{ color: '#475569', margin: '0.5rem 0 0' }}>
              Trascina il file Excel esportato da Welcome PMS
              <br />
              <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                Formato base (18 col.) o formato esteso con Tassa di soggiorno (36 col.) — oppure clicca per selezionare
              </span>
            </p>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} />
          <span style={{ fontSize: '0.88rem', color: '#64748b' }}>Segna come dati di test</span>
          {isTest && <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: '0.78rem', fontWeight: 600 }}>TEST</span>}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff7ed', border: '1.5px solid #fdba74', borderRadius: 8, padding: '5px 10px' }}>
          <span style={{ fontSize: '0.85rem', color: '#9a3412', fontWeight: 600 }}>Se già presente:</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['salta', 'Salta'], ['aggiorna', 'Aggiorna']].map(([v, l]) => (
              <button key={v} onClick={() => setOnConflict(v)} style={{
                padding: '5px 14px', borderRadius: 6, border: 'none',
                fontSize: '0.85rem', cursor: 'pointer', fontWeight: onConflict === v ? 700 : 400,
                background: onConflict === v ? '#ea580c' : 'transparent',
                color: onConflict === v ? '#fff' : '#9a3412',
              }}>{l}</button>
            ))}
          </div>
          {onConflict === 'aggiorna' && (
            <span style={{ fontSize: '0.75rem', color: '#92400e', background: '#fef3c7', padding: '2px 6px', borderRadius: 3 }}>
              I doc. modificati manualmente non vengono sovrascritti
            </span>
          )}
        </div>
      </div>

      {esito && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1.5rem', fontSize: '0.88rem',
          background: esito.ok ? '#dcfce7' : '#fee2e2', color: esito.ok ? '#166534' : '#991b1b',
        }}>
          <strong>{esito.ok ? '✓' : '✗'} {esito.msg}</strong>
          {esito.sub && <p style={{ margin: '0.25rem 0 0', opacity: 0.8 }}>{esito.sub}</p>}
          {esito.warnings?.length > 0 && (
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.82rem' }}>{esito.warnings.length} avvisi</summary>
              <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
                {esito.warnings.map((w, i) => <li key={i} style={{ fontSize: '0.8rem' }}>{w}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.75rem', color: '#1e293b' }}>Storico import</h3>
      {loadStor ? (
        <p style={{ color: '#94a3b8', fontSize: '0.88rem' }}>Caricamento…</p>
      ) : storico.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: '0.88rem' }}>Nessun import effettuato.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: '#1e3a5f', color: '#fff' }}>
              {['Data import', 'File', 'Periodo', 'Strutture', 'Scontrini', 'Fatture', 'Esclusi', ''].map(h => (
                <th key={h} style={{ ...thSt, textAlign: 'left', color: '#fff' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {storico.map((imp, idx) => (
              <tr key={imp.id} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                <td style={{ ...tdSt, textAlign: 'left', color: '#64748b' }}>
                  {imp.created_at ? new Date(imp.created_at).toLocaleDateString('it-IT') : '—'}
                </td>
                <td style={{ ...tdSt, textAlign: 'left', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {imp.nome_file || '—'}
                </td>
                <td style={{ ...tdSt, textAlign: 'left' }}>{fmtD(imp.data_da)} – {fmtD(imp.data_a)}</td>
                <td style={{ ...tdSt, textAlign: 'left' }}>{(imp.strutture_presenti || []).join(', ') || '—'}</td>
                <td style={tdSt}>{imp.n_scontrini}</td>
                <td style={tdSt}>{imp.n_fatture}</td>
                <td style={{ ...tdSt, color: imp.n_esclusi > 0 ? '#92400e' : '#94a3b8' }}>{imp.n_esclusi}</td>
                <td style={tdSt}>
                  {isAdmin() && (
                    <button onClick={() => eliminaImport(imp.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '0.8rem' }}>
                      Elimina
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
