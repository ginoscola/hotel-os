/**
 * TabRicaviCamere — Ricavi per singola camera in un periodo, con scomposizione
 * per categoria di ricavo oppure per tipo di trattamento (toggle).
 *
 * Fonte dati: prod_righe (maturato, quota spalmata notte per notte). NON è il
 * fatturato dei Corrispettivi (documento emesso alla partenza): sul singolo mese
 * i due possono differire per i soggiorni a cavallo di fine mese; riconciliano
 * sulla stagione.
 *
 * Il toggle IVA inclusa/esclusa è quello globale del modulo Statistiche Produzione
 * (prop `lordo`).
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../../api/client'
import { ExportMenu } from '../../components/ExportMenu'
import { formatEuro, formatData, mostraErrore } from '../../utils/format'

const LS_HOTEL = 'prod_ricavi_camere_hotel'
const LS_VISTA = 'prod_ricavi_camere_vista'

const HOTEL_BUTTONS = [
  { code: 'DPH', label: 'DPH' },
  { code: 'CLB', label: 'CLB' },
  { code: 'INT', label: 'INT' },
  { code: 'GRUPPO', label: 'Gruppo' },
]

const _oggi = new Date()
const ANNO = _oggi.getFullYear()

// Numero camera senza il prefisso hotel (D101 → 101, C48 → 48). Le camere senza
// cifre (es. FUEGO, AIRE) vanno in fondo.
const numCamera = (code) => {
  const m = String(code || '').match(/\d+/)
  return m ? parseInt(m[0], 10) : Number.POSITIVE_INFINITY
}

const btnHotel = (active) => ({
  padding: '6px 14px', borderRadius: 6, border: '1px solid #cbd5e1',
  cursor: 'pointer', fontWeight: active ? 700 : 400, fontSize: 13,
  background: active ? '#1e293b' : '#f8fafc',
  color: active ? '#fff' : '#374151', transition: 'all .15s',
})
const btnVista = (active) => ({
  padding: '5px 12px', borderRadius: 6, border: '1px solid #cbd5e1',
  cursor: 'pointer', fontWeight: active ? 700 : 400, fontSize: 13,
  background: active ? '#0f766e' : '#f0fdfa',
  color: active ? '#fff' : '#0f766e', transition: 'all .15s',
})
const inpSt = {
  padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 5,
  fontSize: '0.85rem', color: '#1e293b',
}
const th = {
  padding: '6px 8px', fontWeight: 600, fontSize: '0.72rem', whiteSpace: 'nowrap',
  textAlign: 'right', color: '#fff', background: '#1e3a5f', position: 'sticky', top: 0,
}
const td = {
  padding: '5px 8px', fontSize: '0.8rem', borderBottom: '1px solid #f1f5f9',
  whiteSpace: 'nowrap', textAlign: 'right',
}
// Riga TOTALE: sfondo su OGNI <td> (la regola globale tr:nth-child(even) td
// sovrascriverebbe uno sfondo messo solo sulla <tr>).
const tdTot = { ...td, background: '#1e3a5f', color: '#fff', fontWeight: 700, borderBottom: 'none' }

export default function TabRicaviCamere({ lordo }) {
  const [hotelSel, setHotelSel] = useState(() => localStorage.getItem(LS_HOTEL) || 'GRUPPO')
  const [vista, setVista] = useState(() => localStorage.getItem(LS_VISTA) || 'categoria')
  const [da, setDa] = useState(`${ANNO}-01-01`)
  const [a, setA] = useState(`${ANNO}-12-31`)
  const [mostraZero, setMostraZero] = useState(false)
  const [sortKey, setSortKey] = useState('camera')
  const [filtro, setFiltro] = useState('')

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)

  const F = lordo ? 'lordo' : 'imponibile'
  const isGruppo = hotelSel === 'GRUPPO'

  const cambiaHotel = (c) => { setHotelSel(c); localStorage.setItem(LS_HOTEL, c) }
  const cambiaVista = (v) => { setVista(v); localStorage.setItem(LS_VISTA, v) }

  const carica = useCallback(async () => {
    if (!da || !a) return
    setLoading(true); setErrore(null)
    try {
      const { data: res } = await api.get('/produzione/ricavi-camere', {
        params: { hotel_code: hotelSel, data_da: da, data_a: a, includi_zero: mostraZero },
      })
      setData(res)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore caricamento ricavi camere'))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [hotelSel, da, a, mostraZero])

  useEffect(() => { carica() }, [carica])

  // Colonne dinamiche: solo quelle con un totale != 0
  const colonne = useMemo(() => {
    if (!data) return []
    if (vista === 'trattamento') {
      return (data.trattamenti || [])
        .filter(t => (data.totale.per_trattamento[t]?.[F] || 0) !== 0)
        .map(t => ({ key: t, label: t, colore: null }))
    }
    return (data.categorie || [])
      .filter(c => (data.totale.per_categoria[c.code]?.[F] || 0) !== 0)
      .map(c => ({ key: c.code, label: c.name, colore: c.colore }))
  }, [data, vista, F])

  const valore = (r, key) => {
    const src = vista === 'trattamento' ? r.per_trattamento : r.per_categoria
    return src?.[key]?.[F] || 0
  }

  const righe = useMemo(() => {
    const arr = [...(data?.camere || [])]
    if (sortKey === 'camera') {
      arr.sort((x, y) =>
        x.struttura_code.localeCompare(y.struttura_code)
        || numCamera(x.camera) - numCamera(y.camera)
        || x.camera.localeCompare(y.camera))
    } else {
      arr.sort((x, y) => (y.totale[F] || 0) - (x.totale[F] || 0))
    }
    return arr
  }, [data, sortKey, F])

  // Filtro testo: cerca fra camere (codice/tipo) e fra le colonne (categoria/trattamento).
  // Se il testo combacia con una o più colonne → mostra solo quelle colonne;
  // se combacia con una o più camere → mostra solo quelle righe. I due filtri sono
  // indipendenti, così "colazione" restringe le colonne senza svuotare le righe e
  // "D101" restringe le righe senza toccare le colonne.
  const q = filtro.trim().toLowerCase()
  const colMatch = q ? colonne.filter(c => c.label.toLowerCase().includes(q)) : []
  const colFinali = q && colMatch.length > 0 ? colMatch : colonne

  const righeFiltrate = useMemo(() => {
    if (!q) return righe
    const perCamera = righe.filter(r => `${r.camera} ${r.tipo_camera || ''}`.toLowerCase().includes(q))
    // Testo che combacia solo con una colonna: non svuotare le righe
    if (perCamera.length === 0 && colMatch.length > 0) return righe
    return perCamera
  }, [righe, q, colMatch.length])

  // Riga TOTALE calcolata sulle righe/colonne visibili (resta coerente col filtro)
  const totVisibile = useMemo(() => {
    const cols = {}
    colFinali.forEach(c => { cols[c.key] = 0 })
    let tot = 0
    righeFiltrate.forEach(r => {
      tot += r.totale[F] || 0
      colFinali.forEach(c => { cols[c.key] += valore(r, c.key) })
    })
    return { tot: Math.round(tot * 100) / 100, cols }
  }, [righeFiltrate, colFinali, F, vista])

  const cell = (v) => (!v ? <span style={{ color: '#cbd5e1' }}>—</span> : formatEuro(Math.round(v * 100) / 100))

  const exportParams = new URLSearchParams({
    hotel_code: hotelSel, data_da: da, data_a: a, vista,
    lordo: String(lordo), includi_zero: String(mostraZero),
  })
  const exportUrl = `/produzione/ricavi-camere/export?${exportParams.toString()}`
  const exportNome = `ricavi_camere_${hotelSel}_${da}_${a}`

  const rng = data?.data_range_disponibile

  return (
    <div>
      {/* Barra controlli */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {HOTEL_BUTTONS.map(h => (
            <button key={h.code} onClick={() => cambiaHotel(h.code)} style={btnHotel(hotelSel === h.code)}>
              {h.label}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 28, background: '#e2e8f0' }} />

        <label style={{ fontSize: 13, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 3 }}>
          Dal
          <input type="date" value={da} onChange={e => setDa(e.target.value)} style={inpSt} />
        </label>
        <label style={{ fontSize: 13, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 3 }}>
          Al
          <input type="date" value={a} onChange={e => setA(e.target.value)} style={inpSt} />
        </label>

        <div style={{ width: 1, height: 28, background: '#e2e8f0' }} />

        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => cambiaVista('categoria')} style={btnVista(vista === 'categoria')}>Per categoria</button>
          <button onClick={() => cambiaVista('trattamento')} style={btnVista(vista === 'trattamento')}>Per trattamento</button>
        </div>

        <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={mostraZero} onChange={e => setMostraZero(e.target.checked)} />
          Mostra camere a zero
        </label>

        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={filtro}
            onChange={e => setFiltro(e.target.value)}
            placeholder="Cerca camera o categoria…"
            style={{ ...inpSt, width: 210, paddingRight: filtro ? 24 : 8 }}
          />
          {filtro && (
            <button
              onClick={() => setFiltro('')}
              title="Pulisci"
              style={{
                position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8',
                fontSize: 14, lineHeight: 1, padding: 2,
              }}
            >×</button>
          )}
        </div>

        <span style={{ marginLeft: 'auto' }}>
          <ExportMenu url={exportUrl} nome={exportNome} />
        </span>
      </div>

      {/* Banner fonte / range dati */}
      <div style={{
        background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6,
        padding: '8px 12px', fontSize: '0.78rem', color: '#475569', marginBottom: 14,
      }}>
Valori a <strong>maturato</strong> (quota spalmata notte per notte), non a fatturato: sul singolo mese possono differire dai Corrispettivi per i soggiorni a cavallo di fine mese; riconciliano sulla stagione.
        {rng?.min
          ? <> Dati disponibili dal <strong>{formatData(rng.min)}</strong> al <strong>{formatData(rng.max)}</strong>.</>
          : <> Nessun dato di produzione importato.</>}
      </div>

      {errore && <p style={{ color: '#ef4444', fontSize: '0.85rem' }}>{errore}</p>}
      {loading && <p style={{ color: '#64748b', fontSize: '0.85rem' }}>Caricamento…</p>}

      {!loading && data && righe.length === 0 && !errore && (
        <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Nessun ricavo per il periodo selezionato.</p>
      )}

      {!loading && data && righe.length > 0 && righeFiltrate.length === 0 && (
        <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Nessun risultato per “{filtro.trim()}”.</p>
      )}

      {!loading && data && righeFiltrate.length > 0 && (
        <div style={{ overflowX: 'auto', maxHeight: '70vh', border: '1px solid #e2e8f0', borderRadius: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr>
                {isGruppo && <th style={{ ...th, textAlign: 'left' }}>Struttura</th>}
                <th style={{ ...th, textAlign: 'left', cursor: 'pointer' }} onClick={() => setSortKey('camera')}>
                  Camera {sortKey === 'camera' ? '▲' : ''}
                </th>
                <th style={{ ...th, textAlign: 'left' }}>Tipo</th>
                {colFinali.map(c => (
                  <th key={c.key} style={th}>
                    {c.colore && (
                      <span style={{
                        display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                        background: c.colore, marginRight: 4, verticalAlign: 'middle',
                      }} />
                    )}
                    {c.label}
                  </th>
                ))}
                <th style={{ ...th, cursor: 'pointer' }} onClick={() => setSortKey('totale')}>
                  TOTALE {sortKey === 'totale' ? '▼' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {righeFiltrate.map(r => (
                <tr key={`${r.struttura_code}_${r.camera}`}>
                  {isGruppo && <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{r.struttura_code}</td>}
                  <td style={{ ...td, textAlign: 'left', fontWeight: 600, color: '#1e293b' }}>{r.camera}</td>
                  <td style={{ ...td, textAlign: 'left', color: '#64748b' }}>{r.tipo_camera || '—'}</td>
                  {colFinali.map(c => (
                    <td key={c.key} style={td}>{cell(valore(r, c.key))}</td>
                  ))}
                  <td style={{ ...td, fontWeight: 700, color: '#1e293b' }}>{cell(r.totale[F] || 0)}</td>
                </tr>
              ))}
              {/* Riga TOTALE (sfondo su ogni td) — calcolata sulle righe/colonne visibili */}
              <tr>
                {isGruppo && <td style={{ ...tdTot, textAlign: 'left' }}>TOTALE</td>}
                <td style={{ ...tdTot, textAlign: 'left' }} colSpan={2}>
                  {isGruppo ? `${righeFiltrate.length} camere` : `TOTALE — ${righeFiltrate.length} camere`}
                </td>
                {colFinali.map(c => (
                  <td key={c.key} style={tdTot}>{cell(totVisibile.cols[c.key] || 0)}</td>
                ))}
                <td style={tdTot}>{cell(totVisibile.tot || 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
