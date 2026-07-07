import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'

function formatDataOra(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const BADGE_ESITO = {
  success: { label: 'SUCCESSO', bg: '#d1fae5', color: '#065f46', dot: '#10b981' },
  partial: { label: 'PARZIALE', bg: '#fef3c7', color: '#92400e', dot: '#f59e0b' },
  error:   { label: 'ERRORE',   bg: '#fee2e2', color: '#991b1b', dot: '#ef4444' },
}

function BadgeEsito({ esito }) {
  const b = BADGE_ESITO[esito] || { label: esito || '—', bg: '#f1f5f9', color: '#475569', dot: '#94a3b8' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999, background: b.bg, color: b.color, fontWeight: 700, fontSize: 12 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: b.dot, display: 'inline-block' }} />
      {b.label}
    </span>
  )
}

export default function AdminBackup() {
  const [status, setStatus] = useState(null)
  const [logs, setLogs] = useState([])
  const [files, setFiles] = useState([])
  const [filtroEsito, setFiltroEsito] = useState('')
  const [eseguendo, setEseguendo] = useState(false)
  const [esitoAzione, setEsitoAzione] = useState(null)
  const [setupAperto, setSetupAperto] = useState(false)
  const [modalFile, setModalFile] = useState(null)
  const [istruzioni, setIstruzioni] = useState(null)
  const [erroreIstruzioni, setErroreIstruzioni] = useState(null)

  const carica = useCallback(() => {
    api.get('/admin/backup/status').then(r => setStatus(r.data)).catch(() => {})
    api.get('/admin/backup/logs', { params: { limit: 30, esito: filtroEsito || undefined } })
      .then(r => setLogs(r.data)).catch(() => {})
    api.get('/admin/backup/files').then(r => setFiles(r.data)).catch(() => {})
  }, [filtroEsito])

  useEffect(() => { carica() }, [carica])

  async function eseguiOra() {
    setEseguendo(true); setEsitoAzione(null)
    try {
      const { data } = await api.post('/admin/backup/esegui-ora')
      setEsitoAzione({ ok: true, msg: data.messaggio })
    } catch (e) {
      setEsitoAzione({ ok: false, msg: mostraErrore(e, 'Errore nell\'avvio del backup.') })
    } finally {
      setEseguendo(false)
    }
  }

  async function apriIstruzioni(nome) {
    setModalFile(nome); setIstruzioni(null); setErroreIstruzioni(null)
    try {
      const { data } = await api.post(`/admin/backup/ripristina/${encodeURIComponent(nome)}`)
      setIstruzioni(data)
    } catch (e) {
      setErroreIstruzioni(mostraErrore(e, 'Errore nel recupero delle istruzioni.'))
    }
  }

  const u = status?.ultimo_backup

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 20 }}>Backup automatico</h2>

      {/* Card stato */}
      <div className="card" style={{ marginBottom: 24 }}>
        {!status && <p style={{ color: '#94a3b8' }}>Caricamento…</p>}
        {status && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: '#64748b' }}>Ultimo backup</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{u ? formatDataOra(u.timestamp) : 'Nessuno'}</div>
              </div>
              {u && (
                <div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Esito</div>
                  <BadgeEsito esito={u.esito} />
                </div>
              )}
              {u && (
                <div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>DB</div>
                  <div style={{ fontWeight: 600 }}>{u.dump_size_mb} MB</div>
                </div>
              )}
              {u && (
                <div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Durata</div>
                  <div style={{ fontWeight: 600 }}>{u.durata_secondi}s</div>
                </div>
              )}
              {u && (
                <div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Raspberry</div>
                  <div style={{ fontWeight: 600 }}>{u.raspberry_ok ? '✅' : '❌'}</div>
                </div>
              )}
              {u && (
                <div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>GitHub</div>
                  <div style={{ fontWeight: 600 }}>{u.github_ok ? '✅' : '❌'}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 12, color: '#64748b' }}>Prossimo backup</div>
                <div style={{ fontWeight: 600 }}>stanotte ore {status.prossimo_backup}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              <span>launchd: {status.launchd_attivo ? '✅ attivo' : '⚠️ non caricato'}</span>
              <span>Raspberry raggiungibile ora: {status.raspberry_raggiungibile ? '✅' : '❌'}</span>
              <span>Backup locali presenti: {status.backup_locali}</span>
            </div>

            <button onClick={eseguiOra} disabled={eseguendo}
              style={{ padding: '9px 20px', background: '#0369a1', color: '#fff', border: 'none', borderRadius: 6, cursor: eseguendo ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14 }}>
              {eseguendo ? 'Avvio in corso…' : 'Esegui adesso'}
            </button>
            {esitoAzione && (
              <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: esitoAzione.ok ? '#d1fae5' : '#fee2e2', color: esitoAzione.ok ? '#065f46' : '#991b1b' }}>
                {esitoAzione.msg}
              </div>
            )}
          </>
        )}
      </div>

      {/* Tabella log */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Storico backup (ultimi 30)</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { val: '', label: 'Tutti' },
              { val: 'success', label: 'Successo' },
              { val: 'partial', label: 'Parziale' },
              { val: 'error', label: 'Errore' },
            ].map(f => (
              <button key={f.val} onClick={() => setFiltroEsito(f.val)}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: filtroEsito === f.val ? '1px solid #0369a1' : '1px solid #e2e8f0',
                  background: filtroEsito === f.val ? '#e0f2fe' : '#fff',
                  color: filtroEsito === f.val ? '#0369a1' : '#475569',
                }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '6px 8px' }}>Data/Ora</th>
                <th style={{ padding: '6px 8px' }}>Esito</th>
                <th style={{ padding: '6px 8px' }}>DB (MB)</th>
                <th style={{ padding: '6px 8px' }}>Raspberry</th>
                <th style={{ padding: '6px 8px' }}>GitHub</th>
                <th style={{ padding: '6px 8px' }}>Durata</th>
                <th style={{ padding: '6px 8px' }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '12px 8px', color: '#94a3b8' }}>Nessun record.</td></tr>
              )}
              {logs.map((r, i) => (
                <tr key={i} style={{
                  borderBottom: '1px solid #f1f5f9',
                  background: r.esito === 'error' ? '#fef2f2' : r.esito === 'partial' ? '#fffbeb' : 'transparent',
                }}>
                  <td style={{ padding: '6px 8px' }}>{formatDataOra(r.timestamp)}</td>
                  <td style={{ padding: '6px 8px' }}><BadgeEsito esito={r.esito} /></td>
                  <td style={{ padding: '6px 8px' }}>{r.dump_size_mb}</td>
                  <td style={{ padding: '6px 8px' }}>{r.raspberry_ok ? '✅' : '❌'}</td>
                  <td style={{ padding: '6px 8px' }}>{r.github_ok ? '✅' : '❌'}</td>
                  <td style={{ padding: '6px 8px' }}>{r.durata_secondi}s</td>
                  <td style={{ padding: '6px 8px', color: '#64748b' }}>{r.errore || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* File locali */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>File locali</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '6px 8px' }}>Nome</th>
                <th style={{ padding: '6px 8px' }}>Dimensione (MB)</th>
                <th style={{ padding: '6px 8px' }}>Data</th>
                <th style={{ padding: '6px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {files.length === 0 && (
                <tr><td colSpan={4} style={{ padding: '12px 8px', color: '#94a3b8' }}>Nessun file presente.</td></tr>
              )}
              {files.map(f => (
                <tr key={f.nome} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{f.nome}</td>
                  <td style={{ padding: '6px 8px' }}>{f.dimensione_mb}</td>
                  <td style={{ padding: '6px 8px' }}>{formatDataOra(f.data_creazione)}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <button onClick={() => apriIstruzioni(f.nome)}
                      style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer' }}>
                      Istruzioni ripristino
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Setup */}
      <div className="card">
        <div onClick={() => setSetupAperto(a => !a)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Configurazione iniziale (da fare una volta)</h3>
          <span style={{ fontSize: 18 }}>{setupAperto ? '▲' : '▼'}</span>
        </div>
        {setupAperto && (
          <ol style={{ marginTop: 16, lineHeight: 1.8, fontSize: 13, color: '#334155' }}>
            <li>
              Crea un repository GitHub privato:<br />
              → vai su github.com → New repository → nome: <code>hotelos-backup</code> → Private ✓<br />
              → NON inizializzare con README
            </li>
            <li>
              Verifica che la chiave SSH esistente abbia accesso al nuovo repo (già usata per hotel-os, non serve crearne una nuova).
            </li>
            <li>
              Installa il backup automatico:<br />
              <code>cd ~/hotel-os && bash scripts/installa-backup.sh</code>
            </li>
            <li>
              Testa subito:<br />
              <code>bash scripts/test-backup.sh</code>
            </li>
            <li>
              Verifica stato:<br />
              <code>bash scripts/verifica-backup.sh</code>
            </li>
          </ol>
        )}
      </div>

      {/* Modal istruzioni ripristino */}
      {modalFile && (
        <div onClick={() => setModalFile(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 10, padding: 24, maxWidth: 560, width: '90%' }}>
            <h3 style={{ marginTop: 0 }}>Ripristino — {modalFile}</h3>
            {erroreIstruzioni && <p style={{ color: '#991b1b' }}>{erroreIstruzioni}</p>}
            {!erroreIstruzioni && !istruzioni && <p style={{ color: '#94a3b8' }}>Caricamento…</p>}
            {istruzioni && (
              <>
                <div style={{ background: '#fef2f2', color: '#991b1b', padding: '10px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
                  ⚠️ {istruzioni.avvertenza}
                </div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Comando di ripristino</div>
                  <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 12, borderRadius: 6, fontSize: 12, overflowX: 'auto' }}>{istruzioni.comando_ripristino}</pre>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Comando di verifica</div>
                  <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 12, borderRadius: 6, fontSize: 12, overflowX: 'auto' }}>{istruzioni.comando_verifica}</pre>
                </div>
              </>
            )}
            <button onClick={() => setModalFile(null)}
              style={{ marginTop: 20, padding: '8px 16px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>
              Chiudi
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
