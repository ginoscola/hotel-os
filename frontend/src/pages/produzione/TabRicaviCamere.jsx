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
import {
  Checkbox, Field, HotelTag, Input, Loading, Messaggio, SegmentedControl, StatoVuoto, Table, Td, Th,
} from '../../components/ui'
import { colors } from '../../styles/tokens.js'

const LS_HOTEL = 'prod_ricavi_camere_hotel'
const LS_VISTA = 'prod_ricavi_camere_vista'

const OPZIONI_HOTEL = [
  { value: 'DPH', label: 'DPH' },
  { value: 'CLB', label: 'CLB' },
  { value: 'INT', label: 'INT' },
  { value: 'GRUPPO', label: 'Gruppo' },
]
const OPZIONI_VISTA = [
  { value: 'categoria', label: 'Per categoria' },
  { value: 'trattamento', label: 'Per trattamento' },
]

// Separatore verticale tra gruppi di controlli nella barra
const Sep = () => <div style={{ width: 1, height: 28, background: colors.border }} />

const _oggi = new Date()
const ANNO = _oggi.getFullYear()

// Numero camera senza il prefisso hotel (D101 → 101, C48 → 48). Le camere senza
// cifre (es. FUEGO, AIRE) vanno in fondo.
const numCamera = (code) => {
  const m = String(code || '').match(/\d+/)
  return m ? parseInt(m[0], 10) : Number.POSITIVE_INFINITY
}

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

  const cell = (v) => (!v ? <span style={{ color: colors.borderStrong }}>—</span> : formatEuro(Math.round(v * 100) / 100))

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
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 14, flexWrap: 'wrap' }}>
        <SegmentedControl value={hotelSel} onChange={cambiaHotel} options={OPZIONI_HOTEL} />
        <Sep />
        <Field label="Dal"><Input type="date" value={da} onChange={e => setDa(e.target.value)} /></Field>
        <Field label="Al"><Input type="date" value={a} onChange={e => setA(e.target.value)} /></Field>
        <Sep />
        <SegmentedControl value={vista} onChange={cambiaVista} options={OPZIONI_VISTA} />
        <Checkbox checked={mostraZero} onChange={setMostraZero} label="Mostra camere a zero" style={{ alignSelf: 'center' }} />

        <div style={{ position: 'relative' }}>
          <Input
            type="text"
            value={filtro}
            onChange={e => setFiltro(e.target.value)}
            placeholder="Cerca camera o categoria…"
            style={{ width: 220, paddingRight: filtro ? 26 : 10 }}
          />
          {filtro && (
            <button
              onClick={() => setFiltro('')}
              title="Pulisci"
              style={{
                position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                border: 'none', background: 'none', cursor: 'pointer', color: colors.textSubtle,
                fontSize: 14, lineHeight: 1, padding: 2,
              }}
            >×</button>
          )}
        </div>

        <span style={{ marginLeft: 'auto', alignSelf: 'center' }}>
          <ExportMenu url={exportUrl} nome={exportNome} />
        </span>
      </div>

      {/* Banner fonte / range dati */}
      <Messaggio tipo="info">
        Valori a <strong>maturato</strong> (quota spalmata notte per notte), non a fatturato: sul singolo mese possono differire dai Corrispettivi per i soggiorni a cavallo di fine mese; riconciliano sulla stagione.
        {rng?.min
          ? <> Dati disponibili dal <strong>{formatData(rng.min)}</strong> al <strong>{formatData(rng.max)}</strong>.</>
          : <> Nessun dato di produzione importato.</>}
      </Messaggio>

      <Messaggio tipo="err">{errore}</Messaggio>
      {loading && <Loading />}

      {!loading && data && righe.length === 0 && !errore && (
        <StatoVuoto>Nessun ricavo per il periodo selezionato.</StatoVuoto>
      )}

      {!loading && data && righe.length > 0 && righeFiltrate.length === 0 && (
        <StatoVuoto>Nessun risultato per “{filtro.trim()}”.</StatoVuoto>
      )}

      {!loading && data && righeFiltrate.length > 0 && (
        <Table compact maxHeight="70vh">
          <thead>
            <tr>
              {isGruppo && <Th>Struttura</Th>}
              <Th className="ordinabile" onClick={() => setSortKey('camera')} title="Ordina per numero camera">
                Camera {sortKey === 'camera' ? '▲' : ''}
              </Th>
              <Th>Tipo</Th>
              {colFinali.map(c => (
                <Th key={c.key} num>
                  {c.colore && (
                    <span style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                      background: c.colore, marginRight: 4, verticalAlign: 'middle',
                    }} />
                  )}
                  {c.label}
                </Th>
              ))}
              <Th num tot className="ordinabile" onClick={() => setSortKey('totale')} title="Ordina per ricavo decrescente">
                TOTALE {sortKey === 'totale' ? '▼' : ''}
              </Th>
            </tr>
          </thead>
          <tbody>
            {righeFiltrate.map(r => (
              <tr key={`${r.struttura_code}_${r.camera}`}>
                {isGruppo && <Td><HotelTag code={r.struttura_code} /></Td>}
                <Td style={{ fontWeight: 600 }}>{r.camera}</Td>
                <Td style={{ color: colors.textMuted }}>{r.tipo_camera || '—'}</Td>
                {colFinali.map(c => <Td key={c.key} num>{cell(valore(r, c.key))}</Td>)}
                <Td num tot style={{ fontWeight: 700 }}>{cell(r.totale[F] || 0)}</Td>
              </tr>
            ))}
            {/* Riga TOTALE — calcolata sulle righe/colonne visibili */}
            <tr className="ui-riga-totale">
              {isGruppo && <Td>TOTALE</Td>}
              <Td colSpan={2}>
                {isGruppo ? `${righeFiltrate.length} camere` : `TOTALE — ${righeFiltrate.length} camere`}
              </Td>
              {colFinali.map(c => <Td key={c.key} num>{cell(totVisibile.cols[c.key] || 0)}</Td>)}
              <Td num tot>{cell(totVisibile.tot || 0)}</Td>
            </tr>
          </tbody>
        </Table>
      )}
    </div>
  )
}
