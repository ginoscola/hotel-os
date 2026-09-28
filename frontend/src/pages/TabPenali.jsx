import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { ExportMenu } from '../components/ExportMenu'
import { formatEuro, mostraErrore } from '../utils/format'
import { STRUTTURE_HOTEL, fmtD } from '../utils/corrispettiviHelpers'
import {
  Badge, Field, HotelTag, Input, Messaggio, Paginazione, Select, StatoVuoto, Table, Td, Th,
} from '../components/ui'
import { colors } from '../styles/tokens.js'

const TIPO_LABEL = { scontrino: 'Scontrino', fattura: 'Fattura' }

export default function TabPenali({ refreshKey }) {
  const [filtri, setFiltri] = useState({ data_da: '', data_a: '', struttura_code: '', numero: '' })
  const [docs, setDocs] = useState([])
  const [totale, setTotale] = useState(0)
  const [totaleImporto, setTotaleImporto] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)

  const PER_PAGE = 50

  const carica = useCallback(async () => {
    setLoading(true)
    setErrore(null)
    try {
      const params = { page, per_page: PER_PAGE, ...filtri }
      Object.keys(params).forEach(k => !params[k] && params[k] !== 0 && delete params[k])
      const { data } = await api.get('/corrispettivi/penali', { params })
      setDocs(data.documenti || [])
      setTotale(data.totale || 0)
      setTotaleImporto(data.totale_importo ?? null)
    } catch (e) {
      setErrore(mostraErrore(e, 'Errore caricamento'))
    } finally {
      setLoading(false)
    }
  }, [page, filtri, refreshKey])

  useEffect(() => { carica() }, [carica])

  const setFiltro = (k, v) => { setFiltri(f => ({ ...f, [k]: v })); setPage(1) }

  const exportParams = new URLSearchParams(filtri)
  Array.from(exportParams.keys()).forEach(k => !exportParams.get(k) && exportParams.delete(k))
  const exportUrl = `/corrispettivi/export/penali?${exportParams.toString()}`

  return (
    <div>
      {/* Filtri */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
        <Field label="Dal"><Input type="date" value={filtri.data_da} onChange={e => setFiltro('data_da', e.target.value)} /></Field>
        <Field label="Al"><Input type="date" value={filtri.data_a} onChange={e => setFiltro('data_a', e.target.value)} /></Field>
        <Field label="Struttura">
          <Select value={filtri.struttura_code} onChange={e => setFiltro('struttura_code', e.target.value)}>
            <option value="">Tutte</option>
            {STRUTTURE_HOTEL.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="N. documento">
          <Input value={filtri.numero} onChange={e => setFiltro('numero', e.target.value)} placeholder="es. 1042" style={{ width: 100 }} />
        </Field>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <span className="ui-text-muted">{loading ? 'Caricamento…' : `${totale} penali trovate`}</span>
        {!loading && totaleImporto !== null && (
          <Badge tono="err" style={{ fontSize: 'var(--fs-sm)', padding: '3px 10px' }}>Totale filtrato: {formatEuro(totaleImporto)}</Badge>
        )}
        <span style={{ marginLeft: 'auto' }}>
          <ExportMenu url={exportUrl} nome="corrispettivi_penali" />
        </span>
      </div>
      <Messaggio tipo="err">{errore}</Messaggio>

      {!loading && docs.length === 0 && !errore && (
        <StatoVuoto>Nessuna penale trovata per i filtri selezionati.</StatoVuoto>
      )}

      {!loading && docs.length > 0 && (
        <Table compact>
          <thead>
            <tr>
              <Th>Data</Th><Th>N. Documento</Th><Th>Tipo</Th><Th>Struttura</Th>
              <Th>Intestatario</Th><Th num>Importo</Th><Th center>Ann.</Th>
            </tr>
          </thead>
          <tbody>
            {docs.map(d => (
              <tr key={d.id} className={d.annullato ? 'ui-riga-annullata' : undefined}>
                <Td style={{ color: colors.textSecond }}>{fmtD(d.data_documento)}</Td>
                <Td>{d.numero}{d.suffisso ? <span style={{ color: colors.textSubtle }}> {d.suffisso}</span> : null}</Td>
                <Td style={{ color: colors.textMuted }}>{TIPO_LABEL[d.tipo] || d.tipo}</Td>
                <Td><HotelTag code={d.struttura_code} /></Td>
                <Td>{d.intestazione || <span style={{ color: colors.borderStrong }}>—</span>}</Td>
                <Td num style={{ color: d.totale_lordo < 0 ? colors.danger : undefined, fontWeight: 600 }}>
                  {formatEuro(d.totale_lordo || 0)}
                </Td>
                <Td center style={{ color: colors.danger }}>{d.annullato ? '✗' : ''}</Td>
              </tr>
            ))}
            <tr className="ui-riga-sezione">
              <Td colSpan={5} style={{ textAlign: 'right', fontSize: 'var(--fs-sm)' }}>Totale pagina ({docs.length} doc.):</Td>
              <Td num>{formatEuro(docs.reduce((s, d) => s + (d.totale_lordo || 0), 0))}</Td>
              <Td />
            </tr>
          </tbody>
        </Table>
      )}

      {totale > PER_PAGE && (
        <Paginazione pagina={page} perPagina={PER_PAGE} totale={totale} onChange={setPage} estremi />
      )}
    </div>
  )
}
