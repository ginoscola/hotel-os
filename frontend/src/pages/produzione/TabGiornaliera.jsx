import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { formatEuro, mostraErrore } from '../../utils/format'
import { ExportMenu } from '../../components/ExportMenu.jsx'
import {
  STRUTTURE_HOTEL, NOMI, fmtD, primoGiorno, ultimoGiorno,
  giornoSettimana, campoValore, meseAnnoPrecedente, OPZIONI_STRUTTURA,
} from '../../utils/produzioneHelpers'
import {
  Drawer, Loading, Messaggio, NavMese, SegmentedControl, Select, StatoVuoto, Table, Td, Th,
} from '../../components/ui'
import { colors } from '../../styles/tokens.js'

const VUOTO = colors.borderStrong

function DrawerRighe({ info, onClose, lordo }) {
  const [righe, setRighe] = useState([])
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState('')

  useEffect(() => {
    if (!info) return
    setLoading(true)
    setErrore('')
    api.get('/produzione/righe', {
      params: { data_da: info.data, data_a: info.data, struttura_code: info.struttura_code, categoria_code: info.categoria_code },
    })
      .then(r => setRighe(r.data))
      .catch(e => { setRighe([]); setErrore(mostraErrore(e)) })
      .finally(() => setLoading(false))
  }, [info])

  if (!info) return null

  return (
    <Drawer titolo={`${NOMI[info.struttura_code]} — ${info.categoria_name}`} sottotitolo={fmtD(info.data)} onChiudi={onClose}>
      {loading ? (
        <Loading />
      ) : errore ? (
        <Messaggio tipo="err">{errore}</Messaggio>
      ) : righe.length === 0 ? (
        <StatoVuoto>Nessuna riga per questa selezione.</StatoVuoto>
      ) : righe.map(r => (
        <div key={r.id} className="ui-drawer-item">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, color: colors.text }}>{r.dettaglio_originale || '—'}</span>
            <span className="ui-num" style={{ fontWeight: 700 }}>{formatEuro(lordo ? r.lordo : r.imponibile)}</span>
          </div>
          <div className="ui-text-muted" style={{ marginTop: 3 }}>
            {r.camera && <span>Cam. {r.camera} · </span>}
            {r.ospite && <span>{r.ospite}</span>}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: colors.textSubtle, marginTop: 2 }}>
            {r.trattamento && <span>{r.trattamento} · </span>}
            {r.canale && <span>{r.canale}</span>}
          </div>
        </div>
      ))}
    </Drawer>
  )
}

// Cella data con giorno della settimana; il sabato (inizio settimana commerciale) in grassetto
function CellaData({ data }) {
  const gg = giornoSettimana(data)
  return (
    <Td style={{ fontWeight: gg === 'sab' ? 700 : 400, color: colors.textSecond, whiteSpace: 'nowrap' }}>
      {fmtD(data)} <span style={{ color: colors.textSubtle, fontSize: 'var(--fs-xs)' }}>{gg}</span>
    </Td>
  )
}

// Tabella Data × Categoria per UN SOLO hotel — usata sia da sola (filtro struttura singola)
// sia ripetuta una volta per hotel dentro i blocchi accordion (vista "Tutte le strutture").
function TabellaHotel({ sc, giorni, byChiave, categorie, lordo, totMese, onCellClick, mostraColonnaTotale = true, mostraNomeHotel = false }) {
  return (
    <Table compact minWidth={700}>
      <thead>
        {mostraNomeHotel && (
          <tr>
            <Th rowSpan={2} style={{ verticalAlign: 'bottom' }}>Data</Th>
            <Th center gruppo colSpan={categorie.length + (mostraColonnaTotale ? 2 : 1)}>{NOMI[sc]}</Th>
          </tr>
        )}
        <tr className={mostraNomeHotel ? 'sub' : undefined}>
          {!mostraNomeHotel && <Th style={{ minWidth: 80 }}>Data</Th>}
          {categorie.map((c, i) => <Th key={c.code} num gruppo={i === 0}>{c.name}</Th>)}
          <Th num gruppo style={{ fontWeight: 700 }}>Tot.</Th>
          {mostraColonnaTotale && <Th num tot>TOT. GIORNO</Th>}
        </tr>
      </thead>
      <tbody>
        {giorni.map(data => {
          const g = byChiave[`${data}_${sc}`]
          return (
            <tr key={data} className={giornoSettimana(data) === 'sab' ? 'ui-riga-evidenza' : undefined}>
              <CellaData data={data} />
              {categorie.map((c, i) => {
                const val = campoValore(g?.per_categoria?.[c.code], lordo)
                return (
                  <Td key={c.code} num gruppo={i === 0}
                    style={{ color: val ? undefined : VUOTO, cursor: val ? 'pointer' : 'default' }}
                    onClick={() => val && onCellClick(data, c.code, c.name)}
                    title={val ? 'Clicca per vedere le singole righe' : undefined}
                  >
                    {val ? formatEuro(val) : '—'}
                  </Td>
                )
              })}
              <Td num gruppo style={{ fontWeight: 700 }}>{g ? formatEuro(campoValore(g.totale, lordo)) : '—'}</Td>
              {mostraColonnaTotale && (
                <Td num tot style={{ fontWeight: 700 }}>{g ? formatEuro(campoValore(g.totale, lordo)) : '—'}</Td>
              )}
            </tr>
          )
        })}

        <tr className="ui-riga-totale">
          <Td>TOTALE MESE</Td>
          {categorie.map((c, i) => (
            <Td key={c.code} num gruppo={i === 0}>{formatEuro(campoValore(totMese[c.code], lordo))}</Td>
          ))}
          <Td num gruppo style={{ fontWeight: 800 }}>{formatEuro(campoValore(totMese.totale, lordo))}</Td>
          {mostraColonnaTotale && (
            <Td num tot style={{ fontWeight: 800 }}>{formatEuro(campoValore(totMese.totale, lordo))}</Td>
          )}
        </tr>
      </tbody>
    </Table>
  )
}

// Riepilogo compatto per la vista "Tutte le strutture": solo i totali giornalieri per hotel
// affiancati (Data | Tot.DPH | Tot.CLB | Tot.INT | TOT.GIORNO) — colpo d'occhio veloce prima di
// aprire i blocchi dettagliati per categoria sotto.
function RiepilogoTutteStrutture({ strutture, giorni, byChiave, totMese, totGlobaleMese, lordo }) {
  return (
    <Table compact minWidth={500} style={{ marginBottom: 24 }}>
      <thead>
        <tr>
          <Th style={{ minWidth: 80 }}>Data</Th>
          {strutture.map(sc => <Th key={sc} num>{NOMI[sc]}</Th>)}
          <Th num tot>TOT. GIORNO</Th>
        </tr>
      </thead>
      <tbody>
        {giorni.map(data => {
          let totGiorno = 0
          return (
            <tr key={data} className={giornoSettimana(data) === 'sab' ? 'ui-riga-evidenza' : undefined}>
              <CellaData data={data} />
              {strutture.map(sc => {
                const g = byChiave[`${data}_${sc}`]
                const val = g ? campoValore(g.totale, lordo) : 0
                totGiorno += val
                return <Td key={sc} num style={{ color: val ? undefined : VUOTO }}>{val ? formatEuro(val) : '—'}</Td>
              })}
              <Td num tot style={{ fontWeight: 700 }}>{totGiorno ? formatEuro(totGiorno) : '—'}</Td>
            </tr>
          )
        })}

        <tr className="ui-riga-totale">
          <Td>TOTALE MESE</Td>
          {strutture.map(sc => <Td key={sc} num>{formatEuro(campoValore(totMese[sc].totale, lordo))}</Td>)}
          <Td num tot style={{ fontWeight: 800 }}>{formatEuro(campoValore(totGlobaleMese, lordo))}</Td>
        </tr>
      </tbody>
    </Table>
  )
}

// Blocco accordion per un hotel dentro la vista "Tutte le strutture": intestazione con nome
// hotel + totale mese sempre visibili anche da chiuso, corpo con la tabella dettagliata per
// categoria (TabellaHotel) collassabile.
function BloccoHotel({ sc, aperto, onToggle, giorni, byChiave, categorie, lordo, totMese, onCellClick }) {
  return (
    <div className="ui-card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aperto}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
          padding: '12px 18px', border: 'none', borderRadius: 0, cursor: 'pointer',
          background: colors.surfaceAlt, color: colors.text, fontSize: 'var(--fs-md)', fontWeight: 700,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, transform: aperto ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
          {NOMI[sc]}
        </span>
        <span className="ui-num">Totale mese: {formatEuro(campoValore(totMese.totale, lordo))}</span>
      </button>
      {aperto && (
        <div style={{ padding: 12 }}>
          <TabellaHotel
            sc={sc} giorni={giorni} byChiave={byChiave} categorie={categorie} lordo={lordo}
            totMese={totMese} onCellClick={onCellClick} mostraColonnaTotale={false}
          />
        </div>
      )}
    </div>
  )
}

export default function TabGiornaliera({ lordo }) {
  const def = meseAnnoPrecedente()
  const [anno, setAnno] = useState(def.anno)
  const [mese, setMese] = useState(def.mese)
  const [struttura, setStruttura] = useState('')
  const [categoria, setCategoria] = useState('')
  const [canale, setCanale] = useState('')
  const [trattamento, setTrattamento] = useState('')

  const [categorie, setCategorie] = useState([])
  const [canaliLista, setCanaliLista] = useState([])
  const [trattamentiLista, setTrattamentiLista] = useState([])
  const [dati, setDati] = useState([])
  const [loading, setLoading] = useState(false)
  const [drawer, setDrawer] = useState(null)
  const [aperti, setAperti] = useState(() => new Set(STRUTTURE_HOTEL))

  const da = primoGiorno(anno, mese)
  const a = ultimoGiorno(anno, mese)

  useEffect(() => {
    api.get('/produzione/categorie').then(r => setCategorie(r.data.filter(c => c.includi_report && c.attivo))).catch(() => {})
    api.get('/produzione/canali/lista').then(r => setCanaliLista(r.data)).catch(() => {})
    api.get('/produzione/trattamenti/lista').then(r => setTrattamentiLista(r.data)).catch(() => {})
  }, [])

  const carica = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/produzione/report/giornaliero', {
        params: {
          data_da: da, data_a: a,
          struttura_code: struttura || undefined,
          categoria_code: categoria || undefined,
          canale: canale || undefined,
          trattamento: trattamento || undefined,
        },
      })
      setDati(data)
    } catch { /* ignora */ }
    finally { setLoading(false) }
  }, [da, a, struttura, categoria, canale, trattamento])

  useEffect(() => { carica() }, [carica])

  const strutture = struttura ? [struttura] : STRUTTURE_HOTEL
  const vistaTutte = !struttura

  // Genera tutte le date del mese
  const giorni = []
  const cur = new Date(da + 'T00:00:00')
  const end = new Date(a + 'T00:00:00')
  while (cur <= end) {
    giorni.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`)
    cur.setDate(cur.getDate() + 1)
  }

  const byChiave = {}
  dati.forEach(g => { byChiave[`${g.data}_${g.struttura_code}`] = g })

  const toggleHotel = (sc) => {
    setAperti(prev => {
      const next = new Set(prev)
      if (next.has(sc)) next.delete(sc)
      else next.add(sc)
      return next
    })
  }

  // Totali mese per struttura/categoria
  const totMese = {}
  strutture.forEach(sc => {
    totMese[sc] = {}
    categorie.forEach(c => { totMese[sc][c.code] = { lordo: 0, imponibile: 0 } })
    totMese[sc].totale = { lordo: 0, imponibile: 0 }
  })
  let totGlobaleMese = { lordo: 0, imponibile: 0 }
  giorni.forEach(data => {
    strutture.forEach(sc => {
      const g = byChiave[`${data}_${sc}`]
      if (!g) return
      categorie.forEach(c => {
        const v = g.per_categoria[c.code]
        if (!v) return
        totMese[sc][c.code].lordo += v.lordo
        totMese[sc][c.code].imponibile += v.imponibile
      })
      totMese[sc].totale.lordo += g.totale.lordo
      totMese[sc].totale.imponibile += g.totale.imponibile
      totGlobaleMese.lordo += g.totale.lordo
      totGlobaleMese.imponibile += g.totale.imponibile
    })
  })

  const apriDrawer = (sc) => (data, categoria_code, categoria_name) =>
    setDrawer({ data, struttura_code: sc, categoria_code, categoria_name })

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <NavMese anno={anno} mese={mese} onChange={({ anno: y, mese: m }) => { setAnno(y); setMese(m) }} />
        <SegmentedControl value={struttura} onChange={setStruttura} options={OPZIONI_STRUTTURA} />
        <Select value={categoria} onChange={e => setCategoria(e.target.value)} aria-label="Categoria">
          <option value="">Tutte le categorie</option>
          {categorie.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
        </Select>
        <Select value={canale} onChange={e => setCanale(e.target.value)} aria-label="Canale">
          <option value="">Tutti i canali</option>
          {canaliLista.map(c => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select value={trattamento} onChange={e => setTrattamento(e.target.value)} aria-label="Trattamento">
          <option value="">Tutti i trattamenti</option>
          {trattamentiLista.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>

        <div style={{ marginLeft: 'auto' }}>
          <ExportMenu
            url={`/produzione/export/giornaliero?data_da=${da}&data_a=${a}${struttura ? `&struttura_code=${struttura}` : ''}${categoria ? `&categoria_code=${categoria}` : ''}${canale ? `&canale=${encodeURIComponent(canale)}` : ''}${trattamento ? `&trattamento=${encodeURIComponent(trattamento)}` : ''}`}
            nome={`produzione_giornaliero_${anno}_${mese}`}
          />
        </div>
      </div>

      {loading && <Loading />}

      {vistaTutte ? (
        <>
          <RiepilogoTutteStrutture
            strutture={strutture} giorni={giorni} byChiave={byChiave}
            totMese={totMese} totGlobaleMese={totGlobaleMese} lordo={lordo}
          />
          {strutture.map(sc => (
            <BloccoHotel
              key={sc} sc={sc} aperto={aperti.has(sc)} onToggle={() => toggleHotel(sc)}
              giorni={giorni} byChiave={byChiave} categorie={categorie} lordo={lordo}
              totMese={totMese[sc]} onCellClick={apriDrawer(sc)}
            />
          ))}
        </>
      ) : (
        <TabellaHotel
          sc={struttura} giorni={giorni} byChiave={byChiave} categorie={categorie} lordo={lordo}
          totMese={totMese[struttura]} onCellClick={apriDrawer(struttura)} mostraColonnaTotale={true}
          mostraNomeHotel={true}
        />
      )}

      {drawer && <DrawerRighe info={drawer} onClose={() => setDrawer(null)} lordo={lordo} />}
    </div>
  )
}
