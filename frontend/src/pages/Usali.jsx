import React, { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api/client'
import { formatEuro, formatPerc, mostraErrore } from '../utils/format.js'

const MESI = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

const STRUTTURE_HOTEL = ['DPH', 'CLB', 'INT']
const STRUTTURE_RISTR = ['MMS', 'BON']
const COL_ORDER = ['DPH', 'CLB', 'INT', 'HOTEL', 'MMS', 'BON', 'RISTR', 'GRUPPO']

const COL_LABEL = {
  DPH: 'Du Parc', CLB: 'Club Hotel', INT: 'International',
  HOTEL: 'TOT. HOTEL', MMS: 'Maremosso', BON: 'Buona Onda',
  RISTR: 'TOT. RISTR.', GRUPPO: 'GRUPPO',
}

const IS_TOTALE = { HOTEL: true, RISTR: true, GRUPPO: true }

// Struttura P&L
const SEZIONI = [
  {
    label: 'A — RICAVI OPERATIVI', codice: 'tot_ricavi', tipo: 'totale_a',
    voci: [
      { key: 'ricavi_camere', label: 'Ricavi camere', auto: true, soloHotel: true },
      { key: 'ricavi_fnb', label: 'Ricavi ristorante e bar', auto: true },
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

// Blocchi KPI separati per tipo di struttura
const KPI_BLOCCHI = [
  { id: 'hotel',      label: 'KPI Hotel',       cols: ['DPH', 'CLB', 'INT', 'HOTEL'],  tipoConfig: 'hotel' },
  { id: 'ristoranti', label: 'KPI Ristoranti',  cols: ['MMS', 'BON', 'RISTR'],          tipoConfig: 'ristoranti' },
  { id: 'gruppo',     label: 'KPI Gruppo',      cols: ['GRUPPO'],                        tipoConfig: null },
]

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

  const stileBase = {
    textAlign: 'right', padding: '4px 8px', minWidth: 100,
    cursor: disabled ? 'default' : 'pointer',
    background: evidenziata ? '#eff6ff' : disabled ? 'transparent' : 'transparent',
  }

  if (editing) {
    return (
      <td style={{ padding: '2px 4px' }}>
        <input
          ref={inputRef}
          value={testo}
          onChange={e => setTesto(e.target.value)}
          onBlur={conferma}
          onKeyDown={onKey}
          placeholder="valore del mese"
          style={{
            width: 130, textAlign: 'right', padding: '2px 6px',
            border: '2px solid #3b82f6', borderRadius: 4, fontSize: 13,
          }}
        />
      </td>
    )
  }

  return (
    <td
      style={stileBase}
      title={disabled ? 'Dato automatico dal sistema' : 'Clicca per modificare — inserisci il valore del mese'}
      onClick={avviaEdit}
    >
      {evidenziata && (
        <span style={{ fontSize: 10, color: '#2563eb', marginRight: 4 }}>●</span>
      )}
      {valore ? formatEuro(valore) : (disabled ? <span style={{ color: '#94a3b8' }}>—</span> : <span style={{ color: '#cbd5e1' }}>—</span>)}
    </td>
  )
}

// ── Componente principale ───────────────────────────────────────────────────
export default function Usali() {
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
      alert(mostraErrore(e))
    } finally {
      setSalvando(null)
    }
  }

  function navMese(delta) {
    let nm = mese + delta
    let na = anno
    if (nm < 1) { nm = 12; na-- }
    if (nm > 12) { nm = 1; na++ }
    setMese(nm)
    setAnno(na)
  }

  // Costruisce la mappa struttura_code → oggetto dati
  const mappa = {}
  if (dati) {
    for (const s of dati.strutture) mappa[s.struttura_code] = s
    mappa['HOTEL'] = dati.tot_hotel
    mappa['RISTR'] = dati.tot_ristoranti
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
      if (voce.key === 'ricavi_camere') return s.ricavi_camere_auto
      if (voce.key === 'ricavi_fnb')    return s.ricavi_fnb_auto
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
    if (!s) return <td key={col} style={{ textAlign: 'right', padding: '4px 8px', color: '#94a3b8' }}>—</td>

    const isHotel = STRUTTURE_HOTEL.includes(col)
    const isRistr = STRUTTURE_RISTR.includes(col)
    // Voce non applicabile
    if (voce.soloHotel && !isHotel && !isTot) {
      return <td key={col} style={{ textAlign: 'right', padding: '4px 8px', color: '#e2e8f0' }}>n/a</td>
    }

    const auto = isAutoField(col, voce)
    const valore = getValore(col, voce.key)

    if (voce.subtotale) {
      return (
        <td key={col} style={{
          textAlign: 'right', padding: '4px 8px',
          fontWeight: 600, background: '#f0f4ff',
          color: '#1e3a8a', borderTop: '1px solid #c7d2fe',
        }}>
          {valore != null ? formatEuro(valore) : <span style={{ color: '#94a3b8' }}>—</span>}
        </td>
      )
    }

    if (isTot || auto) {
      return (
        <td key={col} style={{
          textAlign: 'right', padding: '4px 8px',
          background: auto ? '#eff6ff' : isTot ? '#f8fafc' : 'transparent',
          fontWeight: isTot ? 600 : 400,
          color: auto ? '#1d4ed8' : 'inherit',
        }}>
          {auto && <span style={{ fontSize: 10, marginRight: 3 }}>●</span>}
          {valore ? formatEuro(valore) : <span style={{ color: '#94a3b8' }}>—</span>}
        </td>
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
    const bg = isMargine ? '#f0fdf4' : '#f1f5f9'
    const colTesto = isMargine ? '#15803d' : '#1e293b'

    return (
      <tr key={sezione.codice} style={{ background: bg, fontWeight: 700, borderTop: '2px solid #cbd5e1' }}>
        <td style={{ padding: '6px 12px', color: colTesto, fontSize: 13 }}>{sezione.label}</td>
        {COL_ORDER.map(col => {
          const s = mappa[col]
          const v = s ? s[sezione.codice] : null
          const isTot = IS_TOTALE[col]
          const neg = v < 0
          return (
            <td key={col} style={{
              textAlign: 'right', padding: '6px 8px',
              color: neg ? '#dc2626' : colTesto,
              background: isTot ? (isMargine ? '#dcfce7' : '#e2e8f0') : bg,
              fontWeight: isTot ? 800 : 700,
            }}>
              {v !== null && v !== undefined ? formatEuro(v) : '—'}
            </td>
          )
        })}
      </tr>
    )
  }

  return (
    <div style={{ padding: '20px 24px', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#1e293b' }}>
          Conto Economico USALI
        </h2>

        {/* Toggle Mese / YTD */}
        <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', fontSize: 13 }}>
          <button
            onClick={() => setYtd(false)}
            style={{
              padding: '6px 14px', border: 'none', cursor: 'pointer', fontWeight: ytd ? 400 : 600,
              background: ytd ? '#f8fafc' : '#1e293b', color: ytd ? '#64748b' : '#fff',
            }}
          >
            Mese
          </button>
          <button
            onClick={() => setYtd(true)}
            style={{
              padding: '6px 14px', border: 'none', cursor: 'pointer', fontWeight: ytd ? 600 : 400,
              background: ytd ? '#1e293b' : '#f8fafc', color: ytd ? '#fff' : '#64748b',
            }}
          >
            Da inizio anno
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <button onClick={() => navMese(-1)} style={btnNavStyle}>◀</button>
          <span style={{ fontWeight: 600, fontSize: 15, minWidth: 180, textAlign: 'center' }}>
            {ytd && mese > 1 ? `Gen – ${MESI[mese]}` : MESI[mese]} {anno}
          </span>
          <button onClick={() => navMese(1)} style={btnNavStyle}>▶</button>
        </div>
      </div>

      {errore && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 14px', color: '#dc2626', marginBottom: 16 }}>
          {errore}
        </div>
      )}

      {/* Legenda */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontSize: 12, color: '#64748b', flexWrap: 'wrap' }}>
        <span><span style={{ color: '#1d4ed8' }}>●</span> Dato automatico (revenue / dipendenti)</span>
        <span style={{ color: '#94a3b8' }}>Clicca su una cella per inserire/modificare</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#22c55e', marginRight: 4 }} />In range</span>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#f59e0b', marginRight: 4 }} />Sotto range</span>
          <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#ef4444', marginRight: 4 }} />Fuori range</span>
        </span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Caricamento…</div>
      ) : (
        <>
          {/* Tabella principale */}
          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 24 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, minWidth: 1100 }}>
              <colgroup>
                <col style={{ width: 280 }} />
                {COL_ORDER.map(c => <col key={c} style={{ width: IS_TOTALE[c] ? 130 : 110 }} />)}
              </colgroup>
              <thead>
                <tr style={{ background: '#1e293b', color: '#fff' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Voce</th>
                  {COL_ORDER.map(col => (
                    <th key={col} style={{
                      padding: '8px 8px', textAlign: 'right', fontWeight: 600,
                      fontSize: IS_TOTALE[col] ? 12 : 13,
                      background: IS_TOTALE[col] ? '#334155' : '#1e293b',
                      borderLeft: IS_TOTALE[col] ? '2px solid #475569' : col === 'MMS' ? '2px solid #475569' : 'none',
                    }}>
                      {COL_LABEL[col]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SEZIONI.map((sezione) => (
                  <React.Fragment key={sezione.codice}>
                    {sezione.voci.map((voce, vi) => {
                      const collassato = voce.gruppo && gruppiCollassati.has(voce.gruppo)
                      // Voci figlie: nascoste se il gruppo è collassato
                      if (!voce.subtotale && collassato) return null
                      const isSubtotale = voce.subtotale && voce.gruppo
                      const isOpen = isSubtotale && !gruppiCollassati.has(voce.gruppo)
                      return (
                        <tr
                          key={voce.key}
                          onClick={isSubtotale ? () => toggleGruppo(voce.gruppo) : undefined}
                          style={{
                            background: voce.subtotale ? '#f0f4ff' : vi % 2 === 0 ? '#fff' : '#f8fafc',
                            borderBottom: '1px solid #f1f5f9',
                            cursor: isSubtotale ? 'pointer' : 'default',
                          }}
                        >
                          <td style={{
                            padding: '4px 12px 4px 20px',
                            color: voce.subtotale ? '#1e3a8a' : '#374151',
                            fontSize: 13,
                            fontWeight: voce.subtotale ? 600 : 400,
                            borderTop: voce.subtotale ? '1px solid #c7d2fe' : 'none',
                            userSelect: 'none',
                          }}>
                            {isSubtotale && (
                              <span style={{ marginRight: 6, fontSize: 10, opacity: 0.7 }}>
                                {isOpen ? '▼' : '▶'}
                              </span>
                            )}
                            {voce.label}
                          </td>
                          {COL_ORDER.map(col => renderCella(col, voce))}
                        </tr>
                      )
                    })}
                    {renderRigaTotale(sezione)}
                    {sezione.tipo === 'risultato_c' && (
                      <tr><td colSpan={COL_ORDER.length + 1} style={{ height: 4, background: '#e2e8f0' }} /></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* KPI — 3 blocchi separati */}
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1e293b', marginBottom: 10 }}>
            Analisi KPI
          </h3>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {KPI_BLOCCHI.map(blocco => {
              const cfg = dati?.kpi_config?.[blocco.tipoConfig] ?? null
              const colsBlocco = blocco.cols
              const minW = 280 + colsBlocco.length * 120

              return (
                <div key={blocco.id} style={{ flex: '1 1 auto', overflowX: 'auto', borderRadius: 8, border: '1px solid #e2e8f0', minWidth: Math.min(minW, 500) }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                    <colgroup>
                      <col style={{ width: 260 }} />
                      {colsBlocco.map(c => <col key={c} style={{ width: IS_TOTALE[c] ? 120 : 105 }} />)}
                    </colgroup>
                    <thead>
                      <tr style={{ background: '#334155', color: '#fff' }}>
                        <th style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600 }}>{blocco.label}</th>
                        {colsBlocco.map(col => (
                          <th key={col} style={{
                            padding: '7px 8px', textAlign: 'right', fontWeight: 600,
                            background: IS_TOTALE[col] ? '#475569' : '#334155',
                            borderLeft: IS_TOTALE[col] ? '2px solid #64748b' : 'none',
                          }}>
                            {COL_LABEL[col]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {KPI_CODES.map((kpiCode, vi) => {
                        const rng = cfg?.[kpiCode] ?? null
                        const label = rng?.label ?? kpiCode
                        return (
                          <tr key={kpiCode} style={{ background: vi % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '5px 12px', color: '#374151' }}>
                              {label}
                              {rng && (
                                <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8' }}>
                                  {rng.lo}% – {rng.hi}%
                                </span>
                              )}
                            </td>
                            {colsBlocco.map(col => {
                              const s = mappa[col]
                              const v = s?.kpi?.[kpiCode]
                              const isTot = IS_TOTALE[col]
                              let semaforo = null
                              if (rng && v !== null && v !== undefined) {
                                semaforo = v >= rng.lo && v <= rng.hi ? '#22c55e' : v > rng.hi ? '#ef4444' : '#f59e0b'
                              }
                              return (
                                <td key={col} style={{
                                  textAlign: 'right', padding: '5px 8px',
                                  fontWeight: isTot ? 700 : 500,
                                  background: isTot ? '#f1f5f9' : 'inherit',
                                  color: '#374151',
                                  borderLeft: IS_TOTALE[col] ? '2px solid #e2e8f0' : 'none',
                                }}>
                                  {v !== null && v !== undefined ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
                                      {formatPerc(v)}
                                      {semaforo ? (
                                        <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: semaforo, flexShrink: 0 }} />
                                      ) : (
                                        <span style={{ display: 'inline-block', width: 9, height: 9, flexShrink: 0 }} />
                                      )}
                                    </span>
                                  ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

const btnNavStyle = {
  background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6,
  padding: '5px 12px', cursor: 'pointer', fontSize: 14, color: '#475569',
}
