// Barra di navigazione tra snapshot/settimane con i due confronti mutuamente esclusivi
// (periodo precedente / anno precedente). Condivisa da Dashboard Hotel e Dashboard Gruppo.
import { Badge, Button, Card, Checkbox } from './ui'

export default function NavigazioneSnapshot({
  titolo, sottotitolo, extra,
  onPrec, onSucc, disPrec, disSucc,
  etichettaPrec = 'Confronta snapshot precedente',
  confrontaPrec, onConfrontaPrec, confrontaAnno, onConfrontaAnno,
  confrontoNonDisponibile,
}) {
  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Button variant="secondary" size="sm" onClick={onPrec} disabled={disPrec}>← Prec.</Button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>{titolo}</span>
          {sottotitolo && <span className="ui-text-muted" style={{ marginLeft: 8 }}>{sottotitolo}</span>}
          {extra}
        </div>
        <Button variant="secondary" size="sm" onClick={onSucc} disabled={disSucc}>Succ. →</Button>
      </div>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        <Checkbox label={etichettaPrec} checked={confrontaPrec}
          onChange={v => { onConfrontaPrec(v); if (v) onConfrontaAnno(false) }} />
        <Checkbox label="Confronta anno precedente" checked={confrontaAnno}
          onChange={v => { onConfrontaAnno(v); if (v) onConfrontaPrec(false) }} />
        {confrontoNonDisponibile && <Badge>Dati confronto non disponibili</Badge>}
      </div>
    </Card>
  )
}
