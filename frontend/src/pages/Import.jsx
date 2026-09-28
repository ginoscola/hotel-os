import { useState, useEffect } from 'react'
import api from '../api/client.js'
import { formatEuro, formatPerc, formatData, mostraErrore } from '../utils/format.js'
import {
  Badge, Button, Card, Checkbox, Field, FileButton, Input, KpiTile, Loading, Messaggio, PageHeader, Select,
  Table, Td, Th,
} from '../components/ui'
import { colors } from '../styles/tokens.js'

// Replica della logica backend: estrae snapshot_date dai primi 8 caratteri del basename
function estraiSnapshotDate(nomeFile) {
  const base = (nomeFile || '').split('/').pop()
  if (base.length >= 8 && /^\d{8}/.test(base)) {
    const y = parseInt(base.slice(0, 4), 10)
    const m = parseInt(base.slice(4, 6), 10)
    const d = parseInt(base.slice(6, 8), 10)
    const dt = new Date(y, m - 1, d)
    if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }
  return null
}

// Replica della logica backend: codice hotel dagli ultimi 4 caratteri dello stem
function estraiHotelCode(nomeFile) {
  const base = (nomeFile || '').split('/').pop()
  const stem = base.replace(/\.[^.]+$/, '')
  if (!stem || !['1', '2'].includes(stem[stem.length - 1])) return null
  const candidate = stem.slice(Math.max(0, stem.length - 4), stem.length - 1)
  const alpha = candidate.replace(/[^A-Za-z]/g, '').toUpperCase()
  if (alpha.length >= 2 && alpha.length <= 5) return alpha
  return null
}

function formatDataIT(isoStr) {
  if (!isoStr) return '—'
  const [y, m, d] = isoStr.split('-')
  return `${d}/${m}/${y}`
}

export default function Import() {
  const [hotels, setHotels] = useState([])
  const [hotelsLoading, setHotelsLoading] = useState(true)
  const [hotelsErrore, setHotelsErrore] = useState(null)

  const [hotel, setHotel] = useState('')
  const [file1, setFile1] = useState(null)
  const [file2, setFile2] = useState(null)
  const [snapshotDate, setSnapshotDate] = useState('')
  const [dateRilevata, setDateRilevata] = useState(false)
  const [isTest, setIsTest] = useState(false)
  const [loading, setLoading] = useState(false)
  const [risultato, setRisultato] = useState(null)
  const [errore, setErrore] = useState(null)

  // Carica lista hotel dal backend al mount
  useEffect(() => {
    api.get('/hotels/')
      .then(({ data }) => {
        setHotels(data)
        if (data.length > 0) setHotel(data[0].code)
      })
      .catch(() => setHotelsErrore('Impossibile caricare la lista hotel. Verificare la connessione al server.'))
      .finally(() => setHotelsLoading(false))
  }, [])

  // Quando cambiano i file: aggiorna snapshot_date e hotel rilevati dal nome
  useEffect(() => {
    const primoFile = file1 || file2
    if (!primoFile) return

    const snap = estraiSnapshotDate(primoFile.name)
    setSnapshotDate(snap || '')
    setDateRilevata(!!snap)

    const codici = hotels.map(h => h.code)
    const code = estraiHotelCode(primoFile.name) || estraiHotelCode((file2 || file1)?.name || '')
    if (code && codici.includes(code)) {
      setHotel(code)
    }
  }, [file1, file2, hotels])

  const snapshotValida = /^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file1 || !file2) { setErrore('Seleziona entrambi i file.'); return }
    if (!snapshotValida) { setErrore('Inserisci una data snapshot valida.'); return }

    setLoading(true)
    setRisultato(null)
    setErrore(null)

    const form = new FormData()
    form.append('file1', file1)
    form.append('file2', file2)

    try {
      const { data } = await api.post(
        `/upload/coppia/${hotel}?snapshot_date=${snapshotDate}&is_test=${isTest}`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      setRisultato(data)
    } catch (err) {
      setErrore(mostraErrore(err))
    } finally {
      setLoading(false)
    }
  }

  const titolo = <PageHeader title="Importazione dati CSV / Excel" subtitle="Revenue — coppia di file Planning Forecast" />

  if (hotelsLoading) return <div>{titolo}<Loading testo="Caricamento lista hotel in corso…" /></div>
  if (hotelsErrore) return <div>{titolo}<div style={{ maxWidth: 640 }}><Messaggio tipo="err">{hotelsErrore}</Messaggio></div></div>

  const scegliFile = (n, file, setFile) => (
    <Field label={`File ${n} di 2`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <FileButton accept=".csv,.xlsx,.xls" size="sm" onFile={setFile}>Scegli…</FileButton>
        <span className="ui-text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={file?.name}>
          {file?.name || 'nessun file'}
        </span>
      </div>
    </Field>
  )

  return (
    <div>
      {titolo}

      <Card style={{ maxWidth: 640, marginBottom: 24 }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Hotel" style={{ width: '100%' }}>
            <Select value={hotel} onChange={e => setHotel(e.target.value)} style={{ width: '100%' }}>
              {hotels.map(h => <option key={h.code} value={h.code}>{h.name} ({h.code})</option>)}
            </Select>
          </Field>

          <div>
            <p className="ui-text-muted" style={{ margin: '0 0 8px' }}>
              Carica i due file in qualsiasi ordine — il sistema riconosce automaticamente quale contiene il ristorante.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {scegliFile(1, file1, setFile1)}
              {scegliFile(2, file2, setFile2)}
            </div>
          </div>

          <Field label="Data snapshot (data del forecast)">
            {!dateRilevata && (file1 || file2) && (
              <span style={{ fontSize: 'var(--fs-sm)', color: colors.warningText }}>Data non rilevata dal nome file — inserisci manualmente</span>
            )}
            <Input type="date" value={snapshotDate} modificato={!snapshotValida && !!(file1 || file2)}
              onChange={e => { setSnapshotDate(e.target.value); setDateRilevata(false) }} style={{ width: 180 }} />
          </Field>

          {/* Riepilogo */}
          {(file1 || file2) && (
            <div style={{ background: colors.surfaceSoft, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 14px', fontSize: 'var(--fs-base)' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Riepilogo importazione</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px' }}>
                <span style={{ color: colors.textMuted }}>File 1:</span><span>{file1?.name || '—'}</span>
                <span style={{ color: colors.textMuted }}>File 2:</span><span>{file2?.name || '—'}</span>
                <span style={{ color: colors.textMuted }}>Hotel:</span>
                <span>{hotels.find(h => h.code === hotel)?.name ?? hotel} ({hotel})</span>
                <span style={{ color: colors.textMuted }}>Snapshot:</span>
                <span style={{ color: snapshotValida ? colors.successText : colors.warningText, fontWeight: snapshotValida ? 600 : 400 }}>
                  {snapshotValida ? formatDataIT(snapshotDate) : 'non impostata'}
                </span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Checkbox checked={isTest} onChange={setIsTest} label="Dati di test (cancellabili dall'area Admin)" />
            {isTest && <Badge tono="warn">TEST</Badge>}
          </div>

          <div>
            <Button type="submit" disabled={loading || !snapshotValida || !file1 || !file2}>
              {loading ? 'Importazione in corso…' : 'Importa'}
            </Button>
          </div>
        </form>
      </Card>

      {errore && <div style={{ maxWidth: 640 }}><Messaggio tipo="err" onChiudi={() => setErrore(null)}>Errore: {errore}</Messaggio></div>}

      {risultato && <RisultatoImport r={risultato} />}
    </div>
  )
}

function RisultatoImport({ r }) {
  const kpi = r.kpi_periodo

  return (
    <div style={{ maxWidth: 920 }}>
      <Card title={`${r.hotel_code} — ${r.messaggio}`} style={{ marginBottom: 20 }}>
        <div className="ui-kpi-row" style={{ marginBottom: 0 }}>
          <KpiTile label="Righe lette" value={r.righe_lette} minWidth={120} />
          <KpiTile label="Importate" value={r.righe_importate} minWidth={120} />
          <KpiTile label="Inserite" value={r.righe_inserite} colore={colors.successText} minWidth={120} />
          <KpiTile label="Aggiornate" value={r.righe_aggiornate} colore={colors.infoText} minWidth={120} />
          <KpiTile label="Scartate" value={r.righe_scartate} colore={colors.warningText} minWidth={120} />
          <KpiTile label="Fuori stagione" value={r.righe_fuori_stagione} colore={colors.textMuted} minWidth={120} />
        </div>
        {r.periodo_da && (
          <p className="ui-text-muted" style={{ marginTop: 12, marginBottom: 0 }}>
            Periodo: {formatData(r.periodo_da)} – {formatData(r.periodo_a)}
            {r.snapshot_date && <> · Snapshot: {formatData(r.snapshot_date)}</>}
          </p>
        )}
      </Card>

      {kpi && (
        <Card title="KPI del periodo importato" style={{ marginBottom: 20 }}>
          <div className="ui-kpi-grid" style={{ marginBottom: 0 }}>
            <KpiTile label="Camere vendute" value={kpi.rooms_sold} />
            <KpiTile label="Camere disponibili" value={kpi.rooms_available} />
            <KpiTile label="Occupazione" value={kpi.occupancy != null ? formatPerc(kpi.occupancy) : '—'} />
            <KpiTile label="ADR" value={kpi.adr != null ? formatEuro(kpi.adr) : '—'} />
            <KpiTile label="RevPAR" value={kpi.revpar != null ? formatEuro(kpi.revpar) : '—'} />
            <KpiTile label="TRevPAR" value={kpi.trevpar != null ? formatEuro(kpi.trevpar) : '—'} />
            <KpiTile label="RMC" value={kpi.rmc != null ? formatEuro(kpi.rmc) : '—'} />
            <KpiTile label="Inc. Rooms" value={kpi.inc_rooms != null ? formatPerc(kpi.inc_rooms) : '—'} />
            <KpiTile label="Inc. F&B" value={kpi.inc_fnb != null ? formatPerc(kpi.inc_fnb) : '—'} />
            <KpiTile label="Inc. Extra" value={kpi.inc_extra != null ? formatPerc(kpi.inc_extra) : '—'} />
          </div>
        </Card>
      )}

      {r.anomalie?.length > 0 && (
        <Card title={`Anomalie rilevate (${r.anomalie.length})`} style={{ marginBottom: 20 }}>
          <Table compact>
            <thead><tr><Th>Tipo</Th><Th>Data</Th><Th>Descrizione</Th></tr></thead>
            <tbody>
              {r.anomalie.map((a, i) => (
                <tr key={i}>
                  <Td><Badge tono="warn">{a.tipo}</Badge></Td>
                  <Td style={{ whiteSpace: 'nowrap' }}>{formatData(a.data)}</Td>
                  <Td>{a.descrizione}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {r.warnings?.length > 0 && (
        <Messaggio tipo="warn">
          <strong>Avvisi ({r.warnings.length})</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {r.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Messaggio>
      )}
    </div>
  )
}
