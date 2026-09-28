import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { formatEuro, mostraErrore, addDays } from '../utils/format'
import { isAdmin, fmtD, giornoSettimana } from '../utils/corrispettiviHelpers'
import {
  Badge, Button, Card, Field, Input, Loading, Messaggio, Modal, NavMese, SegmentedControl, Select,
  Table, Td, Textarea, Th, useAvvisi, useConferma,
} from '../components/ui'
import { colors } from '../styles/tokens.js'

const VUOTO = <span style={{ color: colors.borderStrong }}>—</span>

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
    if (rt === null) return { label: '—', color: colors.textSubtle }
    const d = rt - (pmsV || 0)
    if (Math.abs(d) <= 0.01) return { label: '✓', color: colors.success }
    return { label: (d > 0 ? '+' : '') + formatEuro(d), color: d > 0 ? colors.success : colors.danger }
  }

  // Campo numerico compatto del modulo RT
  const campo = (value, onChange, placeholder = '0,00') => (
    <input type="text" inputMode="decimal" className="ui-input ui-num" value={value} onChange={onChange}
      placeholder={placeholder} style={{ width: 86, textAlign: 'right', padding: '2px 6px', fontSize: 'var(--fs-sm)' }} />
  )
  const sottoVoce = { paddingLeft: 16, fontStyle: 'italic', color: colors.textMuted }
  const cellaDelta = (d) => <Td num style={{ fontWeight: 700, color: d.color }}>{d.label}</Td>
  const pmsMenu = menuVal > 0 && <div style={{ fontSize: 'var(--fs-xs)', color: colors.textSubtle }}>+ {formatEuro(menuVal)} menu</div>

  const corrDisplay = (k) => {
    const v = pNum(form[`${prefix}_${k}`])
    return v !== null
      ? <span style={{ fontWeight: 700, color: colors.primary }}>{formatEuro(v)} <span style={{ fontSize: 'var(--fs-xs)', color: colors.textSubtle, fontWeight: 400 }}>corr.</span></span>
      : VUOTO
  }

  const dTot = deltaInfo('totale', (pms?.totale || 0) + menuVal)
  const d10 = deltaInfo('10', (pms?.arr || 0) + menuVal)
  const dTs = deltaInfo('ts', pms?.ts)
  const dPen = deltaInfo('penali', pms?.penali)
  const d22 = deltaInfo('22', pms?.shop)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 700, color: colors.primary }}>{label}</span>
        {onElimina && <Button variant="danger-soft" size="sm" onClick={onElimina}>Elimina</Button>}
      </div>
      <Table compact>
        <thead>
          <tr><Th>Natura</Th><Th num>RT</Th><Th num>PMS</Th><Th num>Δ</Th></tr>
        </thead>
        <tbody>
          {/* ── Totale giorno (auto-calcolato) ── */}
          <tr className={totaleAuto ? 'ui-riga-ok' : 'ui-riga-avviso'}>
            <Td style={{ fontWeight: 600 }}>
              Totale giorno
              {totaleAuto
                ? <span style={{ marginLeft: 4, fontSize: 'var(--fs-xs)', color: colors.success }}>⚡ auto</span>
                : <span style={{ color: colors.danger }}> *</span>}
            </Td>
            <Td num>
              {totaleAuto
                ? <strong style={{ color: colors.successText }}>{totaleNum.toFixed(2).replace('.', ',')}</strong>
                : campo(form[`${prefix}_totale`] ?? '', e => setForm(f => ({ ...f, [`${prefix}_totale`]: e.target.value })))}
            </Td>
            <Td num style={{ color: colors.textMuted }}>{pms?.totale > 0 ? formatEuro(pms.totale) : '—'}{pmsMenu}</Td>
            {cellaDelta(dTot)}
          </tr>

          {/* ── Aliquota 10%: Importo Parziale + Imposta → Corrispettivo auto ── */}
          <tr className="ui-riga-sezione">
            <Td>Aliquota 10%</Td>
            <Td num>{corrDisplay('10')}</Td>
            <Td num style={{ color: colors.textMuted, fontWeight: 400 }}>{pms?.arr > 0 ? formatEuro(pms.arr) : '—'}{pmsMenu}</Td>
            {cellaDelta(d10)}
          </tr>
          <tr>
            <Td style={sottoVoce}>Imposta</Td>
            <Td num>{campo(sub.imp10, e => updateAliquota('par10', 'imp10', '10', 'imp10', e.target.value))}</Td>
            <Td /><Td />
          </tr>
          <tr>
            <Td style={sottoVoce}>Importo Parziale</Td>
            <Td num>{campo(sub.par10, e => updateAliquota('par10', 'imp10', '10', 'par10', e.target.value))}</Td>
            <Td /><Td />
          </tr>
          {prefix === 'rt1' && (
            <tr>
              <Td style={{ ...sottoVoce, color: colors.infoText }}>Inserimenti da Menu (lordo)</Td>
              <Td num>{campo(form.rt1_menu ?? '', e => setForm(f => ({ ...f, rt1_menu: e.target.value })))}</Td>
              <Td /><Td />
            </tr>
          )}

          {/* ── Esenti: solo Importo Parziale ── */}
          <tr className="ui-riga-sezione">
            <Td style={{ fontWeight: 400 }}>Esente N1 (T. Soggiorno)</Td>
            <Td num>{campo(form[`${prefix}_ts`] ?? '', e => setBreakdown('ts', e.target.value), 'Imp. Parziale')}</Td>
            <Td num style={{ color: colors.textMuted, fontWeight: 400 }}>{pms?.ts > 0 ? formatEuro(pms.ts) : '—'}</Td>
            {cellaDelta(dTs)}
          </tr>
          <tr>
            <Td>Esente Art.15 (Penali)</Td>
            <Td num>{campo(form[`${prefix}_penali`] ?? '', e => setBreakdown('penali', e.target.value), 'Imp. Parziale')}</Td>
            <Td num style={{ color: colors.textMuted }}>{pms?.penali > 0 ? formatEuro(pms.penali) : '—'}</Td>
            {cellaDelta(dPen)}
          </tr>

          {/* ── Aliquota 22%: Importo Parziale + Imposta → Corrispettivo auto ── */}
          <tr className="ui-riga-sezione">
            <Td>Aliquota 22%</Td>
            <Td num>{corrDisplay('22')}</Td>
            <Td num style={{ color: colors.textMuted, fontWeight: 400 }}>{pms?.shop > 0 ? formatEuro(pms.shop) : '—'}</Td>
            {cellaDelta(d22)}
          </tr>
          <tr>
            <Td style={sottoVoce}>Imposta</Td>
            <Td num>{campo(sub.imp22, e => updateAliquota('par22', 'imp22', '22', 'imp22', e.target.value))}</Td>
            <Td /><Td />
          </tr>
          <tr>
            <Td style={sottoVoce}>Importo Parziale</Td>
            <Td num>{campo(sub.par22, e => updateAliquota('par22', 'imp22', '22', 'par22', e.target.value))}</Td>
            <Td /><Td />
          </tr>
        </tbody>
      </Table>
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
  const avvisi = useAvvisi()
  const conferma = useConferma()
  const [dataManualeInput, setDataManualeInput] = useState('')
  const [riepilogoStagione, setRiepilogoStagione] = useState(null)

  // Import CORRISP.xml
  const [dialogImport, setDialogImport] = useState(false)
  const [importRt, setImportRt] = useState('RT1')
  const [importFiles, setImportFiles] = useState([])   // array File — più chiusure Z stesso giorno
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

  // Totale Inserimenti da Menu (solo RT1) — quanto incasso extra-Welcome è stato dichiarato
  const menuMese = dati?.giorni
    ? dati.giorni.reduce((s, g) => s + (g.rt1.rt?.menu_diretto ?? 0), 0)
    : null

  const cambiaMese = ({ anno: a, mese: m }) => { setAnno(a); setMese(m); setGiornoSel(null) }

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
      avvisi.successo(`Chiusure RT del ${fmtD(giornoSel)} salvate`)
      await carica()
    } catch (e) {
      setErrPannello(mostraErrore(e))
    } finally {
      setSalvando(false)
    }
  }

  const eliminaRT = async (rtCode, id) => {
    if (!(await conferma({ titolo: `Eliminare la chiusura ${rtCode} per ${fmtD(giornoSel)}?`, pericolo: true }))) return
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
    setImportRt('RT1'); setImportFiles([]); setImportOnConflict('salta'); setImportMsg(null)
    setImportModalita('cartella'); setImportDataCartella(addDays(new Date().toISOString().slice(0, 10), -1))
    setDialogImport(true)
  }

  // Nome file RT: 99MEX036593-YYYYMMDDTHHMMSS-NNNN-CORRISP.xml
  const dataDaNomeFile = (nome) => {
    const m = nome.match(/-(\d{4})(\d{2})(\d{2})T\d{6}-/)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null
  }

  const eseguiImport = async () => {
    if (importModalita === 'locale' && importFiles.length === 0) return
    setImportInCorso(true)
    setImportMsg(null)
    try {
      let data
      if (importModalita === 'cartella') {
        // Il backend legge il file direttamente dalla cartella della stampante:
        // il file server della stampante non invia le intestazioni CORS necessarie
        // per essere letto via fetch() dal browser, quindi la ricerca avviene lato server.
        // Se in quel giorno ci sono più chiusure Z (es. dopo una riapertura per un problema),
        // il backend le trova e le somma tutte da solo — non serve indicarne il numero qui.
        const resp = await api.post('/corrispettivi/rt-chiusure/import-da-stampante', {
          rt_code: importRt, data: importDataCartella, on_conflict: importOnConflict,
        })
        data = resp.data
      } else {
        const formData = new FormData()
        importFiles.forEach(f => formData.append('files', f))
        const resp = await api.post(
          `/corrispettivi/rt-chiusure/import-xml?rt_code=${importRt}&on_conflict=${importOnConflict}`,
          formData,
        )
        data = resp.data
      }
      const suffisso = data.nome_file ? ` — ${data.nome_file}` : ''
      const nChiusure = data.n_chiusure > 1 ? ` (${data.n_chiusure} chiusure sommate)` : ''
      if (data.esito === 'inserito') {
        setImportMsg({ tipo: 'success', testo: `Chiusura del ${fmtD(data.data_chiusura)} importata correttamente (${data.rt_code}${suffisso})${nChiusure}` })
      } else if (data.esito === 'aggiornato') {
        setImportMsg({ tipo: 'info', testo: `Chiusura del ${fmtD(data.data_chiusura)} aggiornata (${data.rt_code}${suffisso})${nChiusure}` })
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
    if (delta === null) return { label: '—', color: colors.textSubtle }
    if (Math.abs(delta) <= 0.01) return { label: '✓', color: colors.success }
    return { label: `${delta > 0 ? '+' : ''}${formatEuro(delta)}`, color: delta > 0 ? colors.success : colors.danger }
  }

  // Come fmtDelta ma mostra sempre l'importo (anche se trascurabile): per una somma
  // cumulata su mese/stagione l'utente vuole vedere il residuo netto, non solo un ✓.
  const fmtSomma = (v) => {
    if (v === null || v === undefined) return { label: '—', color: colors.textSubtle }
    const color = Math.abs(v) <= 0.01 ? colors.success : v > 0 ? colors.success : colors.danger
    return { label: `${v > 0 ? '+' : ''}${formatEuro(v)}`, color }
  }

  const giornoDati = giornoSel ? dati?.giorni?.find(g => g.data === giornoSel) : null

  const tonoImport = { success: 'ok', warning: 'warn', error: 'err', info: 'info' }
  const importDisabilitato = (importModalita === 'locale' && importFiles.length === 0) || importInCorso
  const rigaRiepilogo = { display: 'flex', gap: '6px 24px', flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 12, fontSize: 'var(--fs-sm)', color: colors.textMuted }

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

      {/* ── Colonna principale ── */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* Navigazione mese + badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <NavMese anno={anno} mese={mese} onChange={cambiaMese} />

          {dati && (
            <Badge tono={dati.n_differenze > 0 ? 'err' : 'ok'} style={{ fontSize: 'var(--fs-sm)', padding: '3px 10px' }}>
              {dati.n_differenze === 0
                ? 'Nessuna differenza'
                : `${dati.n_differenze} giorn${dati.n_differenze === 1 ? 'o' : 'i'} con differenza`}
            </Badge>
          )}

          {/* Input data manuale per aggiungere chiusure su giorni senza PMS */}
          {isAdmin() && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <Button variant="secondary" size="sm" onClick={apriDialogImport}>📥 Importa CORRISP.xml</Button>
              <Input type="date" value={dataManualeInput} onChange={e => setDataManualeInput(e.target.value)} aria-label="Data da inserire" />
              <Button size="sm" disabled={!dataManualeInput}
                onClick={() => { if (dataManualeInput) { apriGiornoVuoto(dataManualeInput); setDataManualeInput('') } }}>
                + Inserisci
              </Button>
            </div>
          )}
        </div>

        {/* Somma differenze mese/stagione: verifica se si compensano nel tempo o c'è un bias */}
        {(sommaMese || riepilogoStagione) && (
          <div style={rigaRiepilogo}>
            <span style={{ fontWeight: 600 }}>Somma differenze (RT − PMS):</span>
            {sommaMese && (
              <span className="ui-num">
                Mese:{' '}
                <strong style={{ color: fmtSomma(sommaMese.RT1).color }}>RT1 {fmtSomma(sommaMese.RT1).label}</strong>
                {' · '}
                <strong style={{ color: fmtSomma(sommaMese.RT2).color }}>RT2 {fmtSomma(sommaMese.RT2).label}</strong>
              </span>
            )}
            {riepilogoStagione && (
              <span className="ui-num">
                Stagione ({fmtD(riepilogoStagione.RT1?.da || riepilogoStagione.RT2?.da)}–{fmtD(riepilogoStagione.RT1?.a || riepilogoStagione.RT2?.a)}):{' '}
                {riepilogoStagione.RT1 && (
                  <strong style={{ color: fmtSomma(riepilogoStagione.RT1.somma_differenza).color }}>
                    RT1 {fmtSomma(riepilogoStagione.RT1.somma_differenza).label}
                    <span style={{ fontWeight: 400, color: colors.textSubtle }}> ({riepilogoStagione.RT1.giorni_con_rt} gg)</span>
                  </strong>
                )}
                {riepilogoStagione.RT1 && riepilogoStagione.RT2 && ' · '}
                {riepilogoStagione.RT2 && (
                  <strong style={{ color: fmtSomma(riepilogoStagione.RT2.somma_differenza).color }}>
                    RT2 {fmtSomma(riepilogoStagione.RT2.somma_differenza).label}
                    <span style={{ fontWeight: 400, color: colors.textSubtle }}> ({riepilogoStagione.RT2.giorni_con_rt} gg)</span>
                  </strong>
                )}
              </span>
            )}
          </div>
        )}

        {/* Totale Inserimenti da Menu (solo RT1): quanto incasso extra-Welcome dichiarato */}
        {((menuMese ?? 0) > 0 || (riepilogoStagione?.RT1?.somma_menu ?? 0) > 0) && (
          <div style={rigaRiepilogo}>
            <span style={{ fontWeight: 600 }}>Inserimenti da Menu (RT1):</span>
            {menuMese != null && (
              <span className="ui-num">Mese: <strong style={{ color: colors.infoText }}>{formatEuro(menuMese)}</strong></span>
            )}
            {riepilogoStagione?.RT1 && (
              <span className="ui-num">
                Stagione ({fmtD(riepilogoStagione.RT1.da)}–{fmtD(riepilogoStagione.RT1.a)}):{' '}
                <strong style={{ color: colors.infoText }}>{formatEuro(riepilogoStagione.RT1.somma_menu)}</strong>
              </span>
            )}
          </div>
        )}

        {caricamento && <Loading />}
        <Messaggio tipo="err">{errore}</Messaggio>

        {dati && (
          <>
            <Table compact minWidth={680}>
              <thead>
                <tr>
                  <Th rowSpan={2} style={{ verticalAlign: 'bottom' }}>Data</Th>
                  <Th center gruppo colSpan={3}>RT1 — DPH + CLB</Th>
                  <Th center gruppo colSpan={3}>RT2 — INT</Th>
                </tr>
                <tr className="sub">
                  <Th num gruppo>Chiusura RT</Th><Th num>PMS gestionale</Th><Th num>Δ</Th>
                  <Th num gruppo>Chiusura RT</Th><Th num>PMS gestionale</Th><Th num>Δ</Th>
                </tr>
              </thead>
              <tbody>
                {dati.giorni.length === 0 && (
                  <tr><Td colSpan={7} center muted style={{ padding: 40 }}>Nessun dato per questo mese</Td></tr>
                )}
                {dati.giorni.map(g => {
                  const sel = giornoSel === g.data
                  const d1 = fmtDelta(g.rt1.delta)
                  const d2 = fmtDelta(g.rt2.delta)
                  const hasDiff = (g.rt1.delta !== null && Math.abs(g.rt1.delta) > 0.01)
                                || (g.rt2.delta !== null && Math.abs(g.rt2.delta) > 0.01)
                  return (
                    <tr
                      key={g.data}
                      onClick={() => apriGiorno(g)}
                      className={sel ? 'ui-riga-evidenza' : hasDiff ? 'ui-riga-errore' : undefined}
                      style={{ cursor: isAdmin() ? 'pointer' : 'default' }}
                    >
                      <Td style={{ fontWeight: 600, whiteSpace: 'nowrap', boxShadow: sel ? `inset 3px 0 0 ${colors.info}` : undefined }}>
                        {giornoSettimana(g.data)} {fmtD(g.data)}
                      </Td>
                      {/* RT1 */}
                      <Td num gruppo>
                        {g.rt1.rt ? formatEuro(g.rt1.rt.totale_giorno) : VUOTO}
                        {g.rt1.rt?.n1_non_quadra && (
                          <span title={`Tassa di soggiorno (esente N1: ${formatEuro(g.rt1.rt.esente_n1)}) non multiplo di 0,50 € — verifica i conti (RT1 condivide Du Parc 2,50€ e Club 2,00€)`} style={{ marginLeft: 4, cursor: 'help' }}>⚠️</span>
                        )}
                      </Td>
                      <Td num>{g.rt1.pms.totale > 0 ? formatEuro(g.rt1.pms.totale) : VUOTO}</Td>
                      <Td num style={{ color: d1.color, fontWeight: 700 }}>{d1.label}</Td>
                      {/* RT2 */}
                      <Td num gruppo>
                        {g.rt2.rt ? formatEuro(g.rt2.rt.totale_giorno) : VUOTO}
                        {g.rt2.rt?.n1_non_quadra && (
                          <span title={`Tassa di soggiorno (esente N1: ${formatEuro(g.rt2.rt.esente_n1)}) non multiplo di 2,00 € — verifica i conti`} style={{ marginLeft: 4, cursor: 'help' }}>⚠️</span>
                        )}
                      </Td>
                      <Td num>{g.rt2.pms.totale > 0 ? formatEuro(g.rt2.pms.totale) : VUOTO}</Td>
                      <Td num style={{ color: d2.color, fontWeight: 700 }}>{d2.label}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
            {isAdmin() && (
              <p className="ui-text-muted" style={{ marginTop: 8 }}>
                Clicca su una riga per inserire o modificare la chiusura RT del giorno.
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Pannello inserimento (solo admin, solo con giorno selezionato) ── */}
      {isAdmin() && giornoSel && (
        <Card style={{ width: 380, flexShrink: 0, position: 'sticky', top: 16, boxShadow: 'var(--shadow-pop)' }}
          title={<span style={{ color: colors.primary }}>{giornoSettimana(giornoSel)} {fmtD(giornoSel)}</span>}
          actions={<Button variant="ghost" size="sm" onClick={() => setGiornoSel(null)} aria-label="Chiudi">✕</Button>}
        >
          <FormRT
            label="RT1 — DPH + CLB"
            prefix="rt1"
            form={form}
            setForm={setForm}
            resetKey={giornoSel}
            onElimina={form.rt1_id ? () => eliminaRT('RT1', form.rt1_id) : null}
            pms={giornoDati?.rt1?.pms}
          />

          <div style={{ borderTop: `1px solid ${colors.border}`, margin: '14px 0' }} />

          <FormRT
            label="RT2 — INT"
            prefix="rt2"
            form={form}
            setForm={setForm}
            resetKey={giornoSel}
            onElimina={form.rt2_id ? () => eliminaRT('RT2', form.rt2_id) : null}
            pms={giornoDati?.rt2?.pms}
          />

          <div style={{ borderTop: `1px solid ${colors.border}`, margin: '14px 0' }} />

          <Field label="Note" style={{ width: '100%' }}>
            <Textarea rows={2} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={{ width: '100%' }} />
          </Field>

          {errPannello && <div style={{ marginTop: 10 }}><Messaggio tipo="err">{errPannello}</Messaggio></div>}

          <Button onClick={salva} disabled={salvando} style={{ marginTop: 12, width: '100%' }}>
            {salvando ? 'Salvataggio…' : 'Salva chiusure RT'}
          </Button>
        </Card>
      )}

      {dialogImport && (
        <Modal
          titolo="Importa CORRISP.xml"
          onChiudi={() => setDialogImport(false)}
          larghezza={460}
          chiudiSuSfondo={false}
          footer={<>
            <Button variant="secondary" onClick={() => setDialogImport(false)}>Chiudi</Button>
            <Button onClick={eseguiImport} disabled={importDisabilitato}>
              {importInCorso ? 'Importazione in corso…' : 'Importa'}
            </Button>
          </>}
        >
          <div style={{ whiteSpace: 'normal', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="ui-text-muted" style={{ marginTop: -4 }}>File prodotto dal registratore telematico dopo ogni chiusura Z.</div>

            <Field label="Registratore telematico" style={{ width: '100%' }}>
              <Select value={importRt} onChange={e => { setImportRt(e.target.value); setImportFiles([]); setImportMsg(null) }} style={{ width: '100%' }}>
                <option value="RT1">RT1 — Du Parc + Club Hotel</option>
                <option value="RT2">RT2 — Hotel International</option>
              </Select>
            </Field>

            <SegmentedControl
              value={importModalita}
              onChange={v => { setImportModalita(v); setImportFiles([]); setImportMsg(null) }}
              options={[{ value: 'cartella', label: 'Dalla cartella stampante' }, { value: 'locale', label: 'Carica da PC' }]}
            />

            {importModalita === 'cartella' ? (
              <Field label="Giorno chiusura" style={{ width: '100%' }}>
                <Input type="date" value={importDataCartella} onChange={e => setImportDataCartella(e.target.value)} style={{ width: '100%' }} />
                <span className="ui-text-muted" style={{ fontSize: 'var(--fs-xs)' }}>
                  Il backend cerca ed importa il file CORRISP.xml di questa data direttamente dalla
                  cartella della stampante del registratore selezionato.
                </span>
              </Field>
            ) : (
              <Field label="File CORRISP.xml" style={{ width: '100%' }}>
                <input type="file" accept=".xml" multiple className="ui-input"
                  onChange={e => setImportFiles(Array.from(e.target.files || []))} style={{ width: '100%' }} />
                <span className="ui-text-muted" style={{ fontSize: 'var(--fs-xs)' }}>
                  Seleziona più file se nello stesso giorno ci sono state più chiusure Z (es. dopo
                  una riapertura per un problema): i totali vengono sommati.
                </span>
                {importFiles.length > 0 && (
                  <span style={{ fontSize: 'var(--fs-sm)', color: colors.textSecond }}>
                    {importFiles.map(f => f.name + (dataDaNomeFile(f.name) ? ` (${dataDaNomeFile(f.name)})` : '')).join(', ')}
                  </span>
                )}
                {importFiles.some(f => !f.name.toUpperCase().includes('CORRISP')) && (
                  <Badge tono="warn">Verifica che siano file CORRISP.xml dell'RT</Badge>
                )}
              </Field>
            )}

            <Field label="Se già presente" style={{ width: '100%' }}>
              <Select value={importOnConflict} onChange={e => setImportOnConflict(e.target.value)} style={{ width: '100%' }}>
                <option value="salta">Salta se già presente</option>
                <option value="aggiorna">Aggiorna</option>
              </Select>
              {importOnConflict === 'aggiorna' && (
                <span className="ui-text-muted" style={{ fontSize: 'var(--fs-xs)' }}>Le righe modificate manualmente non verranno sovrascritte.</span>
              )}
            </Field>

            {importMsg && <Messaggio tipo={tonoImport[importMsg.tipo] || 'info'}>{importMsg.testo}</Messaggio>}
          </div>
        </Modal>
      )}
    </div>
  )
}
