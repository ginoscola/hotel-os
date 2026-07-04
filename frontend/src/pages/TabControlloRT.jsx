import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { formatEuro, mostraErrore, addDays } from '../utils/format'
import { isAdmin, fmtD, meseNome, giornoSettimana, thSt, tdSt, inpSt } from '../utils/corrispettiviHelpers'

// ── Componente FormRT (sotto-pannello di inserimento per una singola RT) ───────

function FormRT({ label, prefix, form, setForm, onElimina, pms, resetKey }) {
  // Stato locale per i sotto-campi Importo Parziale e Imposta (solo aliquote con IVA)
  // Non vengono salvati in DB: servono solo per calcolare il Corrispettivo.
  // Pre-compilati con imponibile_10/imposta_10 ecc. salvati (es. da import CORRISP.xml)
  // quando si apre un nuovo giorno (resetKey = data selezionata).
  const [sub, setSub] = useState({ par10: '', imp10: '', par22: '', imp22: '' })

  useEffect(() => {
    setSub({
      par10: form[`${prefix}_par10`] ?? '',
      imp10: form[`${prefix}_imp10`] ?? '',
      par22: form[`${prefix}_par22`] ?? '',
      imp22: form[`${prefix}_imp22`] ?? '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, prefix])

  const BREAKDOWN_KEYS = ['10', 'ts', 'penali', '22']

  const pNum = (val) => {
    if (val === '' || val === null || val === undefined) return null
    const n = parseFloat(String(val).replace(',', '.'))
    return isNaN(n) ? null : n
  }

  // Aggiorna un breakdown e ricalcola automaticamente il totale giorno
  const setBreakdown = (k, v) => {
    setForm(f => {
      const newF = { ...f, [`${prefix}_${k}`]: v }
      const vals = BREAKDOWN_KEYS.map(bk => pNum(bk === k ? v : newF[`${prefix}_${bk}`]))
      const almenoUno = vals.some(n => n !== null)
      if (almenoUno) {
        const somma = vals.reduce((acc, n) => acc + (n || 0), 0)
        return { ...newF, [`${prefix}_totale`]: somma.toFixed(2).replace('.', ',') }
      }
      return newF
    })
  }

  // Aggiorna Importo Parziale o Imposta per un'aliquota con IVA
  // e ricalcola il Corrispettivo = par + imp
  const updateAliquota = (parKey, impKey, formKey, k, v) => {
    const ns = { ...sub, [k]: v }
    setSub(ns)
    const par = pNum(ns[parKey])
    const imp = pNum(ns[impKey])
    const corr = (par !== null || imp !== null)
      ? ((par || 0) + (imp || 0)).toFixed(2).replace('.', ',')
      : ''
    setBreakdown(formKey, corr)
  }

  // Inserimenti da Menu (solo RT1): incassi diretti dal software ristorante, non
  // collegato a Welcome — mai presenti nel PMS. Si sommano al lato PMS del confronto.
  const menuVal = prefix === 'rt1' ? (pNum(form.rt1_menu) || 0) : 0

  const totaleNum = pNum(form[`${prefix}_totale`])
  const breakdownVals = BREAKDOWN_KEYS.map(k => pNum(form[`${prefix}_${k}`]))
  const almenoUnBreakdown = breakdownVals.some(v => v !== null)
  const sommaBreakdown = almenoUnBreakdown ? breakdownVals.reduce((a, v) => a + (v || 0), 0) : null
  const totaleAuto = almenoUnBreakdown && totaleNum !== null && Math.abs(totaleNum - sommaBreakdown) < 0.01

  const deltaInfo = (k, pmsV) => {
    const rt = pNum(form[`${prefix}_${k}`])
    if (rt === null) return { label: '—', color: '#94a3b8' }
    const d = rt - (pmsV || 0)
    if (Math.abs(d) <= 0.01) return { label: '✓', color: '#16a34a' }
    return { label: (d > 0 ? '+' : '') + formatEuro(d), color: d > 0 ? '#16a34a' : '#dc2626' }
  }

  const tdL = { fontSize: '0.74rem', color: '#475569', padding: '2px 4px' }
  const tdR = { fontSize: '0.74rem', color: '#64748b', textAlign: 'right', padding: '2px 4px' }
  const subLbl = { ...tdL, color: '#94a3b8', paddingLeft: 14, fontStyle: 'italic' }
  const inputStyle = { ...inpSt, width: 80, textAlign: 'right', padding: '3px 6px', fontSize: '0.78rem' }
  const sep = <tr><td colSpan={4}><div style={{ borderTop: '1px dashed #f1f5f9', margin: '2px 0' }} /></td></tr>

  const corrDisplay = (k) => {
    const v = pNum(form[`${prefix}_${k}`])
    return v !== null
      ? <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e3a5f' }}>{formatEuro(v)} <span style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 400 }}>corr.</span></span>
      : <span style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>—</span>
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
        <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#1e3a5f' }}>{label}</span>
        {onElimina && (
          <button onClick={onElimina} style={{
            fontSize: '0.73rem', color: '#ef4444', border: '1px solid #fca5a5',
            borderRadius: 4, padding: '2px 8px', cursor: 'pointer', background: '#fff5f5',
          }}>Elimina</button>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
            <th style={{ textAlign: 'left',  padding: '2px 4px', fontWeight: 500 }}>Natura</th>
            <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 500 }}>RT</th>
            <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 500 }}>PMS</th>
            <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 500 }}>Δ</th>
          </tr>
        </thead>
        <tbody>

          {/* ── Totale giorno (auto-calcolato) ── */}
          {(() => {
            const d = deltaInfo('totale', (pms?.totale || 0) + menuVal)
            return (
              <tr style={{ background: totaleAuto ? '#f0fdf4' : '#fffbeb' }}>
                <td style={{ ...tdL, fontWeight: 600 }}>
                  Totale giorno
                  {totaleAuto
                    ? <span style={{ marginLeft: 4, fontSize: '0.68rem', color: '#16a34a' }}>⚡ auto</span>
                    : <span style={{ color: '#dc2626' }}> *</span>}
                </td>
                <td style={{ padding: '3px 4px', textAlign: 'right' }}>
                  {totaleAuto
                    ? <span style={{ display: 'inline-block', width: 80, textAlign: 'right', background: '#dcfce7', color: '#15803d', fontWeight: 700, fontSize: '0.78rem', borderRadius: 5, padding: '3px 6px', border: '1px solid #86efac' }}>
                        {totaleNum.toFixed(2).replace('.', ',')}
                      </span>
                    : <input type="text" inputMode="decimal"
                        value={form[`${prefix}_totale`] ?? ''}
                        onChange={e => setForm(f => ({ ...f, [`${prefix}_totale`]: e.target.value }))}
                        placeholder="0,00" style={inputStyle} />}
                </td>
                <td style={tdR}>
                  {pms?.totale > 0 ? formatEuro(pms.totale) : '—'}
                  {menuVal > 0 && <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>+ {formatEuro(menuVal)} menu</div>}
                </td>
                <td style={{ ...tdR, fontWeight: 700, color: d.color }}>{d.label}</td>
              </tr>
            )
          })()}

          <tr><td colSpan={4}><div style={{ borderTop: '1px dashed #e2e8f0', margin: '3px 0' }} /></td></tr>

          {/* ── Aliquota 10%: Importo Parziale + Imposta → Corrispettivo auto ── */}
          {(() => {
            const d = deltaInfo('10', (pms?.arr || 0) + menuVal)
            return (
              <>
                <tr>
                  <td style={{ ...tdL, fontWeight: 600 }}>Aliquota 10%</td>
                  <td style={{ padding: '2px 4px', textAlign: 'right' }}>{corrDisplay('10')}</td>
                  <td style={tdR}>
                    {pms?.arr > 0 ? formatEuro(pms.arr) : '—'}
                    {menuVal > 0 && <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>+ {formatEuro(menuVal)} menu</div>}
                  </td>
                  <td style={{ ...tdR, fontWeight: 700, color: d.color }}>{d.label}</td>
                </tr>
                <tr>
                  <td style={subLbl}>Imposta</td>
                  <td style={{ padding: '2px 4px' }}>
                    <input type="text" inputMode="decimal" value={sub.imp10}
                      onChange={e => updateAliquota('par10', 'imp10', '10', 'imp10', e.target.value)}
                      placeholder="0,00" style={inputStyle} />
                  </td>
                  <td /><td />
                </tr>
                <tr>
                  <td style={subLbl}>Importo Parziale</td>
                  <td style={{ padding: '2px 4px' }}>
                    <input type="text" inputMode="decimal" value={sub.par10}
                      onChange={e => updateAliquota('par10', 'imp10', '10', 'par10', e.target.value)}
                      placeholder="0,00" style={inputStyle} />
                  </td>
                  <td /><td />
                </tr>
                {prefix === 'rt1' && (
                  <tr>
                    <td style={{ ...subLbl, color: '#0891b2' }}>Inserimenti da Menu (lordo)</td>
                    <td style={{ padding: '2px 4px' }}>
                      <input type="text" inputMode="decimal"
                        value={form.rt1_menu ?? ''}
                        onChange={e => setForm(f => ({ ...f, rt1_menu: e.target.value }))}
                        placeholder="0,00" style={inputStyle} />
                    </td>
                    <td /><td />
                  </tr>
                )}
              </>
            )
          })()}

          {sep}

          {/* ── Esente N1 (T. Soggiorno): solo Importo Parziale ── */}
          {(() => {
            const d = deltaInfo('ts', pms?.ts)
            return (
              <tr>
                <td style={tdL}>Esente N1 (T. Soggiorno)</td>
                <td style={{ padding: '3px 4px' }}>
                  <input type="text" inputMode="decimal"
                    value={form[`${prefix}_ts`] ?? ''}
                    onChange={e => setBreakdown('ts', e.target.value)}
                    placeholder="Imp. Parziale" style={inputStyle} />
                </td>
                <td style={tdR}>{pms?.ts > 0 ? formatEuro(pms.ts) : '—'}</td>
                <td style={{ ...tdR, fontWeight: 700, color: d.color }}>{d.label}</td>
              </tr>
            )
          })()}

          {/* ── Esente Art.15 (Penali): solo Importo Parziale ── */}
          {(() => {
            const d = deltaInfo('penali', pms?.penali)
            return (
              <tr>
                <td style={tdL}>Esente Art.15 (Penali)</td>
                <td style={{ padding: '3px 4px' }}>
                  <input type="text" inputMode="decimal"
                    value={form[`${prefix}_penali`] ?? ''}
                    onChange={e => setBreakdown('penali', e.target.value)}
                    placeholder="Imp. Parziale" style={inputStyle} />
                </td>
                <td style={tdR}>{pms?.penali > 0 ? formatEuro(pms.penali) : '—'}</td>
                <td style={{ ...tdR, fontWeight: 700, color: d.color }}>{d.label}</td>
              </tr>
            )
          })()}

          {sep}

          {/* ── Aliquota 22%: Importo Parziale + Imposta → Corrispettivo auto ── */}
          {(() => {
            const d = deltaInfo('22', pms?.shop)
            return (
              <>
                <tr>
                  <td style={{ ...tdL, fontWeight: 600 }}>Aliquota 22%</td>
                  <td style={{ padding: '2px 4px', textAlign: 'right' }}>{corrDisplay('22')}</td>
                  <td style={tdR}>{pms?.shop > 0 ? formatEuro(pms.shop) : '—'}</td>
                  <td style={{ ...tdR, fontWeight: 700, color: d.color }}>{d.label}</td>
                </tr>
                <tr>
                  <td style={subLbl}>Imposta</td>
                  <td style={{ padding: '2px 4px' }}>
                    <input type="text" inputMode="decimal" value={sub.imp22}
                      onChange={e => updateAliquota('par22', 'imp22', '22', 'imp22', e.target.value)}
                      placeholder="0,00" style={inputStyle} />
                  </td>
                  <td /><td />
                </tr>
                <tr>
                  <td style={subLbl}>Importo Parziale</td>
                  <td style={{ padding: '2px 4px' }}>
                    <input type="text" inputMode="decimal" value={sub.par22}
                      onChange={e => updateAliquota('par22', 'imp22', '22', 'par22', e.target.value)}
                      placeholder="0,00" style={inputStyle} />
                  </td>
                  <td /><td />
                </tr>
              </>
            )
          })()}

        </tbody>
      </table>
    </div>
  )
}

// ── Tab Controllo RT ──────────────────────────────────────────────────────────

export default function TabControlloRT() {
  const oggi = new Date()
  const [mese, setMese] = useState(oggi.getMonth() + 1)
  const [anno, setAnno] = useState(oggi.getFullYear())
  const [dati, setDati] = useState(null)
  const [caricamento, setCaricamento] = useState(false)
  const [giornoSel, setGiornoSel] = useState(null)   // data ISO giorno aperto nel pannello
  const [form, setForm] = useState({})
  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState('')
  const [msgOk, setMsgOk] = useState('')
  const [dataManualeInput, setDataManualeInput] = useState('')
  const [riepilogoStagione, setRiepilogoStagione] = useState(null)

  // Import CORRISP.xml
  const [dialogImport, setDialogImport] = useState(false)
  const [importRt, setImportRt] = useState('RT1')
  const [importFile, setImportFile] = useState(null)
  const [importOnConflict, setImportOnConflict] = useState('salta')
  const [importInCorso, setImportInCorso] = useState(false)
  const [importMsg, setImportMsg] = useState(null)   // { tipo: 'success'|'warning'|'info', testo }
  const [importModalita, setImportModalita] = useState('cartella')   // 'cartella' | 'locale'
  // Default = ieri: i dati RT sono disponibili solo dopo la chiusura del giorno precedente
  const [importDataCartella, setImportDataCartella] = useState(() => addDays(new Date().toISOString().slice(0, 10), -1))

  const carica = useCallback(async () => {
    setCaricamento(true)
    setErrore('')
    try {
      const r = await api.get(`/corrispettivi/rt-chiusure?mese=${mese}&anno=${anno}`)
      setDati(r.data)
    } catch (e) {
      setErrore(mostraErrore(e))
    } finally {
      setCaricamento(false)
    }
  }, [mese, anno])

  useEffect(() => { carica() }, [carica])

  // Somma stagione (RT vs PMS su tutto il periodo operativo): riletta solo al cambio anno,
  // non ad ogni mese — la somma mese invece si ricava client-side da `dati.giorni` già caricato.
  useEffect(() => {
    api.get(`/corrispettivi/rt-chiusure/riepilogo-stagione?anno=${anno}`)
      .then(r => setRiepilogoStagione(r.data))
      .catch(() => setRiepilogoStagione(null))
  }, [anno])

  const sommaMese = dati?.giorni ? {
    RT1: dati.giorni.reduce((s, g) => s + (g.rt1.delta ?? 0), 0),
    RT2: dati.giorni.reduce((s, g) => s + (g.rt2.delta ?? 0), 0),
  } : null

  const mesePrecedente = () => {
    if (mese === 1) { setMese(12); setAnno(a => a - 1) } else setMese(m => m - 1)
    setGiornoSel(null)
  }
  const meseSuccessivo = () => {
    if (mese === 12) { setMese(1); setAnno(a => a + 1) } else setMese(m => m + 1)
    setGiornoSel(null)
  }

  const _apriForm = (dataIso, rt1, rt2) => {
    setGiornoSel(dataIso)
    setForm({
      rt1_totale:  rt1?.totale_giorno ?? '',
      rt1_10:      rt1?.totale_10     ?? '',
      rt1_22:      rt1?.totale_22     ?? '',
      rt1_ts:      rt1?.totale_ts     ?? '',
      rt1_penali:  rt1?.totale_penali ?? '',
      rt1_id:      rt1?.id            ?? null,
      rt1_par10:   rt1?.imponibile_10 ?? '',
      rt1_imp10:   rt1?.imposta_10    ?? '',
      rt1_par22:   rt1?.imponibile_22 ?? '',
      rt1_imp22:   rt1?.imposta_22    ?? '',
      rt1_menu:    rt1?.menu_diretto  ?? '',
      rt2_totale:  rt2?.totale_giorno ?? '',
      rt2_10:      rt2?.totale_10     ?? '',
      rt2_22:      rt2?.totale_22     ?? '',
      rt2_ts:      rt2?.totale_ts     ?? '',
      rt2_penali:  rt2?.totale_penali ?? '',
      rt2_id:      rt2?.id            ?? null,
      rt2_par10:   rt2?.imponibile_10 ?? '',
      rt2_imp10:   rt2?.imposta_10    ?? '',
      rt2_par22:   rt2?.imponibile_22 ?? '',
      rt2_imp22:   rt2?.imposta_22    ?? '',
      note: rt1?.note || rt2?.note || '',
    })
    setErrPannello('')
    setMsgOk('')
  }

  const apriGiorno = (g) => { if (isAdmin()) _apriForm(g.data, g.rt1.rt, g.rt2.rt) }
  const apriGiornoVuoto = (dataIso) => { _apriForm(dataIso, null, null) }

  // errore locale al pannello (separato dall'errore lista)
  const [errPannello, setErrPannello] = useState('')

  const parseNum = (s) => {
    if (s === '' || s === null || s === undefined) return null
    const n = parseFloat(String(s).replace(',', '.'))
    return isNaN(n) ? null : n
  }

  const salva = async () => {
    setSalvando(true)
    setErrPannello('')
    setMsgOk('')
    const mkPayload = (pref, rtCode) => ({
      data_chiusura: giornoSel,
      rt_code:       rtCode,
      totale_giorno: parseNum(form[`${pref}_totale`]),
      totale_10:     parseNum(form[`${pref}_10`]),
      totale_22:     parseNum(form[`${pref}_22`]),
      totale_ts:     parseNum(form[`${pref}_ts`]),
      totale_penali: parseNum(form[`${pref}_penali`]),
      menu_diretto: pref === 'rt1' ? parseNum(form.rt1_menu) : null,
      note: form.note || null,
    })
    try {
      const promises = []
      if (parseNum(form.rt1_totale) !== null) promises.push(api.post('/corrispettivi/rt-chiusure', mkPayload('rt1', 'RT1')))
      if (parseNum(form.rt2_totale) !== null) promises.push(api.post('/corrispettivi/rt-chiusure', mkPayload('rt2', 'RT2')))
      if (promises.length === 0) { setErrPannello('Inserire almeno un totale RT.'); setSalvando(false); return }
      await Promise.all(promises)
      setMsgOk('Salvato')
      await carica()
    } catch (e) {
      setErrPannello(mostraErrore(e))
    } finally {
      setSalvando(false)
    }
  }

  const eliminaRT = async (rtCode, id) => {
    if (!confirm(`Eliminare la chiusura ${rtCode} per ${fmtD(giornoSel)}?`)) return
    try {
      await api.delete(`/corrispettivi/rt-chiusure/${id}`)
      const pref = rtCode === 'RT1' ? 'rt1' : 'rt2'
      setForm(f => ({
        ...f,
        [`${pref}_totale`]: '', [`${pref}_10`]: '', [`${pref}_22`]: '',
        [`${pref}_ts`]: '', [`${pref}_penali`]: '', [`${pref}_id`]: null,
      }))
      await carica()
    } catch (e) {
      setErrPannello(mostraErrore(e))
    }
  }

  const apriDialogImport = () => {
    setImportRt('RT1'); setImportFile(null); setImportOnConflict('salta'); setImportMsg(null)
    setImportModalita('cartella'); setImportDataCartella(addDays(new Date().toISOString().slice(0, 10), -1))
    setDialogImport(true)
  }

  // Nome file RT: 99MEX036593-YYYYMMDDTHHMMSS-NNNN-CORRISP.xml
  const dataDaNomeFile = (nome) => {
    const m = nome.match(/-(\d{4})(\d{2})(\d{2})T\d{6}-/)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null
  }

  const eseguiImport = async () => {
    if (importModalita === 'locale' && !importFile) return
    setImportInCorso(true)
    setImportMsg(null)
    try {
      let data
      if (importModalita === 'cartella') {
        // Il backend legge il file direttamente dalla cartella della stampante:
        // il file server della stampante non invia le intestazioni CORS necessarie
        // per essere letto via fetch() dal browser, quindi la ricerca avviene lato server.
        const resp = await api.post('/corrispettivi/rt-chiusure/import-da-stampante', {
          rt_code: importRt, data: importDataCartella, on_conflict: importOnConflict,
        })
        data = resp.data
      } else {
        const formData = new FormData()
        formData.append('file', importFile)
        const resp = await api.post(
          `/corrispettivi/rt-chiusure/import-xml?rt_code=${importRt}&on_conflict=${importOnConflict}`,
          formData,
        )
        data = resp.data
      }
      const suffisso = data.nome_file ? ` — ${data.nome_file}` : ''
      if (data.esito === 'inserito') {
        setImportMsg({ tipo: 'success', testo: `Chiusura del ${fmtD(data.data_chiusura)} importata correttamente (${data.rt_code}${suffisso})` })
      } else if (data.esito === 'aggiornato') {
        setImportMsg({ tipo: 'info', testo: `Chiusura del ${fmtD(data.data_chiusura)} aggiornata (${data.rt_code}${suffisso})` })
      } else {
        setImportMsg({ tipo: 'warning', testo: data.warning || 'Riga già presente — saltata' })
      }
      if (data.esito !== 'saltato') await carica()
    } catch (e) {
      setImportMsg({ tipo: 'error', testo: mostraErrore(e) })
    } finally {
      setImportInCorso(false)
    }
  }

  const fmtDelta = (delta) => {
    if (delta === null) return { label: '—', color: '#94a3b8' }
    if (Math.abs(delta) <= 0.01) return { label: '✓', color: '#16a34a' }
    return { label: `${delta > 0 ? '+' : ''}${formatEuro(delta)}`, color: delta > 0 ? '#16a34a' : '#dc2626' }
  }

  // Come fmtDelta ma mostra sempre l'importo (anche se trascurabile): per una somma
  // cumulata su mese/stagione l'utente vuole vedere il residuo netto, non solo un ✓.
  const fmtSomma = (v) => {
    if (v === null || v === undefined) return { label: '—', color: '#94a3b8' }
    const color = Math.abs(v) <= 0.01 ? '#16a34a' : v > 0 ? '#16a34a' : '#dc2626'
    return { label: `${v > 0 ? '+' : ''}${formatEuro(v)}`, color }
  }

  const giornoDati = giornoSel ? dati?.giorni?.find(g => g.data === giornoSel) : null

  const btnNav = { border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', background: '#fff', fontSize: '0.9rem' }

  return (
    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>

      {/* ── Colonna principale ── */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* Navigazione mese + badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <button onClick={mesePrecedente} style={btnNav}>←</button>
          <span style={{ fontWeight: 700, fontSize: '1rem', minWidth: 160, textAlign: 'center' }}>
            {meseNome(mese)} {anno}
          </span>
          <button onClick={meseSuccessivo} style={btnNav}>→</button>

          {dati && (
            <span style={{
              background: dati.n_differenze > 0 ? '#fef2f2' : '#f0fdf4',
              color:      dati.n_differenze > 0 ? '#dc2626' : '#16a34a',
              border:     `1px solid ${dati.n_differenze > 0 ? '#fca5a5' : '#86efac'}`,
              borderRadius: 6, padding: '4px 12px', fontSize: '0.82rem', fontWeight: 600,
            }}>
              {dati.n_differenze === 0
                ? 'Nessuna differenza'
                : `${dati.n_differenze} giorn${dati.n_differenze === 1 ? 'o' : 'i'} con differenza`}
            </span>
          )}

          {/* Input data manuale per aggiungere chiusure su giorni senza PMS */}
          {isAdmin() && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
              <button
                onClick={apriDialogImport}
                style={{
                  border: '1px solid #1e3a5f', borderRadius: 6, padding: '5px 12px',
                  cursor: 'pointer', background: '#fff', color: '#1e3a5f',
                  fontSize: '0.82rem', fontWeight: 600,
                }}
              >📥 Importa CORRISP.xml</button>
              <input
                type="date"
                value={dataManualeInput}
                onChange={e => setDataManualeInput(e.target.value)}
                style={{ ...inpSt, fontSize: '0.8rem' }}
              />
              <button
                onClick={() => { if (dataManualeInput) { apriGiornoVuoto(dataManualeInput); setDataManualeInput('') } }}
                disabled={!dataManualeInput}
                style={{
                  border: '1px solid #3b82f6', borderRadius: 6, padding: '5px 12px',
                  cursor: 'pointer', background: '#3b82f6', color: '#fff',
                  fontSize: '0.82rem', fontWeight: 600,
                }}
              >+ Inserisci</button>
            </div>
          )}
        </div>

        {/* Somma differenze mese/stagione: verifica se si compensano nel tempo o c'è un bias */}
        {(sommaMese || riepilogoStagione) && (
          <div style={{ display: 'flex', gap: '0.5rem 1.5rem', flexWrap: 'wrap', alignItems: 'baseline', marginBottom: '1rem', fontSize: '0.8rem', color: '#64748b' }}>
            <span style={{ fontWeight: 600 }}>Somma differenze (RT − PMS):</span>
            {sommaMese && (
              <span>
                Mese:{' '}
                <strong style={{ color: fmtSomma(sommaMese.RT1).color }}>RT1 {fmtSomma(sommaMese.RT1).label}</strong>
                {' · '}
                <strong style={{ color: fmtSomma(sommaMese.RT2).color }}>RT2 {fmtSomma(sommaMese.RT2).label}</strong>
              </span>
            )}
            {riepilogoStagione && (
              <span>
                Stagione ({fmtD(riepilogoStagione.RT1?.da || riepilogoStagione.RT2?.da)}–{fmtD(riepilogoStagione.RT1?.a || riepilogoStagione.RT2?.a)}):{' '}
                {riepilogoStagione.RT1 && (
                  <strong style={{ color: fmtSomma(riepilogoStagione.RT1.somma_differenza).color }}>
                    RT1 {fmtSomma(riepilogoStagione.RT1.somma_differenza).label}
                    <span style={{ fontWeight: 400, color: '#94a3b8' }}> ({riepilogoStagione.RT1.giorni_con_rt} gg)</span>
                  </strong>
                )}
                {riepilogoStagione.RT1 && riepilogoStagione.RT2 && ' · '}
                {riepilogoStagione.RT2 && (
                  <strong style={{ color: fmtSomma(riepilogoStagione.RT2.somma_differenza).color }}>
                    RT2 {fmtSomma(riepilogoStagione.RT2.somma_differenza).label}
                    <span style={{ fontWeight: 400, color: '#94a3b8' }}> ({riepilogoStagione.RT2.giorni_con_rt} gg)</span>
                  </strong>
                )}
              </span>
            )}
          </div>
        )}

        {caricamento && <p style={{ color: '#64748b', fontSize: '0.85rem' }}>Caricamento…</p>}
        {errore && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{errore}</p>}

        {dati && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 680 }}>
              <thead>
                <tr style={{ background: '#1e3a5f', color: '#fff' }}>
                  <th style={{ ...thSt, textAlign: 'left', borderRadius: '6px 0 0 0' }}>Data</th>
                  <th colSpan={3} style={{ ...thSt, textAlign: 'center', borderRight: '2px solid rgba(255,255,255,0.2)' }}>
                    RT1 — DPH + CLB
                  </th>
                  <th colSpan={3} style={{ ...thSt, textAlign: 'center', borderRadius: '0 6px 0 0' }}>
                    RT2 — INT
                  </th>
                </tr>
                <tr style={{ background: '#2d4a7a', color: '#c8d8f0', fontSize: '0.72rem' }}>
                  <th style={{ ...thSt, textAlign: 'left', color: '#c8d8f0' }}></th>
                  <th style={{ ...thSt, color: '#c8d8f0' }}>Chiusura RT</th>
                  <th style={{ ...thSt, color: '#c8d8f0' }}>PMS gestionale</th>
                  <th style={{ ...thSt, color: '#c8d8f0', borderRight: '2px solid rgba(255,255,255,0.2)' }}>Δ</th>
                  <th style={{ ...thSt, color: '#c8d8f0' }}>Chiusura RT</th>
                  <th style={{ ...thSt, color: '#c8d8f0' }}>PMS gestionale</th>
                  <th style={{ ...thSt, color: '#c8d8f0' }}>Δ</th>
                </tr>
              </thead>
              <tbody>
                {dati.giorni.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...tdSt, textAlign: 'center', color: '#94a3b8', padding: '2.5rem' }}>
                      Nessun dato per questo mese
                    </td>
                  </tr>
                )}
                {dati.giorni.map((g, i) => {
                  const sel = giornoSel === g.data
                  const d1 = fmtDelta(g.rt1.delta)
                  const d2 = fmtDelta(g.rt2.delta)
                  const hasDiff = (g.rt1.delta !== null && Math.abs(g.rt1.delta) > 0.01)
                                || (g.rt2.delta !== null && Math.abs(g.rt2.delta) > 0.01)
                  return (
                    <tr
                      key={g.data}
                      onClick={() => apriGiorno(g)}
                      style={{
                        background: sel ? '#eff6ff' : hasDiff ? '#fff5f5' : i % 2 === 0 ? '#fff' : '#f8fafc',
                        cursor: isAdmin() ? 'pointer' : 'default',
                        borderLeft: `3px solid ${sel ? '#3b82f6' : 'transparent'}`,
                      }}
                    >
                      <td style={{ ...tdSt, textAlign: 'left', fontWeight: 600, color: '#374151' }}>
                        {giornoSettimana(g.data)} {fmtD(g.data)}
                      </td>
                      {/* RT1 */}
                      <td style={tdSt}>
                        {g.rt1.rt ? formatEuro(g.rt1.rt.totale_giorno) : <span style={{ color: '#cbd5e1' }}>—</span>}
                        {g.rt1.rt?.n1_non_quadra && (
                          <span title={`Tassa di soggiorno (esente N1: ${formatEuro(g.rt1.rt.esente_n1)}) non multiplo di 0,50 € — verifica i conti (RT1 condivide Du Parc 2,50€ e Club 2,00€)`} style={{ marginLeft: 4, cursor: 'help' }}>⚠️</span>
                        )}
                      </td>
                      <td style={tdSt}>
                        {g.rt1.pms.totale > 0 ? formatEuro(g.rt1.pms.totale) : <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                      <td style={{ ...tdSt, color: d1.color, fontWeight: 700, borderRight: '2px solid #e2e8f0' }}>
                        {d1.label}
                      </td>
                      {/* RT2 */}
                      <td style={tdSt}>
                        {g.rt2.rt ? formatEuro(g.rt2.rt.totale_giorno) : <span style={{ color: '#cbd5e1' }}>—</span>}
                        {g.rt2.rt?.n1_non_quadra && (
                          <span title={`Tassa di soggiorno (esente N1: ${formatEuro(g.rt2.rt.esente_n1)}) non multiplo di 2,00 € — verifica i conti`} style={{ marginLeft: 4, cursor: 'help' }}>⚠️</span>
                        )}
                      </td>
                      <td style={tdSt}>
                        {g.rt2.pms.totale > 0 ? formatEuro(g.rt2.pms.totale) : <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>
                      <td style={{ ...tdSt, color: d2.color, fontWeight: 700 }}>
                        {d2.label}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {isAdmin() && (
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem' }}>
                Clicca su una riga per inserire o modificare la chiusura RT del giorno.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Pannello inserimento (solo admin, solo con giorno selezionato) ── */}
      {isAdmin() && giornoSel && (
        <div style={{
          width: 340, flexShrink: 0,
          background: '#fff', border: '1px solid #e2e8f0',
          borderRadius: 10, padding: '1.25rem',
          boxShadow: '0 2px 12px #0001',
          position: 'sticky', top: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1e3a5f' }}>
              {giornoSettimana(giornoSel)} {fmtD(giornoSel)}
            </span>
            <button
              onClick={() => setGiornoSel(null)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#94a3b8', lineHeight: 1 }}
            >✕</button>
          </div>

          <FormRT
            label="RT1 — DPH + CLB"
            prefix="rt1"
            form={form}
            setForm={setForm}
            resetKey={giornoSel}
            onElimina={form.rt1_id ? () => eliminaRT('RT1', form.rt1_id) : null}
            pms={giornoDati?.rt1?.pms}
          />

          <div style={{ borderTop: '1px solid #e2e8f0', margin: '0.75rem 0' }} />

          <FormRT
            label="RT2 — INT"
            prefix="rt2"
            form={form}
            setForm={setForm}
            resetKey={giornoSel}
            onElimina={form.rt2_id ? () => eliminaRT('RT2', form.rt2_id) : null}
            pms={giornoDati?.rt2?.pms}
          />

          <div style={{ borderTop: '1px solid #e2e8f0', margin: '0.75rem 0' }} />

          <label style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 4 }}>Note</label>
          <textarea
            rows={2}
            value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            style={{ ...inpSt, width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
          />

          {errPannello && <p style={{ color: '#dc2626', fontSize: '0.82rem', margin: '0.5rem 0 0' }}>{errPannello}</p>}
          {msgOk && <p style={{ color: '#16a34a', fontSize: '0.82rem', margin: '0.5rem 0 0' }}>{msgOk}</p>}

          <button
            onClick={salva}
            disabled={salvando}
            style={{
              marginTop: '0.75rem', width: '100%', padding: '9px',
              background: '#1e3a5f', color: '#fff', border: 'none',
              borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem',
            }}
          >{salvando ? 'Salvataggio…' : 'Salva chiusure RT'}</button>
        </div>
      )}

      {dialogImport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: '100%', maxWidth: 440 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1e3a5f', marginBottom: 4 }}>Importa CORRISP.xml</div>
            <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0 0 16px' }}>
              File prodotto dal registratore telematico dopo ogni chiusura Z.
            </p>

            <label style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 4 }}>Registratore telematico</label>
            <select
              value={importRt}
              onChange={e => { setImportRt(e.target.value); setImportFile(null); setImportMsg(null) }}
              style={{ ...inpSt, width: '100%', marginBottom: 14, boxSizing: 'border-box' }}
            >
              <option value="RT1">RT1 — Du Parc + Club Hotel</option>
              <option value="RT2">RT2 — Hotel International</option>
            </select>

            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <button
                onClick={() => { setImportModalita('cartella'); setImportFile(null); setImportMsg(null) }}
                style={{
                  flex: 1, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                  border: `1px solid ${importModalita === 'cartella' ? '#1e3a5f' : '#e2e8f0'}`,
                  background: importModalita === 'cartella' ? '#1e3a5f' : '#fff',
                  color: importModalita === 'cartella' ? '#fff' : '#64748b',
                }}
              >Dalla cartella stampante</button>
              <button
                onClick={() => { setImportModalita('locale'); setImportFile(null); setImportMsg(null) }}
                style={{
                  flex: 1, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                  border: `1px solid ${importModalita === 'locale' ? '#1e3a5f' : '#e2e8f0'}`,
                  background: importModalita === 'locale' ? '#1e3a5f' : '#fff',
                  color: importModalita === 'locale' ? '#fff' : '#64748b',
                }}
              >Carica da PC</button>
            </div>

            {importModalita === 'cartella' ? (
              <>
                <label style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 4 }}>Giorno chiusura</label>
                <input
                  type="date"
                  value={importDataCartella}
                  onChange={e => setImportDataCartella(e.target.value)}
                  style={{ ...inpSt, width: '100%', marginBottom: 6, boxSizing: 'border-box' }}
                />
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: '0 0 10px' }}>
                  Il backend cerca ed importa il file CORRISP.xml di questa data direttamente dalla
                  cartella della stampante del registratore selezionato.
                </p>
              </>
            ) : (
              <>
                <label style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 4 }}>File CORRISP.xml</label>
                <input
                  type="file"
                  accept=".xml"
                  onChange={e => setImportFile(e.target.files?.[0] || null)}
                  style={{ ...inpSt, width: '100%', marginBottom: 6, boxSizing: 'border-box' }}
                />
                {importFile && (
                  <p style={{ fontSize: '0.75rem', color: '#64748b', margin: '0 0 6px' }}>
                    {importFile.name}{dataDaNomeFile(importFile.name) ? ` — data ${dataDaNomeFile(importFile.name)}` : ''}
                  </p>
                )}
                {importFile && !importFile.name.toUpperCase().includes('CORRISP') && (
                  <p style={{ fontSize: '0.75rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '5px 8px', margin: '0 0 10px' }}>
                    Verifica che sia un file CORRISP.xml dell'RT
                  </p>
                )}
              </>
            )}

            <label style={{ fontSize: '0.78rem', color: '#64748b', display: 'block', marginBottom: 4, marginTop: 10 }}>Se già presente</label>
            <select value={importOnConflict} onChange={e => setImportOnConflict(e.target.value)} style={{ ...inpSt, width: '100%', boxSizing: 'border-box' }}>
              <option value="salta">Salta se già presente</option>
              <option value="aggiorna">Aggiorna</option>
            </select>
            {importOnConflict === 'aggiorna' && (
              <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: '4px 0 0' }}>
                Le righe modificate manualmente non verranno sovrascritte.
              </p>
            )}

            {importMsg && (
              <p style={{
                fontSize: '0.82rem', marginTop: 14, padding: '8px 10px', borderRadius: 6,
                background: importMsg.tipo === 'success' ? '#f0fdf4' : importMsg.tipo === 'warning' ? '#fffbeb' : importMsg.tipo === 'error' ? '#fef2f2' : '#eff6ff',
                color:      importMsg.tipo === 'success' ? '#166534' : importMsg.tipo === 'warning' ? '#92400e' : importMsg.tipo === 'error' ? '#dc2626' : '#1e40af',
              }}>{importMsg.testo}</p>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={() => setDialogImport(false)} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer', fontSize: '0.85rem' }}>
                Chiudi
              </button>
              <button
                onClick={eseguiImport}
                disabled={(importModalita === 'locale' && !importFile) || importInCorso}
                style={{
                  padding: '9px 16px', borderRadius: 8, border: 'none', color: '#fff', fontSize: '0.85rem', fontWeight: 700,
                  background: ((importModalita === 'locale' && !importFile) || importInCorso) ? '#93c5fd' : '#1e3a5f',
                  cursor: ((importModalita === 'locale' && !importFile) || importInCorso) ? 'not-allowed' : 'pointer',
                }}
              >
                {importInCorso ? 'Importazione in corso…' : 'Importa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
