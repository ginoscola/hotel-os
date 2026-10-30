import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { ExportMenu } from '../../components/ExportMenu.jsx'
import {
  Button, HotelTag, Input, KpiTile, Loading, Messaggio, SectionTitle, Table, Td, Th, useAvvisi, useConferma,
} from '../../components/ui'
import { colors } from '../../styles/tokens.js'
import { isAdmin } from '../../utils/auth.js'
import { formatEuro, formatN, mostraErrore } from '../../utils/format.js'

const MESI = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

const fmtGiorno = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const coloreSegno = (v) => v == null ? undefined : (v >= 0 ? colors.success : colors.danger)
const conSegno = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${formatEuro(v)}`
const zeroComeVuoto = (v) => v ? formatEuro(v) : '—'

function CellaBudget({ valore, note, modificabile, onSalva }) {
  const [bozza, setBozza] = useState(null)
  if (!modificabile) return <span title={note || undefined}>{zeroComeVuoto(valore)}</span>
  const salva = async () => {
    if (bozza === null) return
    const nuovo = bozza.trim() === '' ? null : Number(bozza.replace(',', '.'))
    if (nuovo !== (valore ?? null)) await onSalva(nuovo)
    setBozza(null)
  }
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={bozza ?? (valore ?? '')}
      title={note || undefined}
      onChange={e => setBozza(e.target.value)}
      onBlur={salva}
      onKeyDown={e => e.key === 'Enter' && e.target.blur()}
      style={{ width: 90, textAlign: 'right' }}
      aria-label="Budget"
    />
  )
}

export default function TabRistoranti({ anno, version }) {
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const [precompilando, setPrecompilando] = useState(false)
  const avvisi = useAvvisi()
  const conferma = useConferma()
  const admin = isAdmin()

  const carica = useCallback(async () => {
    try {
      const { data } = await api.get(`/budget-ristoranti/${anno}?version=${version}`)
      setDati(data)
      setErrore(null)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore caricamento budget ristoranti'))
    }
  }, [anno, version])

  useEffect(() => { setDati(null); carica() }, [carica])

  async function salva(week, codice, importo) {
    if (importo !== null && (!Number.isFinite(importo) || importo < 0)) {
      avvisi.errore('Inserire un importo valido, non negativo')
      return
    }
    try {
      await api.put(`/budget-ristoranti/${anno}/${week}`, { struttura_code: codice, version, importo })
      await carica()
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore salvataggio budget'))
    }
  }

  async function precompila() {
    const annoPrec = anno - 1
    if (!(await conferma({
      titolo: `Riempire con i dati ${annoPrec}?`,
      messaggio: `Ogni settimana riceve l'incasso reale della settimana corrispondente del ${annoPrec}. ` +
        `Versione ${version}. Le settimane senza incassi ${annoPrec} restano vuote.`,
      confermaLabel: 'Riempi',
    }))) return
    let sovrascrivi = false
    if (dati?.totali.totale.budget > 0) {
      sovrascrivi = await conferma({
        titolo: 'Ci sono già settimane compilate',
        messaggio: 'Sovrascriverle o riempire solo quelle vuote?',
        confermaLabel: 'Sovrascrivi tutto',
        annullaLabel: 'Solo le vuote',
        pericolo: true,
      })
    }
    setPrecompilando(true)
    try {
      const { data } = await api.post(
        `/budget-ristoranti/${anno}/precompila?version=${version}&sovrascrivi=${sovrascrivi}`
      )
      if (data.n_compilate === 0 && data.n_saltate === 0) {
        avvisi.attenzione(`Nessun incasso ${annoPrec} da cui riempire`)
      } else {
        avvisi.successo(`Compilate ${formatN(data.n_compilate)} celle con i dati ${annoPrec}`)
      }
      await carica()
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore riempimento da anno precedente'))
    } finally {
      setPrecompilando(false)
    }
  }

  if (errore) return <Messaggio tipo="err" onChiudi={() => setErrore(null)}>{errore}</Messaggio>
  if (!dati) return <Loading />

  const { ristoranti, settimane, mesi, totali } = dati
  const tot = totali.totale

  return (
    <div>
      <p className="ui-text-muted" style={{ marginTop: 0 }}>
        Importi IVA inclusa. Mare Mosso: solo clienti esterni, gli ospiti Du Parc sono nel F&amp;B del budget Du Parc.
        Il consuntivo viene dai corrispettivi inseriti a mano.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {admin && (
          <Button variant="secondary" onClick={precompila} disabled={precompilando}>
            {precompilando ? 'Riempimento…' : `Riempi con dati ${anno - 1}`}
          </Button>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <ExportMenu
            url={`/budget-ristoranti/${anno}/export?version=${version}`}
            nome={`Budget_ristoranti_${anno}_${version}`}
          />
        </div>
      </div>

      <div className="ui-kpi-row">
        <KpiTile label="Budget" value={formatEuro(tot.budget)} minWidth={170} />
        <KpiTile label="Consuntivo" value={formatEuro(tot.consuntivo)} minWidth={170} />
        <KpiTile
          label="Scostamento"
          value={conSegno(tot.scostamento)}
          colore={coloreSegno(tot.scostamento)}
          sub={`sulle settimane chiuse${tot.scostamento_pct != null ? ` (${(tot.scostamento_pct * 100).toFixed(1)}%)` : ''}`}
          minWidth={170}
        />
        <KpiTile label="Proiezione" value={formatEuro(tot.proiezione)} sub="consuntivo + budget restante" minWidth={170} />
      </div>

      <Table compact style={{ marginBottom: 24 }}>
        <thead>
          <tr>
            <Th rowSpan={2}>Settimana</Th>
            <Th rowSpan={2}>Mese</Th>
            {ristoranti.map(r => <Th key={r.code} colSpan={3} center gruppo>{r.nome}</Th>)}
            <Th colSpan={2} center gruppo>Totale</Th>
          </tr>
          <tr className="sub">
            {ristoranti.map(r => [
              <Th key={`${r.code}-b`} num gruppo>Budget</Th>,
              <Th key={`${r.code}-c`} num>Consuntivo</Th>,
              <Th key={`${r.code}-s`} num>Δ</Th>,
            ])}
            <Th num gruppo>Budget</Th>
            <Th num>Consuntivo</Th>
          </tr>
        </thead>
        <tbody>
          {settimane.map(s => {
            const budget = ristoranti.reduce((t, r) => t + (s[r.code].budget || 0), 0)
            const consuntivo = ristoranti.reduce((t, r) => t + (s[r.code].consuntivo || 0), 0)
            return (
              <tr key={s.week_start}>
                <Td>{fmtGiorno(s.week_start)}–{fmtGiorno(s.week_end)}</Td>
                <Td muted>{MESI[s.mese]}</Td>
                {ristoranti.map(r => {
                  const c = s[r.code]
                  return [
                    <Td key={`${r.code}-b`} num gruppo>
                      <CellaBudget
                        valore={c.budget}
                        note={c.note}
                        modificabile={admin}
                        onSalva={v => salva(s.week_start, r.code, v)}
                      />
                    </Td>,
                    <Td key={`${r.code}-c`} num>{c.consuntivo != null ? formatEuro(c.consuntivo) : '—'}</Td>,
                    <Td key={`${r.code}-s`} num style={{ color: coloreSegno(c.scostamento) }}>{conSegno(c.scostamento)}</Td>,
                  ]
                })}
                <Td num gruppo>{zeroComeVuoto(budget)}</Td>
                <Td num>{zeroComeVuoto(consuntivo)}</Td>
              </tr>
            )
          })}
          <tr className="ui-riga-totale">
            <Td colSpan={2}>TOTALE</Td>
            {ristoranti.map(r => [
              <Td key={`${r.code}-b`} num gruppo>{formatEuro(totali[r.code].budget)}</Td>,
              <Td key={`${r.code}-c`} num>{formatEuro(totali[r.code].consuntivo)}</Td>,
              <Td key={`${r.code}-s`} num>{conSegno(totali[r.code].scostamento)}</Td>,
            ])}
            <Td num gruppo>{formatEuro(tot.budget)}</Td>
            <Td num>{formatEuro(tot.consuntivo)}</Td>
          </tr>
        </tbody>
      </Table>

      <SectionTitle>Per mese contabile</SectionTitle>
      <Table compact>
        <thead>
          <tr>
            <Th>Mese</Th>
            {ristoranti.map(r => [
              <Th key={`${r.code}-b`} num gruppo><HotelTag code={r.code} /> Budget</Th>,
              <Th key={`${r.code}-c`} num>Consuntivo</Th>,
            ])}
            <Th num gruppo>Totale budget</Th>
            <Th num>Totale consuntivo</Th>
            <Th num>Proiezione</Th>
          </tr>
        </thead>
        <tbody>
          {mesi.filter(m => m.totale.budget || m.totale.consuntivo).map(m => (
            <tr key={`${m.anno}-${m.mese}`}>
              <Td>{MESI[m.mese]}</Td>
              {ristoranti.map(r => [
                <Td key={`${r.code}-b`} num gruppo>{zeroComeVuoto(m[r.code].budget)}</Td>,
                <Td key={`${r.code}-c`} num>{zeroComeVuoto(m[r.code].consuntivo)}</Td>,
              ])}
              <Td num gruppo>{zeroComeVuoto(m.totale.budget)}</Td>
              <Td num>{zeroComeVuoto(m.totale.consuntivo)}</Td>
              <Td num>{zeroComeVuoto(m.totale.proiezione)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
