import React, { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api/client'
import { formatEuro, formatPerc, mostraErrore } from '../utils/format.js'
import {
  Dot, Loading, Messaggio, NavMese, SectionTitle, SegmentedControl, Table, Td, Th, useAvvisi,
} from '../components/ui'
import { colors } from '../styles/tokens.js'

const MESI = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

// Maremosso (MMS) non ha una colonna propria qui: stessa azienda/partita IVA di Du Parc,
// accorpato in DPH (vedi riga "Ricavi ristorante e bar — clienti esterni" e nota in pagina).
// Resta invece distinto in Dipendenti → Analisi CC e in Movimenti Attivi, non toccati da questo.
const STRUTTURE_HOTEL = ['DPH', 'CLB', 'INT']
const COL_ORDER = ['DPH', 'CLB', 'INT', 'HOTEL', 'BON', 'GRUPPO']

const COL_LABEL = {
  DPH: 'Du Parc', CLB: 'Club Hotel', INT: 'International',
  HOTEL: 'TOT. HOTEL', BON: 'Buona Onda', GRUPPO: 'GRUPPO',
}

const IS_TOTALE = { HOTEL: true, GRUPPO: true }

// Struttura P&L
const SEZIONI = [
  {
    label: 'A — RICAVI OPERATIVI', codice: 'tot_ricavi', tipo: 'totale_a',
    voci: [
      { key: 'ricavi_camere', label: 'Ricavi camere', auto: true, soloHotel: true },
      { key: 'ricavi_fnb', label: 'Ricavi ristorante e bar', auto: true },
      { key: 'ricavi_fnb_esterni', label: 'Ricavi ristorante e bar — clienti esterni', auto: true, soloStruttura: 'DPH' },
      { key: 'ricavi_altri_operativi', label: 'Ricavi altri reparti operativi' },
      { key: 'ricavi_vari_operativi', label: 'Ricavi vari operativi' },
    ],
  },
  {
    label: 'B — COSTI DIRETTI DEI REPARTI', codice: 'tot_costi_diretti', tipo: 'totale_b',
    voci: [
      { key: 'lavoro_camere', label: 'Costo del lavoro — Camere', soloHotel: true, gruppo: 'camere' },
      { key: 'appalto_camere', label: 'Costo del lavoro in appalto — Camere', soloHotel: true, gruppo: 'camere' },
      { key: 'lavanderia', label: 'Costo lavanderia', soloHotel: true, gruppo: 'camere' },
      { key: 'consulenze_camere', label: 'Consulenze camere', soloHotel: true, gruppo: 'camere' },
      { key: 'altri_costi_camere', label: 'Altri costi camere', soloHotel: true, gruppo: 'camere' },
      { key: 'tot_costi_camere', label: 'Totale costi Camere', subtotale: true, soloHotel: true, gruppo: 'camere' },
      { key: 'lavoro_fnb', label: 'Costo del lavoro — F&B', gruppo: 'fnb' },
      { key: 'fdv_fnb', label: 'Costo del venduto F&B', gruppo: 'fnb' },
      { key: 'attrezzature_fnb', label: 'Acquisto e noleggio attrezzature F&B', gruppo: 'fnb' },
      { key: 'consulenze_fnb', label: 'Consulenze F&B', gruppo: 'fnb' },
      { key: 'tot_costi_fnb', label: 'Totale costi F&B', subtotale: true, gruppo: 'fnb' },
      { key: 'lavoro_altri_reparti', label: 'Costo del lavoro — Altri reparti', soloHotel: true },
      { key: 'fdv_altri_reparti', label: 'Costo del venduto altri reparti', soloHotel: true },
    ],
  },
  {
    label: 'C — MARGINE DEI SERVIZI OPERATIVI (A – B)', codice: 'margine', tipo: 'risultato_c',
    voci: [],
  },
  {
    label: 'D — COSTI OPERATIVI INDIRETTI', codice: 'tot_costi_indiretti', tipo: 'totale_d',
    voci: [
      { key: 'lavoro_non_suddiviso', label: 'Costo del lavoro non suddiviso' },
      { key: 'altri_costi_admin', label: 'Altri costi amministrativi e generali' },
      { key: 'consulenze', label: 'Consulenze (legali, fiscali, manageriali)' },
      { key: 'informatica', label: 'Informatica e telecomunicazioni' },
      { key: 'marketing', label: 'Vendite e marketing' },
      { key: 'manutenzioni', label: 'Riparazioni e manutenzioni' },
      { key: 'utenze', label: 'Utenze' },
    ],
  },
  {
    label: 'E — EBITDAR (C – D)', codice: 'ebitdar', tipo: 'risultato_e',
    voci: [],
  },
]

const KPI_CODES = ['ebitdar_pct', 'fnb_cost_pct', 'lavoro_pct', 'utenze_pct']

// Blocchi KPI separati per tipo di struttura. Nessun blocco "Ristoranti": con Maremosso
// accorpato in DPH resterebbe solo Buona Onda, ridondante con la sua colonna nella tabella sopra.
const KPI_BLOCCHI = [
  { id: 'hotel',  label: 'KPI Hotel',  cols: ['DPH', 'CLB', 'INT', 'HOTEL'], tipoConfig: 'hotel' },
  { id: 'gruppo', label: 'KPI Gruppo', cols: ['GRUPPO'],                      tipoConfig: null },
]

// Sfondo delle celle con dato automatico (revenue / dipendenti)
const BG_AUTO = 'var(--color-info-soft)'
const NA = <span style={{ color: 'var(--color-border-strong)' }}>n/a</span>
const VUOTO = <span style={{ color: 'var(--color-text-subtle)' }}>—</span>

// ── Componente cella editabile ──────────────────────────────────────────────
// valore      = valore per display (delta del periodo)
// valoreCum   = valore cumulativo gen→mese (usato per calcolare il nuovo cumulativo al salvataggio)
function CellaEditabile({ valore, valoreCum, onSalva, disabled, evidenziata }) {
  const [editing, setEditing] = useState(false)
  const [testo, setTesto] = useState('')
  const inputRef = useRef(null)

  function avviaEdit() {
    if (disabled) return
    // Mostriamo il valore del mese corrente (non il cumulativo)
    setTesto(valore != null && valore !== 0 ? String(valore).replace('.', ',') : '')
    setEditing(true)
  }

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.select()
  }, [editing])

  function conferma() {
    const pulito = testo.trim().replace(',', '.')
    const num = parseFloat(pulito)
    onSalva(isNaN(num) ? null : num)
    setEditing(false)
  }

  function onKey(e) {
    if (e.key === 'Enter') conferma()
    if (e.key === 'Escape') setEditing(false)
  }

  if (editing) {
    return (
      <Td num style={{ padding: '2px 4px' }}>
        <input
          ref={inputRef}
          className="ui-input ui-num"
          value={testo}
          onChange={e => setTesto(e.target.value)}
          onBlur={conferma}
          onKeyDown={onKey}
          placeholder="valore del mese"
          style={{ width: 130, textAlign: 'right', padding: '2px 6px' }}
        />
      </Td>
    )
  }

  return (
    <Td
      num
      style={{ cursor: disabled ? 'default' : 'pointer', ...(evidenziata ? { background: BG_AUTO } : null) }}
      title={disabled ? 'Dato automatico dal sistema' : 'Clicca per modificare — inserisci il valore del mese'}
      onClick={avviaEdit}
    >
      {evidenziata && <span style={{ fontSize: 10, color: colors.info, marginRight: 4 }}>●</span>}
      {valore ? formatEuro(valore) : VUOTO}
    </Td>
  )
}

// ── Componente principale ───────────────────────────────────────────────────
export default function UsaliContoEconomico() {
  const oggi = new Date()
  const meseDef = oggi.getMonth() === 0 ? 12 : oggi.getMonth()
  const annoDef = oggi.getMonth() === 0 ? oggi.getFullYear() - 1 : oggi.getFullYear()

  const [anno, setAnno] = useState(annoDef)
  const [mese, setMese] = useState(meseDef)
  const [ytd, setYtd] = useState(false)
  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  const [salvando, setSalvando] = useState(null) // "DPH:lavoro_camere"
  const [gruppiCollassati, setGruppiCollassati] = useState(new Set())
  const avvisi = useAvvisi()

  function toggleGruppo(gruppo) {
    setGruppiCollassati(prev => {
      const next = new Set(prev)
      next.has(gruppo) ? next.delete(gruppo) : next.add(gruppo)
      return next
    })
  }

  const carica = useCallback(async () => {
    setLoading(true)
    setErrore(null)
    try {
      const r = await api.get(`/usali/report?anno=${anno}&mese=${mese}&ytd=${ytd}`)
      setDati(r.data)
    } catch (e) {
      setErrore(mostraErrore(e))
    } finally {
      setLoading(false)
    }
  }, [anno, mese, ytd])

  useEffect(() => { carica() }, [carica])

  async function salvaVoce(struttura_code, voce_code, valore) {
    const chiave = `${struttura_code}:${voce_code}`
    setSalvando(chiave)
    try {
      await api.put('/usali/voce', { struttura_code, anno, mese, voce_code, valore })
      await carica()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setSalvando(null)
    }
  }

  // Costruisce la mappa struttura_code → oggetto dati
  const mappa = {}
  if (dati) {
    for (const s of dati.strutture) mappa[s.struttura_code] = s
    mappa['HOTEL'] = dati.tot_hotel
    mappa['GRUPPO'] = dati.tot_gruppo
  }

  function getValore(col, key) {
    const s = mappa[col]
    if (!s) return null
    return s[key] ?? null
  }

  function isAutoField(col, voce) {
    const s = mappa[col]
    if (!s) return false
    // Ricavi auto (da daily_revenue / corrispettivi)
    if (voce.auto) {
      if (voce.key === 'ricavi_camere')       return s.ricavi_camere_auto
      if (voce.key === 'ricavi_fnb')          return s.ricavi_fnb_auto
      if (voce.key === 'ricavi_fnb_esterni')  return s.ricavi_fnb_esterni_auto
    }
    // Lavoro auto (da dipendenti)
    if (voce.key === 'lavoro_camere')       return s.lavoro_camere_auto
    if (voce.key === 'lavoro_fnb')          return s.lavoro_fnb_auto
    if (voce.key === 'lavoro_altri_reparti') return s.lavoro_altri_reparti_auto
    return false
  }

  // Rende una cella: auto / totale / manuale editabile
  function renderCella(col, voce) {
    const isTot = IS_TOTALE[col]
    const s = mappa[col]
    if (!s) return <Td key={col} num tot={isTot}>{VUOTO}</Td>

    const isHotel = STRUTTURE_HOTEL.includes(col)
    // Voce non applicabile
    if (voce.soloHotel && !isHotel && !isTot) return <Td key={col} num>{NA}</Td>
    if (voce.soloStruttura && col !== voce.soloStruttura && !isTot) return <Td key={col} num>{NA}</Td>

    const auto = isAutoField(col, voce)
    const valore = getValore(col, voce.key)

    // Riga subtotale: sfondo/colore dati dalla classe ui-riga-subtotale sulla <tr>
    if (voce.subtotale) {
      return <Td key={col} num tot={isTot}>{valore != null ? formatEuro(valore) : VUOTO}</Td>
    }

    if (isTot || auto) {
      return (
        <Td key={col} num tot={isTot} style={auto ? { background: BG_AUTO, color: colors.infoText } : undefined}>
          {auto && <span style={{ fontSize: 10, marginRight: 3 }}>●</span>}
          {valore ? formatEuro(valore) : VUOTO}
        </Td>
      )
    }

    // Cella editabile (solo strutture singole)
    const chiave = `${col}:${voce.key}`
    const valoreCum = s ? s[voce.key + '_cum'] ?? null : null
    return (
      <CellaEditabile
        key={col}
        valore={valore}
        valoreCum={valoreCum}
        disabled={salvando === chiave}
        evidenziata={false}
        onSalva={(nuovoMensile) => {
          // Il DB salva cumulativi (gen→mese). prevCum = cum attuale - delta mese corrente.
          const prevCum = (valoreCum ?? 0) - (valore ?? 0)
          const newCum = nuovoMensile == null ? null : prevCum + nuovoMensile
          salvaVoce(col, voce.key, newCum)
        }}
      />
    )
  }

  function renderRigaTotale(sezione) {
    const isMargine = sezione.tipo === 'risultato_c' || sezione.tipo === 'risultato_e'
    // Colonne totale (HOTEL/GRUPPO) leggermente più scure del resto della riga
    const bgTot = isMargine ? colors.successBgStrong : colors.border

    return (
      <tr key={sezione.codice} className={isMargine ? 'ui-riga-risultato' : 'ui-riga-sezione'}>
        <Td>{sezione.label}</Td>
        {COL_ORDER.map(col => {
          const s = mappa[col]
          const v = s ? s[sezione.codice] : null
          const isTot = IS_TOTALE[col]
          return (
            <Td key={col} num tot={isTot} style={{
              ...(v < 0 ? { color: colors.danger } : null),
              ...(isTot ? { background: bgTot, fontWeight: 800 } : null),
            }}>
              {v !== null && v !== undefined ? formatEuro(v) : '—'}
            </Td>
          )
        })}
      </tr>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <SectionTitle style={{ margin: 0 }}>Conto Economico USALI</SectionTitle>

        <SegmentedControl
          value={ytd}
          onChange={setYtd}
          options={[{ value: false, label: 'Mese' }, { value: true, label: 'Da inizio anno' }]}
        />

        <div style={{ marginLeft: 'auto' }}>
          <NavMese
            anno={anno}
            mese={mese}
            onChange={({ anno: a, mese: m }) => { setAnno(a); setMese(m) }}
            etichetta={`${ytd && mese > 1 ? `Gen – ${MESI[mese]}` : MESI[mese]} ${anno}`}
          />
        </div>
      </div>

      <Messaggio tipo="err" onChiudi={() => setErrore(null)}>{errore}</Messaggio>

      {/* Legenda */}
      <div className="ui-text-muted" style={{ display: 'flex', gap: 20, marginBottom: 12, flexWrap: 'wrap' }}>
        <span><span style={{ color: colors.infoText }}>●</span> Dato automatico (revenue / dipendenti)</span>
        <span>Clicca su una cella per inserire/modificare</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span><Dot colore={colors.success} /> In range</span>
          <span><Dot colore={colors.warning} /> Sotto range</span>
          <span><Dot colore={colors.danger} /> Fuori range</span>
        </span>
      </div>

      {loading ? (
        <Loading />
      ) : (
        <>
          {/* Tabella principale */}
          <Table minWidth={1100} style={{ marginBottom: 24 }}>
            <colgroup>
              <col style={{ width: 280 }} />
              {COL_ORDER.map(c => <col key={c} style={{ width: IS_TOTALE[c] ? 130 : 110 }} />)}
            </colgroup>
            <thead>
              <tr>
                <Th>Voce</Th>
                {COL_ORDER.map(col => <Th key={col} num tot={IS_TOTALE[col]}>{COL_LABEL[col]}</Th>)}
              </tr>
            </thead>
            <tbody>
              {SEZIONI.map((sezione) => (
                <React.Fragment key={sezione.codice}>
                  {sezione.voci.map((voce) => {
                    const collassato = voce.gruppo && gruppiCollassati.has(voce.gruppo)
                    // Voci figlie: nascoste se il gruppo è collassato
                    if (!voce.subtotale && collassato) return null
                    const isSubtotale = voce.subtotale && voce.gruppo
                    const isOpen = isSubtotale && !gruppiCollassati.has(voce.gruppo)
                    return (
                      <tr
                        key={voce.key}
                        className={voce.subtotale ? 'ui-riga-subtotale' : undefined}
                        onClick={isSubtotale ? () => toggleGruppo(voce.gruppo) : undefined}
                        style={{ cursor: isSubtotale ? 'pointer' : 'default' }}
                      >
                        <Td style={{ paddingLeft: 20, userSelect: 'none', color: voce.subtotale ? undefined : colors.textSecond }}>
                          {isSubtotale && (
                            <span style={{ marginRight: 6, fontSize: 10, opacity: 0.7 }}>
                              {isOpen ? '▼' : '▶'}
                            </span>
                          )}
                          {voce.label}
                        </Td>
                        {COL_ORDER.map(col => renderCella(col, voce))}
                      </tr>
                    )
                  })}
                  {renderRigaTotale(sezione)}
                  {sezione.tipo === 'risultato_c' && (
                    <tr><td colSpan={COL_ORDER.length + 1} style={{ height: 4, padding: 0, background: colors.border }} /></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </Table>

          {/* KPI */}
          <SectionTitle as="h3">Analisi KPI</SectionTitle>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {KPI_BLOCCHI.map(blocco => {
              const cfg = dati?.kpi_config?.[blocco.tipoConfig] ?? null
              const colsBlocco = blocco.cols
              const minW = 280 + colsBlocco.length * 120

              return (
                <Table key={blocco.id} style={{ flex: '1 1 auto', minWidth: Math.min(minW, 500) }}>
                  <colgroup>
                    <col style={{ width: 260 }} />
                    {colsBlocco.map(c => <col key={c} style={{ width: IS_TOTALE[c] ? 120 : 105 }} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <Th>{blocco.label}</Th>
                      {colsBlocco.map(col => <Th key={col} num tot={IS_TOTALE[col]}>{COL_LABEL[col]}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {KPI_CODES.map((kpiCode) => {
                      const rng = cfg?.[kpiCode] ?? null
                      const label = rng?.label ?? kpiCode
                      return (
                        <tr key={kpiCode}>
                          <Td style={{ color: colors.textSecond }}>
                            {label}
                            {rng && (
                              <span className="ui-num" style={{ marginLeft: 8, fontSize: 'var(--fs-xs)', color: colors.textSubtle }}>
                                {rng.lo}% – {rng.hi}%
                              </span>
                            )}
                          </Td>
                          {colsBlocco.map(col => {
                            const s = mappa[col]
                            const v = s?.kpi?.[kpiCode]
                            const isTot = IS_TOTALE[col]
                            let semaforo = null
                            if (rng && v !== null && v !== undefined) {
                              semaforo = v >= rng.lo && v <= rng.hi ? colors.success : v > rng.hi ? colors.danger : colors.warning
                            }
                            return (
                              <Td key={col} num tot={isTot} style={{ fontWeight: isTot ? 700 : 500 }}>
                                {v !== null && v !== undefined ? (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                                    {formatPerc(v)}
                                    {semaforo ? <Dot colore={semaforo} /> : <span className="ui-dot" />}
                                  </span>
                                ) : VUOTO}
                              </Td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
