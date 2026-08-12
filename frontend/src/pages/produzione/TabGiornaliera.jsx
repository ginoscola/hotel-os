import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { formatEuro, mostraErrore } from '../../utils/format'
import { ExportMenu } from '../../components/ExportMenu.jsx'
import {
  STRUTTURE_HOTEL, NOMI, fmtD, meseNome, primoGiorno, ultimoGiorno,
  giornoSettimana, thSt, tdSt, inpSt, campoValore, meseAnnoPrecedente,
} from '../../utils/produzioneHelpers'

function DrawerRighe({ info, onClose, lordo }) {
  const [righe, setRighe] = useState([])
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState('')

  useEffect(() => {
    if (!info) return
    setLoading(true)
    setErrore('')
    api.get('/produzione/righe', {
      params: { data_da: info.data, data_a: info.data, struttura_code: info.struttura_code, categoria_code: info.categoria_code },
    })
      .then(r => setRighe(r.data))
      .catch(e => { setRighe([]); setErrore(mostraErrore(e)) })
      .finally(() => setLoading(false))
  }, [info])

  if (!info) return null

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: 480,
      background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
      zIndex: 1000, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong style={{ color: '#1e293b' }}>{NOMI[info.struttura_code]} — {info.categoria_name}</strong>
          <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: '#64748b' }}>{fmtD(info.data)}</p>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#94a3b8' }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem' }}>
        {loading ? (
          <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Caricamento…</p>
        ) : errore ? (
          <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{errore}</p>
        ) : righe.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Nessuna riga per questa selezione.</p>
        ) : righe.map(r => (
          <div key={r.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.65rem 0.85rem', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1e293b' }}>{r.dettaglio_originale || '—'}</span>
              <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{formatEuro(lordo ? r.lordo : r.imponibile)}</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 3 }}>
              {r.camera && <span>Cam. {r.camera} · </span>}
              {r.ospite && <span>{r.ospite}</span>}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>
              {r.trattamento && <span>{r.trattamento} · </span>}
              {r.canale && <span>{r.canale}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Tabella Data × Categoria per UN SOLO hotel — usata sia da sola (filtro struttura singola)
// sia ripetuta una volta per hotel dentro i blocchi accordion (vista "Tutte le strutture").
function TabellaHotel({ sc, giorni, byChiave, categorie, lordo, totMese, onCellClick, mostraColonnaTotale = true, mostraNomeHotel = false }) {
  return (
    <div style={{ overflowX: 'auto', fontSize: '0.78rem' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: 700, width: '100%' }}>
        <thead>
          {mostraNomeHotel && (
            <tr style={{ background: '#1e3a5f' }}>
              <th style={{ ...thSt, background: '#1e3a5f' }} rowSpan={2} />
              <th style={{ ...thSt, textAlign: 'center', borderLeft: '2px solid #334e78' }} colSpan={categorie.length + (mostraColonnaTotale ? 2 : 1)}>
                {NOMI[sc]}
              </th>
            </tr>
          )}
          <tr style={{ background: '#2d4f7c', color: '#cbd5e1' }}>
            {!mostraNomeHotel && (
              <th style={{ ...thSt, background: '#1e3a5f', color: '#fff', textAlign: 'left', minWidth: 70 }}>Data</th>
            )}
            {categorie.map((c, i) => (
              <th key={c.code} style={{
                ...thSt, color: '#cbd5e1', fontSize: '0.68rem',
                borderLeft: i === 0 ? '3px solid #4a6fa5' : '1px solid #3d6a9a',
              }}>{c.name}</th>
            ))}
            <th style={{ ...thSt, color: '#fff', fontWeight: 700, borderLeft: '1px solid #3d6a9a' }}>Tot.</th>
            {mostraColonnaTotale && (
              <th style={{ ...thSt, borderLeft: '2px solid #334e78' }}>TOT. GIORNO</th>
            )}
          </tr>
        </thead>
        <tbody>
          {giorni.map((data, idx) => {
            const gg = giornoSettimana(data)
            const isSab = gg === 'sab'
            const rigaBg = isSab ? '#eff6ff' : idx % 2 === 0 ? '#fff' : '#f8fafc'
            const g = byChiave[`${data}_${sc}`]
            return (
              <tr key={data} style={{ background: rigaBg }}>
                <td style={{ ...tdSt, textAlign: 'left', fontWeight: isSab ? 700 : 400, color: '#475569' }}>
                  {fmtD(data)} <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>{gg}</span>
                </td>
                {categorie.map((c, i) => {
                  const v = g?.per_categoria?.[c.code]
                  const val = campoValore(v, lordo)
                  return (
                    <td key={c.code}
                      style={{
                        ...tdSt, color: !val ? '#e2e8f0' : '#1e293b', cursor: val ? 'pointer' : 'default',
                        borderLeft: i === 0 ? '3px solid #7baec8' : '1px solid #86a8bf',
                      }}
                      onClick={() => val && onCellClick(data, c.code, c.name)}
                    >
                      {val ? formatEuro(val) : '—'}
                    </td>
                  )
                })}
                <td style={{ ...tdSt, fontWeight: 700, borderLeft: '2px solid #7baec8' }}>
                  {g ? formatEuro(campoValore(g.totale, lordo)) : '—'}
                </td>
                {mostraColonnaTotale && (
                  <td style={{ ...tdSt, fontWeight: 700, borderLeft: '2px solid #7baec8' }}>
                    {g ? formatEuro(campoValore(g.totale, lordo)) : '—'}
                  </td>
                )}
              </tr>
            )
          })}

          {/* background impostato su OGNI <td>, non solo sulla <tr>: lo sfondo non si eredita
              dal genitore in CSS, e il foglio di stile globale (tr:nth-child(even) td) vince
              sul <td> trasparente quando questa riga cade in posizione pari (dipende dal numero
              di giorni del mese — bug reale osservato: maggio 31gg posizione pari, giugno 30gg
              posizione dispari, stessa riga visibile in un mese e "spenta" nell'altro). */}
          <tr style={{ background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>
            <td style={{ ...tdSt, background: '#1e3a5f', color: '#fff', borderBottom: 'none', textAlign: 'left' }}>TOTALE MESE</td>
            {categorie.map(c => (
              <td key={c.code} style={{ ...tdSt, background: '#1e3a5f', color: '#fff', borderBottom: 'none' }}>
                {formatEuro(campoValore(totMese[c.code], lordo))}
              </td>
            ))}
            <td style={{ ...tdSt, background: '#1e3a5f', color: '#fff', fontWeight: 800, borderBottom: 'none', borderLeft: '2px solid #4a6fa5' }}>
              {formatEuro(campoValore(totMese.totale, lordo))}
            </td>
            {mostraColonnaTotale && (
              <td style={{ ...tdSt, background: '#1e3a5f', color: '#fff', fontWeight: 800, borderBottom: 'none', borderLeft: '2px solid #4a6fa5' }}>
                {formatEuro(campoValore(totMese.totale, lordo))}
              </td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// Riepilogo compatto per la vista "Tutte le strutture": solo i totali giornalieri per hotel
// affiancati (Data | Tot.DPH | Tot.CLB | Tot.INT | TOT.GIORNO) — colpo d'occhio veloce prima di
// aprire i blocchi dettagliati per categoria sotto.
function RiepilogoTutteStrutture({ strutture, giorni, byChiave, totMese, totGlobaleMese, lordo }) {
  return (
    <div style={{ overflowX: 'auto', fontSize: '0.78rem', marginBottom: '1.5rem' }}>
      <table style={{ borderCollapse: 'collapse', minWidth: 500, width: '100%' }}>
        <thead>
          <tr style={{ background: '#1e3a5f', color: '#fff' }}>
            <th style={{ ...thSt, textAlign: 'left', minWidth: 70 }}>Data</th>
            {strutture.map(sc => (
              <th key={sc} style={{ ...thSt }}>{NOMI[sc]}</th>
            ))}
            <th style={{ ...thSt, borderLeft: '2px solid #4a6fa5' }}>TOT. GIORNO</th>
          </tr>
        </thead>
        <tbody>
          {giorni.map((data, idx) => {
            const gg = giornoSettimana(data)
            const isSab = gg === 'sab'
            const rigaBg = isSab ? '#eff6ff' : idx % 2 === 0 ? '#fff' : '#f8fafc'
            let totGiorno = 0
            return (
              <tr key={data} style={{ background: rigaBg }}>
                <td style={{ ...tdSt, textAlign: 'left', fontWeight: isSab ? 700 : 400, color: '#475569' }}>
                  {fmtD(data)} <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>{gg}</span>
                </td>
                {strutture.map(sc => {
                  const g = byChiave[`${data}_${sc}`]
                  const val = g ? campoValore(g.totale, lordo) : 0
                  totGiorno += val
                  return (
                    <td key={sc} style={{ ...tdSt, color: !val ? '#e2e8f0' : '#1e293b' }}>
                      {val ? formatEuro(val) : '—'}
                    </td>
                  )
                })}
                <td style={{ ...tdSt, fontWeight: 700, borderLeft: '2px solid #7baec8' }}>
                  {totGiorno ? formatEuro(totGiorno) : '—'}
                </td>
              </tr>
            )
          })}

          <tr style={{ background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>
            <td style={{ ...tdSt, background: '#1e3a5f', color: '#fff', borderBottom: 'none', textAlign: 'left' }}>TOTALE MESE</td>
            {strutture.map(sc => (
              <td key={sc} style={{ ...tdSt, background: '#1e3a5f', color: '#fff', borderBottom: 'none' }}>
                {formatEuro(campoValore(totMese[sc].totale, lordo))}
              </td>
            ))}
            <td style={{ ...tdSt, background: '#1e3a5f', color: '#fff', fontWeight: 800, borderBottom: 'none', borderLeft: '2px solid #4a6fa5' }}>
              {formatEuro(campoValore(totGlobaleMese, lordo))}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// Blocco accordion per un hotel dentro la vista "Tutte le strutture": intestazione con nome
// hotel + totale mese sempre visibili anche da chiuso, corpo con la tabella dettagliata per
// categoria (TabellaHotel) collassabile.
function BloccoHotel({ sc, aperto, onToggle, giorni, byChiave, categorie, lordo, totMese, onCellClick }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: '1rem', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          padding: '0.75rem 1.1rem', border: 'none', cursor: 'pointer',
          background: '#f1f5f9', color: '#1e293b',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.92rem' }}>
          <span style={{ fontSize: 11, transform: aperto ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
          {NOMI[sc]}
        </span>
        <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>
          Totale mese: {formatEuro(campoValore(totMese.totale, lordo))}
        </span>
      </button>
      {aperto && (
        <div style={{ padding: '0.75rem' }}>
          <TabellaHotel
            sc={sc} giorni={giorni} byChiave={byChiave} categorie={categorie} lordo={lordo}
            totMese={totMese} onCellClick={onCellClick} mostraColonnaTotale={false}
          />
        </div>
      )}
    </div>
  )
}

export default function TabGiornaliera({ lordo }) {
  const def = meseAnnoPrecedente()
  const [anno, setAnno] = useState(def.anno)
  const [mese, setMese] = useState(def.mese)
  const [struttura, setStruttura] = useState('')
  const [categoria, setCategoria] = useState('')
  const [canale, setCanale] = useState('')
  const [trattamento, setTrattamento] = useState('')

  const [categorie, setCategorie] = useState([])
  const [canaliLista, setCanaliLista] = useState([])
  const [trattamentiLista, setTrattamentiLista] = useState([])
  const [dati, setDati] = useState([])
  const [loading, setLoading] = useState(false)
  const [drawer, setDrawer] = useState(null)
  const [aperti, setAperti] = useState(() => new Set(STRUTTURE_HOTEL))

  const da = primoGiorno(anno, mese)
  const a = ultimoGiorno(anno, mese)

  useEffect(() => {
    api.get('/produzione/categorie').then(r => setCategorie(r.data.filter(c => c.includi_report && c.attivo))).catch(() => {})
    api.get('/produzione/canali/lista').then(r => setCanaliLista(r.data)).catch(() => {})
    api.get('/produzione/trattamenti/lista').then(r => setTrattamentiLista(r.data)).catch(() => {})
  }, [])

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/produzione/report/giornaliero', {
        params: {
          data_da: da, data_a: a,
          struttura_code: struttura || undefined,
          categoria_code: categoria || undefined,
          canale: canale || undefined,
          trattamento: trattamento || undefined,
        },
      })
      setDati(data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [da, a, struttura, categoria, canale, trattamento])

  useEffect(() => { carica() }, [carica])

  const strutture = struttura ? [struttura] : STRUTTURE_HOTEL
  const vistaTutte = !struttura

  // Genera tutte le date del mese
  const giorni = []
  const cur = new Date(da + 'T00:00:00')
  const end = new Date(a + 'T00:00:00')
  while (cur <= end) {
    giorni.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`)
    cur.setDate(cur.getDate() + 1)
  }

  const byChiave = {}
  dati.forEach(g => { byChiave[`${g.data}_${g.struttura_code}`] = g })

  const navMese = (delta) => {
    let m = mese + delta, y = anno
    if (m > 12) { m = 1; y++ }
    if (m < 1) { m = 12; y-- }
    setMese(m); setAnno(y)
  }

  const toggleHotel = (sc) => {
    setAperti(prev => {
      const next = new Set(prev)
      if (next.has(sc)) next.delete(sc)
      else next.add(sc)
      return next
    })
  }

  // Totali mese per struttura/categoria
  const totMese = {}
  strutture.forEach(sc => {
    totMese[sc] = {}
    categorie.forEach(c => { totMese[sc][c.code] = { lordo: 0, imponibile: 0 } })
    totMese[sc].totale = { lordo: 0, imponibile: 0 }
  })
  let totGlobaleMese = { lordo: 0, imponibile: 0 }
  giorni.forEach(data => {
    strutture.forEach(sc => {
      const g = byChiave[`${data}_${sc}`]
      if (!g) return
      categorie.forEach(c => {
        const v = g.per_categoria[c.code]
        if (!v) return
        totMese[sc][c.code].lordo += v.lordo
        totMese[sc][c.code].imponibile += v.imponibile
      })
      totMese[sc].totale.lordo += g.totale.lordo
      totMese[sc].totale.imponibile += g.totale.imponibile
      totGlobaleMese.lordo += g.totale.lordo
      totGlobaleMese.imponibile += g.totale.imponibile
    })
  })

  const selSt = { ...inpSt, fontSize: '0.82rem' }

  const apriDrawer = (sc) => (data, categoria_code, categoria_name) =>
    setDrawer({ data, struttura_code: sc, categoria_code, categoria_name })

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button onClick={() => navMese(-1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9' }}>←</button>
        <span style={{ fontWeight: 700, minWidth: 120, textAlign: 'center' }}>{meseNome(mese)} {anno}</span>
        <button onClick={() => navMese(1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9' }}>→</button>

        <select value={struttura} onChange={e => setStruttura(e.target.value)} style={selSt}>
          <option value="">Tutte le strutture</option>
          {STRUTTURE_HOTEL.map(sc => <option key={sc} value={sc}>{NOMI[sc]}</option>)}
        </select>
        <select value={categoria} onChange={e => setCategoria(e.target.value)} style={selSt}>
          <option value="">Tutte le categorie</option>
          {categorie.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select value={canale} onChange={e => setCanale(e.target.value)} style={selSt}>
          <option value="">Tutti i canali</option>
          {canaliLista.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={trattamento} onChange={e => setTrattamento(e.target.value)} style={selSt}>
          <option value="">Tutti i trattamenti</option>
          {trattamentiLista.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        <div style={{ marginLeft: 'auto' }}>
          <ExportMenu
            url={`/produzione/export/giornaliero?data_da=${da}&data_a=${a}${struttura ? `&struttura_code=${struttura}` : ''}${categoria ? `&categoria_code=${categoria}` : ''}${canale ? `&canale=${encodeURIComponent(canale)}` : ''}${trattamento ? `&trattamento=${encodeURIComponent(trattamento)}` : ''}`}
            nome={`produzione_giornaliero_${anno}_${mese}`}
          />
        </div>
      </div>

      {loading && <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Caricamento…</p>}

      {vistaTutte ? (
        <>
          <RiepilogoTutteStrutture
            strutture={strutture} giorni={giorni} byChiave={byChiave}
            totMese={totMese} totGlobaleMese={totGlobaleMese} lordo={lordo}
          />
          {strutture.map(sc => (
            <BloccoHotel
              key={sc} sc={sc} aperto={aperti.has(sc)} onToggle={() => toggleHotel(sc)}
              giorni={giorni} byChiave={byChiave} categorie={categorie} lordo={lordo}
              totMese={totMese[sc]} onCellClick={apriDrawer(sc)}
            />
          ))}
        </>
      ) : (
        <TabellaHotel
          sc={struttura} giorni={giorni} byChiave={byChiave} categorie={categorie} lordo={lordo}
          totMese={totMese[struttura]} onCellClick={apriDrawer(struttura)} mostraColonnaTotale={true}
          mostraNomeHotel={true}
        />
      )}

      {drawer && <DrawerRighe info={drawer} onClose={() => setDrawer(null)} lordo={lordo} />}
      {drawer && (
        <div onClick={() => setDrawer(null)} style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.1)' }} />
      )}
    </div>
  )
}
