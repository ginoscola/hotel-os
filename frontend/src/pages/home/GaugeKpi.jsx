/**
 * Tachimetro KPI — SVG custom (nessuna libreria: Recharts non offre un gauge con lancetta +
 * fasce colorate fisse, vedi discussione in sessione). Semiarco 0..180°, 3 (o 5, per i gauge
 * bidirezionali) fasce colorate calcolate dalla soglia, lancetta che punta al valore.
 *
 * Prop `dato`: l'oggetto {valore, zona, soglia} restituito da _gauge() in routers/home.py
 * (soglia = {direzione, unita, target, soglia_rossa, soglia_arancione} oppure null se non
 * configurata per questo kpi — in quel caso l'arco resta grigio, solo il numero è mostrato).
 */
const COLORI = { rosso: '#ef4444', arancio: '#f59e0b', verde: '#10b981' }
const GRIGIO = '#e5e7eb'

function calcolaBande(soglia) {
  if (!soglia) return null
  const { direzione, target, soglia_rossa: rossa, soglia_arancione: arancione } = soglia

  if (direzione === 'alto_meglio') {
    const max = Math.max(arancione * 1.5, 1)
    return {
      min: 0, max,
      bande: [
        { da: 0, a: rossa, colore: COLORI.rosso },
        { da: rossa, a: arancione, colore: COLORI.arancio },
        { da: arancione, a: max, colore: COLORI.verde },
      ],
    }
  }
  if (direzione === 'basso_meglio') {
    const max = Math.max(rossa * 1.3, 1)
    return {
      min: 0, max,
      bande: [
        { da: 0, a: arancione, colore: COLORI.verde },
        { da: arancione, a: rossa, colore: COLORI.arancio },
        { da: rossa, a: max, colore: COLORI.rosso },
      ],
    }
  }
  // 'target' — bidirezionale, centrato sul target (es. Δ RT-PMS: target 0)
  const t = target || 0
  const raggio = Math.max(rossa * 1.4, 1)
  return {
    min: t - raggio, max: t + raggio,
    bande: [
      { da: t - raggio, a: t - rossa, colore: COLORI.rosso },
      { da: t - rossa, a: t - arancione, colore: COLORI.arancio },
      { da: t - arancione, a: t + arancione, colore: COLORI.verde },
      { da: t + arancione, a: t + rossa, colore: COLORI.arancio },
      { da: t + rossa, a: t + raggio, colore: COLORI.rosso },
    ],
  }
}

function defaultFormat(valore, unita) {
  if (valore == null) return '—'
  const n = valore.toLocaleString('it-IT', { maximumFractionDigits: 1 })
  if (unita === 'perc') return `${n}%`
  if (unita === 'euro') return `${n} €`
  return n
}

const CX = 100, CY = 96, R = 78, SPESSORE = 16

function punto(t, raggio) {
  const clamp = Math.min(1, Math.max(0, t))
  const angolo = (180 - clamp * 180) * Math.PI / 180
  return [CX + raggio * Math.cos(angolo), CY - raggio * Math.sin(angolo)]
}

function arco(t0, t1, raggio) {
  const [x0, y0] = punto(t0, raggio)
  const [x1, y1] = punto(t1, raggio)
  // Il gauge è un SEMIcerchio (180°): t∈[0,1] copre al massimo 180° di arco, quindi il tratto
  // richiesto non è mai quello "lungo" (>180°) del cerchio completo — large-arc-flag è sempre 0.
  // Bug reale: con `(t1-t0) > 0.5 ? 1 : 0` (soglia corretta solo per un cerchio intero, dove
  // 0.5 = 180°/360°) qualunque fascia oltre metà della scala veniva disegnata dal lato lungo,
  // finendo quasi tutta fuori dal viewBox — il frammento superstite appariva come un pezzo
  // sganciato vicino alla base dell'arco.
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${raggio} ${raggio} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

export default function GaugeKpi({ label, dato, formatValue, sub }) {
  const valore = dato?.valore ?? null
  const soglia = dato?.soglia ?? null
  const dom = calcolaBande(soglia)
  const range = dom ? dom.max - dom.min : 1
  const tValore = dom && valore != null ? (valore - dom.min) / range : null
  const fmt = formatValue || ((v) => defaultFormat(v, soglia?.unita))

  return (
    <div className="card" style={{ textAlign: 'center', minWidth: 170 }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
        {label}
      </div>
      <svg viewBox="0 0 200 108" style={{ width: '100%', maxWidth: 190, display: 'block', margin: '0 auto' }}>
        {dom ? (
          dom.bande.map((b, i) => (
            <path
              key={i}
              d={arco(Math.max(0, (b.da - dom.min) / range), Math.min(1, (b.a - dom.min) / range), R)}
              stroke={b.colore} strokeWidth={SPESSORE} fill="none"
            />
          ))
        ) : (
          <path d={arco(0, 1, R)} stroke={GRIGIO} strokeWidth={SPESSORE} fill="none" />
        )}
        {tValore != null && (() => {
          const [nx, ny] = punto(tValore, R - SPESSORE / 2 - 6)
          return (
            <g>
              <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="#1f2937" strokeWidth={3} strokeLinecap="round" />
              <circle cx={CX} cy={CY} r={6} fill="#1f2937" />
            </g>
          )
        })()}
      </svg>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#1a1a2e', marginTop: -2 }}>
        {fmt(valore)}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
