import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { formatEuro, mostraErrore } from '../utils/format'
import {
  STRUTTURE_HOTEL, STRUTTURE_MANUALI, NOMI, NOME_CAT,
  isAdmin, fmtD, primoGiorno, ultimoGiorno, giornoSettimana, applyToggle,
} from '../utils/corrispettiviHelpers'
import {
  Badge, Button, Card, Dot, Drawer, Field, Input, Loading, Messaggio, Modal, NavMese, SectionTitle,
  SegmentedControl, StatoVuoto, Table, Td, Th, useAvvisi,
} from '../components/ui'
import { colors, coloreStruttura } from '../styles/tokens.js'

const VUOTO = colors.borderStrong

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
    <Drawer
      titolo={`${info.tipo === 'fatture' ? 'Fatture' : 'Scontrini'} — ${NOMI[info.struttura_code]}`}
      sottotitolo={`${fmtD(info.data)}${info.categoria ? ` · ${NOME_CAT[info.categoria]}` : ''}`}
      onChiudi={onClose}
    >
      {loading ? (
        <Loading />
      ) : errore ? (
        <Messaggio tipo="err">{errore}</Messaggio>
      ) : docsFiltrati.length === 0 ? (
        <StatoVuoto>Nessun documento per questa selezione.</StatoVuoto>
      ) : docsFiltrati.map(d => (
        <div key={d.id} className="ui-drawer-item" style={{
          opacity: d.annullato ? 0.45 : 1,
          boxShadow: d.modificato_manualmente ? `inset 3px 0 0 ${colors.warning}` : undefined,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, color: d.annullato ? colors.textSubtle : colors.text }}>
              {d.suffisso} {d.numero}{d.annullato ? ' · ANNULLATO' : ''}{d.modificato_manualmente ? ' ✏️' : ''}
            </span>
            <span className="ui-num" style={{ fontWeight: 700, color: d.totale_lordo < 0 ? colors.danger : colors.text }}>
              {formatEuro(d.totale_lordo)}
            </span>
          </div>
          <div className="ui-text-muted" style={{ marginTop: 3 }}>
            {d.camera && <span>Cam. {d.camera} · </span>}
            {d.intestazione && <span>{d.intestazione.split('\n')[0]} · </span>}
            <Badge>{NOME_CAT[d.categoria] || d.categoria}</Badge>
          </div>
          {d.ospiti && (
            <div style={{ fontSize: 'var(--fs-xs)', color: colors.textSubtle, marginTop: 2 }}>Ospiti: {d.ospiti}</div>
          )}
          <div className="ui-num" style={{ fontSize: 'var(--fs-xs)', color: colors.textSubtle, marginTop: 2 }}>
            Imp. {formatEuro(d.imponibile)} · IVA {formatEuro(d.iva)} ({d.aliquota_pct}%)
          </div>
        </div>
      ))}
    </Drawer>
  )
}

// ── Modale incasso manuale MMS/BON ────────────────────────────────────────────
// MMS (Maremosso) e BON (Buona Onda) incassano solo in due forme: contante e pagamento
// elettronico. Si parte dal totale lordo del giorno, si inserisce la quota elettronica,
// il contante è la differenza (calcolato). Salva su corrispettivi_manuali con la
// ripartizione (incasso_contante/incasso_elettronico; bonifico/assegno azzerati) —
// arrangiamenti_lordo resta il totale.

function ModaleIncassoManuale({ info, onClose, onSalvato }) {
  const [totale, setTotale] = useState(info.row?.arrangiamenti_lordo ?? '')
  const [elettronico, setElettronico] = useState(info.row?.incasso_elettronico ?? '')
  const [saving, setSaving] = useState(false)
  const [errore, setErrore] = useState(null)

  const tot = parseFloat(totale) || 0
  const elett = parseFloat(elettronico) || 0
  const contante = Math.round((tot - elett) * 100) / 100
  const elettEccessivo = elett > tot + 0.001

  const salva = async () => {
    if (elettEccessivo) { setErrore('Il pagamento elettronico non può superare il totale.'); return }
    setSaving(true)
    setErrore(null)
    try {
      await api.post('/corrispettivi/manuali', {
        data_giorno: info.data,
        struttura_code: info.struttura_code,
        arrangiamenti_lordo: tot,
        incasso_contante: contante,
        incasso_elettronico: elett,
        incasso_bonifico: 0,
        incasso_assegno: 0,
      })
      onSalvato()
      onClose()
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore salvataggio'))
    } finally {
      setSaving(false)
    }
  }

  const pieno = { width: '100%', textAlign: 'right' }

  return (
    <Modal
      titolo={`${NOMI[info.struttura_code]} — ${fmtD(info.data)}`}
      onChiudi={onClose}
      larghezza={360}
      footer={<>
        <Button variant="secondary" onClick={onClose}>Annulla</Button>
        <Button onClick={salva} disabled={saving || elettEccessivo}>{saving ? 'Salvataggio…' : 'Salva'}</Button>
      </>}
    >
      <div style={{ whiteSpace: 'normal', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="ui-text-muted" style={{ marginTop: -4 }}>Incasso del giorno (lordo, IVA 10% inclusa)</div>

        <Field label="Totale incasso" style={{ width: '100%' }}>
          <Input type="number" step="0.01" min="0" value={totale} placeholder="0.00" className="ui-num"
            onChange={e => setTotale(e.target.value)} style={{ ...pieno, fontWeight: 700 }} autoFocus />
        </Field>

        <div style={{ borderTop: `1px solid ${colors.border}` }} />

        <Field label="Pagamento elettronico" style={{ width: '100%' }}>
          <Input type="number" step="0.01" min="0" value={elettronico} placeholder="0.00" className="ui-num"
            onChange={e => setElettronico(e.target.value)} style={pieno} />
        </Field>

        <Field label="Contante (calcolato)" style={{ width: '100%' }}>
          <Input type="text" readOnly value={formatEuro(contante)} className="ui-num"
            style={{ ...pieno, background: colors.surfaceAlt, color: elettEccessivo ? colors.danger : colors.text }} />
        </Field>

        <Messaggio tipo="err">{errore}</Messaggio>
      </div>
    </Modal>
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
  const [check, setCheck] = useState(null)
  const [loading, setLoading] = useState(false)
  const [drawer, setDrawer] = useState(null)  // { data, struttura_code, tipo, categoria }
  const [modaleIncasso, setModaleIncasso] = useState(null)  // { data, struttura_code, row }
  const avvisi = useAvvisi()

  const da = primoGiorno(anno, mese)
  const a = ultimoGiorno(anno, mese)

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const [rGG, rMan, rCheck] = await Promise.all([
        api.get('/corrispettivi/report/giornaliero', { params: { data_da: da, data_a: a, tipo } }),
        api.get('/corrispettivi/manuali', { params: { data_da: da, data_a: a } }),
        api.get('/corrispettivi/check', { params: { data_da: da, data_a: a, lordo } }),
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

  const applyL = (v, aliq = 10) => lordo ? (v || 0) : applyToggle(v, lordo, aliq)
  const fmtL = (v, aliq = 10) => {
    const vv = applyL(v, aliq)
    return vv === 0 ? <span style={{ color: VUOTO }}>—</span> : formatEuro(vv)
  }

  const cellStyle = (v) => ({
    color: v < 0 ? colors.danger : v === 0 ? VUOTO : undefined,
    cursor: v !== 0 ? 'pointer' : 'default',
  })

  // Contatore giorni completati (entrambi MMS e BON inseriti con valore > 0)
  const giorniCompletati = giorni.filter(d => manuali[`${d}_MMS`] && manuali[`${d}_BON`]).length

  const esportaExcel = async () => {
    try {
      const res = await api.get('/corrispettivi/export/giornaliero', {
        params: { anno, mese, tipo, lordo },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `corrispettivi_giornaliero_${anno}_${String(mese).padStart(2, '0')}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore export'))
    }
  }

  // Riga "voce — importo" dei riquadri di CHECK
  const RigaCheck = ({ colore, etichetta, valore, sotto }) => (
    <div style={{ padding: '3px 0', fontSize: 'var(--fs-base)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.textSecond }}>
          <Dot colore={valore > 0 ? colore : colors.borderStrong} />{etichetta}
        </span>
        <span className="ui-num" style={{ fontWeight: 600, color: valore > 0 ? colors.text : colors.textSubtle }}>{formatEuro(valore)}</span>
      </div>
      {sotto && <div style={{ fontSize: 'var(--fs-xs)', color: colors.textSubtle, paddingLeft: 15 }}>{sotto}</div>}
    </div>
  )
  const RigaTotaleCheck = ({ etichetta, valore }) => (
    <div className="ui-num" style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${colors.border}`, marginTop: 6, paddingTop: 6, fontWeight: 700 }}>
      <span>{etichetta}</span><span>{formatEuro(valore)}</span>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <NavMese anno={anno} mese={mese} selettore onChange={({ anno: y, mese: m }) => { setAnno(y); setMese(m) }} />
        <SegmentedControl value={tipo} onChange={setTipo}
          options={[{ value: 'tutti', label: 'Tutti' }, { value: 'scontrini', label: 'Scontrini' }, { value: 'fatture', label: 'Fatture' }]} />
        <Button variant="secondary" size="sm" onClick={esportaExcel} style={{ marginLeft: 'auto' }}>⬇ Esporta Excel</Button>
      </div>

      {loading && <Loading />}

      {/* Tabella principale */}
      <Table compact minWidth={900}>
        <thead>
          {/* Riga 1: strutture */}
          <tr>
            <Th rowSpan={2} style={{ minWidth: 80, verticalAlign: 'bottom' }}>Data</Th>
            {STRUTTURE_HOTEL.map(sc => <Th key={sc} center gruppo colSpan={5}>{sc}</Th>)}
            <Th center gruppo>MMS</Th>
            <Th center>BON</Th>
            <Th num tot rowSpan={2} style={{ verticalAlign: 'bottom' }}>TOT. GIORNO</Th>
          </tr>
          {/* Riga 2: categorie */}
          <tr className="sub">
            {STRUTTURE_HOTEL.map(sc => (
              ['Arrangiamenti', 'Tassa di Soggiorno', 'Penali', 'Shop/ricariche', 'Tot.'].map((l, i) => (
                <Th key={`${sc}_${i}`} num gruppo={i === 0} style={i === 4 ? { fontWeight: 700 } : undefined}>{l}</Th>
              ))
            ))}
            <Th num gruppo>Chiusura RT</Th>
            <Th num>Chiusura RT</Th>
          </tr>
        </thead>
        <tbody>
          {giorni.map(data => {
            const g = byData[data]
            const gg = giornoSettimana(data)
            const isSab = gg === 'sab'
            let totGiorno = g?.totale_giorno || 0

            return (
              <tr key={data} className={isSab ? 'ui-riga-evidenza' : undefined}>
                <Td style={{ fontWeight: isSab ? 700 : 400, color: colors.textSecond, whiteSpace: 'nowrap' }}>
                  {fmtD(data)} <span style={{ color: colors.textSubtle, fontSize: 'var(--fs-xs)' }}>{gg}</span>
                </Td>

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
                      <Td key={`${sc}_${cat}`} num gruppo={i === 0} style={cellStyle(v)}
                        onClick={() => v !== 0 && setDrawer({ data, struttura_code: sc, tipo: tipo === 'tutti' ? 'scontrini' : tipo, categoria: cat })}
                        title={v !== 0 ? 'Clicca per vedere documenti' : undefined}
                      >
                        {fmtL(v, aliq)}
                      </Td>
                    )
                  }).concat(
                    <Td key={`${sc}_tot`} num style={{
                      fontWeight: 700,
                      color: totNetto < 0 ? colors.danger : totNetto === 0 ? VUOTO : undefined,
                      cursor: totS !== 0 ? 'pointer' : 'default',
                    }}
                      onClick={() => totS !== 0 && setDrawer({ data, struttura_code: sc, tipo: tipo === 'tutti' ? 'scontrini' : tipo })}
                    >
                      {totNetto === 0 ? '—' : formatEuro(totNetto)}
                    </Td>
                  )
                })}

                {/* MMS */}
                <Td num gruppo>
                  {(manuali[`${data}_MMS`] || 0) > 0 ? fmtL(parseFloat(manuali[`${data}_MMS`] || 0)) : <span style={{ color: VUOTO }}>—</span>}
                </Td>
                {/* BON */}
                <Td num>
                  {(manuali[`${data}_BON`] || 0) > 0 ? fmtL(parseFloat(manuali[`${data}_BON`] || 0)) : <span style={{ color: VUOTO }}>—</span>}
                </Td>
                {/* Totale giorno */}
                <Td num tot style={{ fontWeight: 700, color: totGiorno === 0 ? VUOTO : undefined }}>
                  {totGiorno === 0 ? '—' : formatEuro(totGiorno)}
                </Td>
              </tr>
            )
          })}

          {/* Riga totale mese */}
          <tr className="ui-riga-totale">
            <Td>TOTALE</Td>
            {STRUTTURE_HOTEL.map(sc => (
              [
                [totMese[sc].arr, 10],
                [totMese[sc].ts, 0],
                [totMese[sc].pen, 0],
                [totMese[sc].shop, 22],
              ].map(([v, aliq], i) => (
                <Td key={`tot_${sc}_${i}`} num gruppo={i === 0}>
                  {applyL(v, aliq) === 0 ? '—' : formatEuro(applyL(v, aliq))}
                </Td>
              )).concat(
                <Td key={`tot_${sc}_t`} num style={{ fontWeight: 800 }}>
                  {(() => {
                    const t = applyL(totMese[sc].arr, 10) + totMese[sc].ts + totMese[sc].pen + applyL(totMese[sc].shop, 22) + applyL(totMese[sc].alt, 10)
                    return t === 0 ? '—' : formatEuro(t)
                  })()}
                </Td>
              )
            ))}
            <Td num gruppo>{totMese['MMS'].arr === 0 ? '—' : formatEuro(applyL(totMese['MMS'].arr))}</Td>
            <Td num>{totMese['BON'].arr === 0 ? '—' : formatEuro(applyL(totMese['BON'].arr))}</Td>
            <Td num tot style={{ fontWeight: 800 }}>{totMeseGlobale === 0 ? '—' : formatEuro(totMeseGlobale)}</Td>
          </tr>
        </tbody>
      </Table>

      {/* Sezione inserimento manuale MMS/BON */}
      {isAdmin() && (
        <Card title="Inserimento manuale — Maremosso (MMS) e Buona Onda (BON)" style={{ marginTop: 24 }}>
          <p className="ui-text-muted" style={{ margin: '0 0 8px' }}>
            Inserire il totale lordo del giorno (IVA 10% inclusa) e la quota di pagamento
            elettronico. Il contante è calcolato come differenza; imponibile e IVA sono automatici.
          </p>
          <p style={{ fontSize: 'var(--fs-sm)', color: giorniCompletati === giorni.length ? colors.success : colors.textMuted, margin: '0 0 12px', fontWeight: giorniCompletati === giorni.length ? 600 : 400 }}>
            {giorniCompletati === giorni.length
              ? `✓ Tutti i ${giorni.length} giorni del mese sono stati inseriti.`
              : `${giorniCompletati} / ${giorni.length} giorni inseriti`}
          </p>
          <Table compact style={{ display: 'inline-block', maxWidth: '100%' }}>
            <thead>
              <tr><Th>Data</Th><Th num>MMS</Th><Th></Th><Th num gruppo>BON</Th><Th></Th></tr>
            </thead>
            <tbody>
              {giorni.map((data) => {
                const rowMMS = manualiDB.find(m => m.data_giorno === data && m.struttura_code === 'MMS')
                const rowBON = manualiDB.find(m => m.data_giorno === data && m.struttura_code === 'BON')
                const totMMS = manuali[`${data}_MMS`] || 0
                const totBON = manuali[`${data}_BON`] || 0
                return (
                  <tr key={data}>
                    <Td style={{ whiteSpace: 'nowrap' }}>{fmtD(data)} <span style={{ color: colors.textSubtle }}>{giornoSettimana(data)}</span></Td>
                    <Td num style={{ color: totMMS ? undefined : colors.textSubtle, fontWeight: totMMS ? 600 : 400 }}>
                      {totMMS ? formatEuro(totMMS) : '—'}
                    </Td>
                    <Td>
                      <Button size="sm" variant={rowMMS ? 'secondary' : 'primary'}
                        onClick={() => setModaleIncasso({ data, struttura_code: 'MMS', row: rowMMS })}>
                        {rowMMS ? 'Modifica' : 'Inserisci'}
                      </Button>
                    </Td>
                    <Td num gruppo style={{ color: totBON ? undefined : colors.textSubtle, fontWeight: totBON ? 600 : 400 }}>
                      {totBON ? formatEuro(totBON) : '—'}
                    </Td>
                    <Td>
                      <Button size="sm" variant={rowBON ? 'secondary' : 'primary'}
                        onClick={() => setModaleIncasso({ data, struttura_code: 'BON', row: rowBON })}>
                        {rowBON ? 'Modifica' : 'Inserisci'}
                      </Button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {modaleIncasso && (
        <ModaleIncassoManuale info={modaleIncasso} onClose={() => setModaleIncasso(null)} onSalvato={carica} />
      )}

      {/* Sezione CHECK */}
      {check && (() => {
        const hotelConDati = STRUTTURE_HOTEL.filter(sc => (check[sc] || 0) > 0)
        const tuttiOk = hotelConDati.length === STRUTTURE_HOTEL.length
        const nessunDato = hotelConDati.length === 0
        const semaforo = nessunDato ? { tono: 'err', colore: colors.danger, label: 'Nessun dato hotel' }
          : tuttiOk ? { tono: 'ok', colore: colors.success, label: 'Tutte le strutture presenti' }
          : { tono: 'warn', colore: colors.warning, label: `${hotelConDati.length}/${STRUTTURE_HOTEL.length} hotel con dati` }
        const sedi = [
          { label: 'Du Parc', strutture: ['DPH', 'MMS'], colore: coloreStruttura('DPH') },
          { label: 'Club Hotel', strutture: ['CLB'], colore: coloreStruttura('CLB') },
          { label: 'International', strutture: ['INT', 'BON'], colore: coloreStruttura('INT') },
        ]
        const totSedi = sedi.reduce((sum, s) => sum + s.strutture.reduce((a, sc) => a + (check[sc] || 0), 0), 0)
        return (
          <div style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Card style={{ flex: 1, minWidth: 280, boxShadow: `inset 4px 0 0 ${semaforo.colore}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <SectionTitle as="h4" style={{ margin: 0, fontSize: 'var(--fs-md)' }}>Hotel ({check.label_hotel})</SectionTitle>
                <Badge tono={semaforo.tono}>{semaforo.label}</Badge>
              </div>
              {STRUTTURE_HOTEL.map(sc => (
                <RigaCheck key={sc} colore={coloreStruttura(sc)} etichetta={sc} valore={check[sc] || 0} />
              ))}
              <RigaTotaleCheck etichetta="TOTALE HOTEL" valore={check.totale_hotel || 0} />
            </Card>
            <Card style={{ flex: 1, minWidth: 220 }}>
              <SectionTitle as="h4" style={{ margin: '0 0 8px', fontSize: 'var(--fs-md)' }}>Ristoranti ({check.label_ristoranti})</SectionTitle>
              {STRUTTURE_MANUALI.map(sc => (
                <RigaCheck key={sc} colore={coloreStruttura(sc)} etichetta={NOMI[sc]} valore={check[sc] || 0} />
              ))}
              <RigaTotaleCheck etichetta="TOTALE RISTORANTI" valore={check.totale_ristoranti || 0} />
            </Card>
            <Card style={{ flex: 1, minWidth: 220 }}>
              <SectionTitle as="h4" style={{ margin: '0 0 8px', fontSize: 'var(--fs-md)' }}>Per sede fisica</SectionTitle>
              {sedi.map(({ label, strutture, colore }) => (
                <RigaCheck key={label} colore={colore} etichetta={<strong style={{ color: colors.text }}>{label}</strong>}
                  valore={strutture.reduce((sum, sc) => sum + (check[sc] || 0), 0)}
                  sotto={strutture.length > 1 ? strutture.map(sc => NOMI[sc]).join(' + ') : null} />
              ))}
              <RigaTotaleCheck etichetta="TOTALE SEDI" valore={totSedi} />
            </Card>
            <div style={{
              alignSelf: 'center', background: colors.primary, color: '#fff',
              borderRadius: 10, padding: '16px 24px', textAlign: 'center', minWidth: 170,
              border: `3px solid ${semaforo.colore}`,
            }}>
              <div style={{ fontSize: 'var(--fs-sm)', opacity: 0.8 }}>TOTALE GENERALE</div>
              <div className="ui-num" style={{ fontSize: 'var(--fs-xxl)', fontWeight: 700, marginTop: 4 }}>
                {formatEuro(check.totale_generale || 0)}
              </div>
              <div style={{ marginTop: 6 }}><Badge tono={semaforo.tono}>{semaforo.label}</Badge></div>
            </div>
          </div>
        )
      })()}

      {/* Drawer documenti */}
      {drawer && <DrawerDocumenti info={drawer} onClose={() => setDrawer(null)} />}
    </div>
  )
}
