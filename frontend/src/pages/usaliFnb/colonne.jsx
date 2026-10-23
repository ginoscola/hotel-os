// Colonne/KPI condivisi tra Riepilogo e Andamento della scheda Food & Beverage.
import { formatEuro, formatN, formatPerc } from '../../utils/format.js'
import { Euro } from '../usaliContabile/helpers.jsx'

const euro2 = v => (v == null ? '—' : formatEuro(v))
const perc = v => (v == null ? '—' : formatPerc(v))
const num = v => (v == null ? '—' : formatN(v))

// [chiave, etichetta, render(v, scuro), gruppo (bordo di inizio gruppo), descrizione]
export const COLONNE = [
  ['ricavi', 'Ricavi', (v, s) => <Euro v={v} scuro={s} />, false, 'Produzione (ospiti) + corrispettivi (esterni MMS, Buona Onda), IVA esclusa'],
  ['ricavi_contabili', 'Ricavi contab.', (v, s) => <Euro v={v} scuro={s} />, false, 'Ricavi F&B registrati in contabilità, solo confronto'],
  ['food', 'Food', (v, s) => <Euro v={v} scuro={s} />, true, 'Materia prima alimentare (contabilità)'],
  ['beverage', 'Beverage', (v, s) => <Euro v={v} scuro={s} />, false, 'Bevande (contabilità)'],
  ['materia_prima_perc', 'Mat. prima %', perc, false, '(Food + Beverage) / ricavi'],
  ['personale', 'Personale', (v, s) => <Euro v={v} scuro={s} />, true, 'Costo aziendale dai cedolini, per centro di costo'],
  ['prime_cost_perc', 'Prime cost %', perc, false, '(Materia prima + personale) / ricavi'],
  ['altri_costi', 'Altri costi', (v, s) => <Euro v={v} scuro={s} />, false, 'Altri costi F&B della contabilità (attrezzature, carta, pulizia, conti senza categoria…)'],
  ['margine', 'Margine', (v, s) => <Euro v={v} scuro={s} />, true, 'Ricavi − materia prima − personale − altri costi'],
  ['margine_perc', 'Margine %', perc, false, 'Margine / ricavi'],
  ['coperti', 'Coperti', num, true, 'Pasti da Produzione; Mare Mosso = coperti Menu; Buona Onda = scontrini'],
  ['ricavo_coperto', 'Ricavo / cop.', euro2, false, 'Ricavo medio per coperto'],
  ['mp_coperto', 'Mat. prima / cop.', euro2, false, 'Materia prima per coperto'],
  ['costo_coperto', 'Costo / cop.', euro2, false, 'Costo pieno per coperto (materia prima + personale + altri)'],
  ['adesione_perc', 'Adesione', perc, false, 'Pasti / presenze degli ospiti hotel'],
]

// KPI selezionabili nell'andamento mensile
export const KPI_ANDAMENTO = {
  percentuali: [
    ['materia_prima_perc', 'Materia prima %'],
    ['food_perc', 'Food %'],
    ['beverage_perc', 'Beverage %'],
    ['prime_cost_perc', 'Prime cost %'],
    ['margine_perc', 'Margine %'],
  ],
  coperto: [
    ['ricavo_coperto', 'Ricavo / coperto'],
    ['mp_coperto', 'Materia prima / coperto'],
    ['costo_coperto', 'Costo pieno / coperto'],
  ],
}
