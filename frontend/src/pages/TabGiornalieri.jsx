import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { formatEuro, mostraErrore } from '../utils/format'
import {
  STRUTTURE_HOTEL, STRUTTURE_MANUALI, NOMI, NOME_CAT, thSt, tdSt, inpSt,
  isAdmin, fmtD, meseNome, primoGiorno, ultimoGiorno, giornoSettimana, applyToggle,
} from '../utils/corrispettiviHelpers'

// ── Drawer documenti ──────────────────────────────────────────────────────────

function DrawerDocumenti({ info, onClose }) {
  // info: { data, struttura_code, tipo ('scontrini'|'fatture'), categoria }
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState('')

  useEffect(() => {
    if (!info) return
    setLoading(true)
    setErrore('')
    const endpoint = info.tipo === 'fatture' ? '/corrispettivi/fatture' : '/corrispettivi/scontrini'
    api.get(endpoint, { params: { data_da: info.data, data_a: info.data, struttura_code: info.struttura_code, per_page: 100 } })
      .then(r => setDocs(r.data.documenti || []))
      .catch(e => { setDocs([]); setErrore(mostraErrore(e)) })
      .finally(() => setLoading(false))
  }, [info])

  if (!info) return null

  const docsFiltrati = info.categoria
    ? docs.filter(d => d.categoria === info.categoria)
    : docs

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: 480,
      background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
      zIndex: 1000, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong style={{ color: '#1e293b' }}>{info.tipo === 'fatture' ? 'Fatture' : 'Scontrini'} — {NOMI[info.struttura_code]}</strong>
          <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
            {fmtD(info.data)}{info.categoria ? ` · ${NOME_CAT[info.categoria]}` : ''}
          </p>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: '#94a3b8' }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem' }}>
        {loading ? (
          <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Caricamento…</p>
        ) : errore ? (
          <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{errore}</p>
        ) : docsFiltrati.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Nessun documento per questa selezione.</p>
        ) : docsFiltrati.map(d => (
          <div key={d.id} style={{
            border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.65rem 0.85rem',
            marginBottom: '0.5rem', opacity: d.annullato ? 0.45 : 1,
            borderLeft: d.modificato_manualmente ? '3px solid #f59e0b' : undefined,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem', color: d.annullato ? '#94a3b8' : '#1e293b' }}>
                {d.suffisso} {d.numero}{d.annullato ? ' · ANNULLATO' : ''}{d.modificato_manualmente ? ' ✏️' : ''}
              </span>
              <span style={{ fontWeight: 700, fontSize: '0.88rem', color: d.totale_lordo < 0 ? '#ef4444' : '#1e293b' }}>
                {formatEuro(d.totale_lordo)}
              </span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 3 }}>
              {d.camera && <span>Cam. {d.camera} · </span>}
              {d.intestazione && <span>{d.intestazione.split('\n')[0]} · </span>}
              <span style={{ background: '#f1f5f9', borderRadius: 3, padding: '1px 5px' }}>{NOME_CAT[d.categoria] || d.categoria}</span>
            </div>
            {d.ospiti && (
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>Ospiti: {d.ospiti}</div>
            )}
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>
              Imp. {formatEuro(d.imponibile)} · IVA {formatEuro(d.iva)} ({d.aliquota_pct}%)
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Tab Corrispettivi giornalieri ─────────────────────────────────────────────

export default function TabGiornalieri({ lordo }) {
  const oggi = new Date()
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [mese, setMese] = useState(oggi.getMonth() + 1)
  const [tipo, setTipo] = useState('tutti')  // 'scontrini' | 'fatture' | 'tutti'
  const [datiGG, setDatiGG] = useState([])
  const [manuali, setManuali] = useState({})     // key: "YYYY-MM-DD_MMS/BON" → lordo
  const [manualiDB, setManualiDB] = useState([]) // array dal DB
  const [manualiEdit, setManualiEdit] = useState({}) // edit in corso
  const [saving, setSaving] = useState({})
  const [check, setCheck] = useState(null)
  const [loading, setLoading] = useState(false)
  const [drawer, setDrawer] = useState(null)  // { data, struttura_code, tipo, categoria }

  const da = primoGiorno(anno, mese)
  const a = ultimoGiorno(anno, mese)

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const [rGG, rMan, rCheck] = await Promise.all([
        api.get('/corrispettivi/report/giornaliero', { params: { data_da: da, data_a: a, tipo } }),
        api.get('/corrispettivi/manuali', { params: { data_da: da, data_a: a } }),
        api.get('/corrispettivi/check', { params: { data_da: da, data_a: a } }),
      ])
      setDatiGG(rGG.data)
      setManualiDB(rMan.data)
      // Mappa manuali per chiave rapida
      const mm = {}
      rMan.data.forEach(m => { mm[`${m.data_giorno}_${m.struttura_code}`] = m.arrangiamenti_lordo })
      setManuali(mm)
      setCheck(rCheck.data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [da, a, tipo, lordo])

  useEffect(() => { carica() }, [carica])

  // Genera tutte le date del mese
  const giorni = []
  const cur = new Date(da + 'T00:00:00')
  const end = new Date(a + 'T00:00:00')
  while (cur <= end) {
    const y = cur.getFullYear()
    const m = String(cur.getMonth() + 1).padStart(2, '0')
    const d = String(cur.getDate()).padStart(2, '0')
    giorni.push(`${y}-${m}-${d}`)
    cur.setDate(cur.getDate() + 1)
  }

  // Indice dati per data
  const byData = {}
  datiGG.forEach(g => { byData[g.data] = g })

  const getStruttura = (data, sc) => {
    const g = byData[data]
    if (!g) return null
    return g.strutture?.find(s => s.struttura_code === sc) || null
  }

  const getCat = (struttura, catKey, tipoKey) => {
    if (!struttura) return 0
    return struttura[tipoKey]?.[catKey] || 0
  }

  const getTot = (struttura, tipoKey) => {
    if (!struttura) return 0
    if (tipoKey === 'tutti') return (struttura.scontrini?.totale || 0) + (struttura.fatture?.totale || 0)
    return struttura[tipoKey]?.totale || 0
  }

  // Totali mese per struttura
  const totMese = {}
  STRUTTURE_HOTEL.forEach(sc => {
    totMese[sc] = { arr: 0, ts: 0, pen: 0, shop: 0, alt: 0 }
  })
  STRUTTURE_MANUALI.forEach(sc => { totMese[sc] = { arr: 0 } })
  let totMeseGlobale = 0

  giorni.forEach(data => {
    const g = byData[data]
    STRUTTURE_HOTEL.forEach(sc => {
      const s = g?.strutture?.find(x => x.struttura_code === sc)
      if (!s) return
      const src = tipo === 'fatture' ? [s.fatture] : tipo === 'scontrini' ? [s.scontrini] : [s.scontrini, s.fatture]
      src.forEach(d => {
        if (!d) return
        totMese[sc].arr  += d.arrangiamenti || 0
        totMese[sc].ts   += d.tassa_soggiorno || 0
        totMese[sc].pen  += d.penali || 0
        totMese[sc].shop += d.shop || 0
        totMese[sc].alt  += d.altro || 0
      })
    })
    STRUTTURE_MANUALI.forEach(sc => {
      const lordo_m = parseFloat(manuali[`${data}_${sc}`] || 0)
      totMese[sc].arr += lordo_m
    })
  })
  giorni.forEach(data => { totMeseGlobale += byData[data]?.totale_giorno || 0 })

  // Salva manuale
  const salvaManuale = async (data, sc) => {
    const key = `${data}_${sc}`
    const val = parseFloat(manualiEdit[key] ?? manuali[key] ?? 0)
    setSaving(s => ({ ...s, [key]: true }))
    try {
      await api.post('/corrispettivi/manuali', {
        data_giorno: data, struttura_code: sc, arrangiamenti_lordo: val,
      })
      carica()
    } catch (e) {
      alert(mostraErrore(e, 'Errore salvataggio'))
    } finally {
      setSaving(s => ({ ...s, [key]: false }))
      setManualiEdit(e => { const n = { ...e }; delete n[key]; return n })
    }
  }

  const navMese = (delta) => {
    let m = mese + delta
    let a = anno
    if (m > 12) { m = 1; a++ }
    if (m < 1) { m = 12; a-- }
    setMese(m)
    setAnno(a)
  }

  const applyL = (v, aliq = 10) => lordo ? (v || 0) : applyToggle(v, lordo, aliq)
  const fmtL = (v, aliq = 10) => {
    const vv = applyL(v, aliq)
    return vv === 0 ? <span style={{ color: '#e2e8f0' }}>—</span> : formatEuro(vv)
  }

  const cellStyle = (v) => ({
    ...tdSt,
    color: v < 0 ? '#ef4444' : v === 0 ? '#e2e8f0' : '#1e293b',
    cursor: v !== 0 ? 'pointer' : 'default',
  })

  // Contatore giorni completati (entrambi MMS e BON inseriti con valore > 0)
  const giorniCompletati = giorni.filter(d => manuali[`${d}_MMS`] && manuali[`${d}_BON`]).length

  return (
    <div>
      {/* Navigazione mese */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button onClick={() => navMese(-1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9', border: '1px solid #e2e8f0' }}>←</button>
        <label title="Clicca per selezionare mese" style={{ cursor: 'pointer', position: 'relative', display: 'inline-block' }}>
          <span style={{ fontWeight: 700, fontSize: '1rem', minWidth: 120, textAlign: 'center', display: 'inline-block', padding: '4px 8px', borderRadius: 6, border: '1px solid transparent', userSelect: 'none' }}
            onMouseEnter={e => e.currentTarget.style.border = '1px solid #e2e8f0'}
            onMouseLeave={e => e.currentTarget.style.border = '1px solid transparent'}>
            {meseNome(mese)} {anno} ▾
          </span>
          <input type="month"
            value={`${anno}-${String(mese).padStart(2, '0')}`}
            onChange={e => {
              const [y, m] = e.target.value.split('-').map(Number)
              if (y && m) { setAnno(y); setMese(m) }
            }}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }} />
        </label>
        <button onClick={() => navMese(1)} style={{ ...inpSt, cursor: 'pointer', background: '#f1f5f9', border: '1px solid #e2e8f0' }}>→</button>

        {/* Toggle tipo */}
        <div style={{ display: 'flex', gap: 4, marginLeft: '0.5rem' }}>
          {[['tutti', 'Tutti'], ['scontrini', 'Scontrini'], ['fatture', 'Fatture']].map(([v, l]) => (
            <button key={v} onClick={() => setTipo(v)} style={{
              padding: '5px 12px', borderRadius: 6, border: '1px solid', fontSize: '0.82rem',
              cursor: 'pointer', fontWeight: tipo === v ? 700 : 400,
              background: tipo === v ? '#1e3a5f' : '#f8fafc',
              color: tipo === v ? '#fff' : '#64748b',
              borderColor: tipo === v ? '#1e3a5f' : '#e2e8f0',
            }}>{l}</button>
          ))}
        </div>
      </div>

      {loading && <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Caricamento…</p>}

      {/* Tabella principale */}
      <div style={{ overflowX: 'auto', fontSize: '0.78rem' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 900 }}>
          <thead>
            {/* Riga 1: strutture */}
            <tr style={{ background: '#1e3a5f', color: '#fff' }}>
              <th style={{ ...thSt, textAlign: 'left', minWidth: 70 }} rowSpan={2}>Data</th>
              {STRUTTURE_HOTEL.map(sc => (
                <th key={sc} style={{ ...thSt, textAlign: 'center', borderLeft: '2px solid #334e78' }} colSpan={5}>
                  {sc}
                </th>
              ))}
              <th style={{ ...thSt, textAlign: 'center', borderLeft: '2px solid #334e78' }}>MMS</th>
              <th style={{ ...thSt, textAlign: 'center', borderLeft: '1px solid #334e78' }}>BON</th>
              <th style={{ ...thSt, borderLeft: '2px solid #334e78' }}>TOT. GIORNO</th>
            </tr>
            {/* Riga 2: categorie */}
            <tr style={{ background: '#2d4f7c', color: '#cbd5e1' }}>
              {STRUTTURE_HOTEL.map(sc => (
                ['Arrangiamenti', 'Tassa di Soggiorno', 'Penali', 'Shop/ricariche', 'Tot.'].map((l, i) => (
                  <th key={`${sc}_${i}`} style={{
                    ...thSt, color: '#cbd5e1', fontSize: '0.7rem',
                    borderLeft: i === 0 ? '3px solid #4a6fa5' : '1px solid #3d6a9a',
                    fontWeight: i === 4 ? 700 : 400,
                  }}>{l}</th>
                ))
              ))}
              <th style={{ ...thSt, color: '#cbd5e1', borderLeft: '3px solid #4a6fa5', fontSize: '0.7rem' }}>Chiusura RT</th>
              <th style={{ ...thSt, color: '#cbd5e1', borderLeft: '1px solid #3d6a9a', fontSize: '0.7rem' }}>Chiusura RT</th>
              <th style={{ ...thSt, borderLeft: '3px solid #4a6fa5' }} />
            </tr>
          </thead>
          <tbody>
            {giorni.map((data, idx) => {
              const g = byData[data]
              const gg = giornoSettimana(data)
              const isSab = gg === 'sab'
              const rigaBg = isSab ? '#eff6ff' : idx % 2 === 0 ? '#fff' : '#f8fafc'
              let totGiorno = g?.totale_giorno || 0

              return (
                <tr key={data} style={{ background: rigaBg }}>
                  <td style={{ ...tdSt, textAlign: 'left', fontWeight: isSab ? 700 : 400, color: '#475569' }}>
                    {fmtD(data)} <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>{gg}</span>
                  </td>

                  {STRUTTURE_HOTEL.map(sc => {
                    const s = g?.strutture?.find(x => x.struttura_code === sc)
                    const getCombinato = (cat) => {
                      if (tipo === 'tutti') return (s?.scontrini?.[cat] || 0) + (s?.fatture?.[cat] || 0)
                      return s?.[tipo === 'scontrini' ? 'scontrini' : 'fatture']?.[cat] || 0
                    }
                    // Totale netto: somma per categoria con aliquote corrette (no media singola)
                    const cats4 = [['arrangiamenti', 10], ['tassa_soggiorno', 0], ['penali', 0], ['shop', 22]]
                    const totNetto = cats4.reduce((sum, [cat, aliq]) =>
                      sum + applyToggle(getCombinato(cat), lordo, aliq), 0
                    ) + applyToggle(getCombinato('altro'), lordo, 10)
                    const totS = getTot(s, tipo === 'tutti' ? 'tutti' : tipo === 'fatture' ? 'fatture' : 'scontrini')

                    return cats4.map(([cat, aliq], i) => {
                      const v = getCombinato(cat)
                      return (
                        <td key={`${sc}_${cat}`} style={{
                          ...cellStyle(v),
                          borderLeft: i === 0 ? '3px solid #7baec8' : '1px solid #86a8bf',
                        }}
                          onClick={() => v !== 0 && setDrawer({ data, struttura_code: sc, tipo: tipo === 'tutti' ? 'scontrini' : tipo, categoria: cat })}
                          title={v !== 0 ? 'Clicca per vedere documenti' : undefined}
                        >
                          {fmtL(v, aliq)}
                        </td>
                      )
                    }).concat(
                      <td key={`${sc}_tot`} style={{
                        ...tdSt, fontWeight: 700, borderLeft: '1px solid #86a8bf',
                        color: totNetto < 0 ? '#ef4444' : totNetto === 0 ? '#e2e8f0' : '#1e293b',
                        cursor: totS !== 0 ? 'pointer' : 'default',
                      }}
                        onClick={() => totS !== 0 && setDrawer({ data, struttura_code: sc, tipo: tipo === 'tutti' ? 'scontrini' : tipo })}
                      >
                        {totNetto === 0 ? <span style={{ color: '#e2e8f0' }}>—</span> : formatEuro(totNetto)}
                      </td>
                    )
                  })}

                  {/* MMS */}
                  <td style={{ ...tdSt, borderLeft: '3px solid #7baec8' }}>
                    {(manuali[`${data}_MMS`] || 0) > 0
                      ? fmtL(parseFloat(manuali[`${data}_MMS`] || 0))
                      : <span style={{ color: '#e2e8f0' }}>—</span>}
                  </td>
                  {/* BON */}
                  <td style={{ ...tdSt, borderLeft: '1px solid #86a8bf' }}>
                    {(manuali[`${data}_BON`] || 0) > 0
                      ? fmtL(parseFloat(manuali[`${data}_BON`] || 0))
                      : <span style={{ color: '#e2e8f0' }}>—</span>}
                  </td>
                  {/* Totale giorno */}
                  <td style={{ ...tdSt, fontWeight: 700, borderLeft: '3px solid #7baec8', color: totGiorno === 0 ? '#e2e8f0' : '#1e293b' }}>
                    {totGiorno === 0 ? '—' : formatEuro(totGiorno)}
                  </td>
                </tr>
              )
            })}

            {/* Riga totale mese */}
            <tr className="riga-totale" style={{ background: '#1e3a5f', color: '#fff', fontWeight: 700 }}>
              <td style={{ ...tdSt, color: '#fff', borderBottom: 'none', textAlign: 'left' }}>TOTALE</td>
              {STRUTTURE_HOTEL.map(sc => (
                [
                  [totMese[sc].arr, 10],
                  [totMese[sc].ts, 0],
                  [totMese[sc].pen, 0],
                  [totMese[sc].shop, 22],
                ].map(([v, aliq], i) => (
                  <td key={`tot_${sc}_${i}`} style={{
                    ...tdSt, color: '#fff', borderBottom: 'none',
                    borderLeft: i === 0 ? '3px solid #4a6fa5' : '1px solid #3d6a9a',
                  }}>
                    {applyL(v, aliq) === 0 ? '—' : formatEuro(applyL(v, aliq))}
                  </td>
                )).concat(
                  <td key={`tot_${sc}_t`} style={{ ...tdSt, color: '#fff', fontWeight: 800, borderBottom: 'none' }}>
                    {(() => {
                      const t = applyL(totMese[sc].arr, 10) + totMese[sc].ts + totMese[sc].pen + applyL(totMese[sc].shop, 22) + applyL(totMese[sc].alt, 10)
                      return t === 0 ? '—' : formatEuro(t)
                    })()}
                  </td>
                )
              ))}
              <td style={{ ...tdSt, color: '#fff', borderBottom: 'none', borderLeft: '3px solid #4a6fa5' }}>
                {totMese['MMS'].arr === 0 ? '—' : formatEuro(applyL(totMese['MMS'].arr))}
              </td>
              <td style={{ ...tdSt, color: '#fff', borderBottom: 'none', borderLeft: '1px solid #4a6fa5' }}>
                {totMese['BON'].arr === 0 ? '—' : formatEuro(applyL(totMese['BON'].arr))}
              </td>
              <td style={{ ...tdSt, color: '#fff', fontWeight: 800, borderBottom: 'none', borderLeft: '3px solid #4a6fa5' }}>
                {totMeseGlobale === 0 ? '—' : formatEuro(totMeseGlobale)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Sezione inserimento manuale MMS/BON */}
      {isAdmin() && (
        <div style={{
          marginTop: '1.5rem', border: '1px solid #e2e8f0', borderRadius: 10,
          padding: '1rem 1.25rem', background: '#fafafa',
        }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem', color: '#1e293b' }}>
            Inserimento manuale — Maremosso (MMS) e Buona Onda (BON)
          </h3>
          <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 0.75rem' }}>
            Inserire il totale lordo (IVA 10% inclusa). Il sistema calcola automaticamente imponibile e IVA.
          </p>

          <p style={{ fontSize: '0.78rem', color: giorniCompletati === giorni.length ? '#22c55e' : '#64748b', margin: '0 0 0.75rem' }}>
            {giorniCompletati === giorni.length
              ? `✓ Tutti i ${giorni.length} giorni del mese sono stati inseriti.`
              : `${giorniCompletati} / ${giorni.length} giorni inseriti`}
          </p>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                {['Data', 'MMS lordo (€)', '', 'BON lordo (€)', ''].map((h, i) => (
                  <th key={i} style={{ ...thSt, textAlign: i === 0 ? 'left' : 'right', padding: '6px 10px', color: '#475569' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {giorni.map((data) => {
                const keyMMS = `${data}_MMS`
                const keyBON = `${data}_BON`
                const valMMS = manualiEdit[keyMMS] ?? manuali[keyMMS] ?? ''
                const valBON = manualiEdit[keyBON] ?? manuali[keyBON] ?? ''
                const salvMMS = !!manuali[keyMMS]
                const salvBON = !!manuali[keyBON]
                const inpMMS = { ...inpSt, width: 90, textAlign: 'right', border: `2px solid ${salvMMS ? '#16a34a' : '#f59e0b'}` }
                const inpBON = { ...inpSt, width: 90, textAlign: 'right', border: `2px solid ${salvBON ? '#16a34a' : '#f59e0b'}` }
                return (
                  <tr key={data}>
                    <td style={{ ...tdSt, textAlign: 'left' }}>
                      {fmtD(data)} {giornoSettimana(data)}
                    </td>
                    <td style={tdSt}>
                      <input type="number" step="0.01" min="0" value={valMMS}
                        placeholder="0.00"
                        onChange={e => setManualiEdit(v => ({ ...v, [keyMMS]: e.target.value }))}
                        style={inpMMS} />
                    </td>
                    <td style={tdSt}>
                      <button onClick={() => salvaManuale(data, 'MMS')} disabled={saving[keyMMS]}
                        style={{ ...inpSt, cursor: 'pointer', background: '#1e3a5f', color: '#fff', border: 'none', fontSize: '0.78rem', padding: '4px 10px' }}>
                        {saving[keyMMS] ? '…' : 'Salva'}
                      </button>
                    </td>
                    <td style={tdSt}>
                      <input type="number" step="0.01" min="0" value={valBON}
                        placeholder="0.00"
                        onChange={e => setManualiEdit(v => ({ ...v, [keyBON]: e.target.value }))}
                        style={inpBON} />
                    </td>
                    <td style={tdSt}>
                      <button onClick={() => salvaManuale(data, 'BON')} disabled={saving[keyBON]}
                        style={{ ...inpSt, cursor: 'pointer', background: '#1e3a5f', color: '#fff', border: 'none', fontSize: '0.78rem', padding: '4px 10px' }}>
                        {saving[keyBON] ? '…' : 'Salva'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sezione CHECK */}
      {check && (() => {
        const hotelConDati = STRUTTURE_HOTEL.filter(sc => (check[sc] || 0) > 0)
        const tuttiOk = hotelConDati.length === STRUTTURE_HOTEL.length
        const nessunDato = hotelConDati.length === 0
        const semaforo = nessunDato ? { bg: '#fef2f2', border: '#fca5a5', dot: '#ef4444', label: 'Nessun dato hotel' }
          : tuttiOk ? { bg: '#f0fdf4', border: '#86efac', dot: '#16a34a', label: 'Tutte le strutture presenti' }
          : { bg: '#fffbeb', border: '#fcd34d', dot: '#d97706', label: `${hotelConDati.length}/${STRUTTURE_HOTEL.length} hotel con dati` }
        return (
          <div style={{ marginTop: '1.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ flex: 1, minWidth: 280, border: `1.5px solid ${semaforo.border}`, background: semaforo.bg, borderRadius: 10, padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.5rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: semaforo.dot, display: 'inline-block', flexShrink: 0 }} />
                <h4 style={{ margin: 0, fontSize: '0.88rem', color: '#475569' }}>
                  Hotel ({check.label_hotel}) — <span style={{ color: semaforo.dot, fontWeight: 700 }}>{semaforo.label}</span>
                </h4>
              </div>
              {STRUTTURE_HOTEL.map(sc => {
                const v = check[sc] || 0
                const presente = v > 0
                return (
                  <div key={sc} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: '0.85rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#475569' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: presente ? '#16a34a' : '#d1d5db', display: 'inline-block' }} />
                      {sc}
                    </span>
                    <span style={{ fontWeight: 600, color: presente ? '#1e293b' : '#94a3b8' }}>{formatEuro(v)}</span>
                  </div>
                )
              })}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', marginTop: 6, paddingTop: 6, fontWeight: 700 }}>
                <span>TOTALE HOTEL</span>
                <span>{formatEuro(check.totale_hotel || 0)}</span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 200, border: '1.5px solid #fcd34d', borderRadius: 10, padding: '1rem 1.25rem', background: '#fffbeb' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', color: '#b45309' }}>
                Ristoranti ({check.label_ristoranti})
              </h4>
              {STRUTTURE_MANUALI.map(sc => {
                const v = check[sc] || 0
                return (
                  <div key={sc} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: '0.85rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#475569' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: v > 0 ? '#f59e0b' : '#d1d5db', display: 'inline-block' }} />
                      {NOMI[sc]}
                    </span>
                    <span style={{ fontWeight: 600, color: v > 0 ? '#1e293b' : '#94a3b8' }}>{formatEuro(v)}</span>
                  </div>
                )
              })}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #fcd34d', marginTop: 6, paddingTop: 6, fontWeight: 700 }}>
                <span>TOTALE RISTORANTI</span>
                <span>{formatEuro(check.totale_ristoranti || 0)}</span>
              </div>
            </div>
            {/* Box per sede fisica */}
            {(() => {
              const sedi = [
                { label: 'Du Parc', strutture: ['DPH', 'MMS'], color: '#1e3a5f' },
                { label: 'Club Hotel', strutture: ['CLB'], color: '#0ea5e9' },
                { label: 'International', strutture: ['INT', 'BON'], color: '#6366f1' },
              ]
              const totSedi = sedi.reduce((sum, s) => sum + s.strutture.reduce((a, sc) => a + (check[sc] || 0), 0), 0)
              return (
                <div style={{ flex: 1, minWidth: 220, border: '1.5px solid #67e8f9', borderRadius: 10, padding: '1rem 1.25rem', background: '#ecfeff' }}>
                  <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', color: '#0891b2' }}>
                    Per sede fisica
                  </h4>
                  {sedi.map(({ label, strutture, color }) => {
                    const v = strutture.reduce((sum, sc) => sum + (check[sc] || 0), 0)
                    const dettaglio = strutture.map(sc => NOMI[sc]).join(' + ')
                    return (
                      <div key={label} style={{ padding: '4px 0', fontSize: '0.85rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: v > 0 ? color : '#d1d5db', display: 'inline-block', flexShrink: 0 }} />
                            <span style={{ fontWeight: 600, color: '#1e293b' }}>{label}</span>
                          </span>
                          <span style={{ fontWeight: 700, color: v > 0 ? '#1e293b' : '#94a3b8' }}>{formatEuro(v)}</span>
                        </div>
                        {strutture.length > 1 && (
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8', paddingLeft: 12 }}>{dettaglio}</div>
                        )}
                      </div>
                    )
                  })}
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #67e8f9', marginTop: 6, paddingTop: 6, fontWeight: 700 }}>
                    <span>TOTALE SEDI</span>
                    <span>{formatEuro(totSedi)}</span>
                  </div>
                </div>
              )
            })()}
            <div style={{
              alignSelf: 'center', background: '#1e3a5f', color: '#fff',
              borderRadius: 10, padding: '1rem 1.5rem', textAlign: 'center', minWidth: 160,
              border: `3px solid ${semaforo.dot}`,
            }}>
              <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>TOTALE GENERALE</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: 4 }}>
                {formatEuro(check.totale_generale || 0)}
              </div>
              <div style={{ marginTop: 6, fontSize: '0.72rem', background: semaforo.dot, borderRadius: 4, padding: '2px 6px', display: 'inline-block' }}>
                {semaforo.label}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Drawer documenti */}
      {drawer && <DrawerDocumenti info={drawer} onClose={() => setDrawer(null)} />}
      {drawer && (
        <div onClick={() => setDrawer(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.1)' }} />
      )}
    </div>
  )
}
