import TabAnalisiDimensione from './TabAnalisiDimensione'

export default function TabTrattamenti({ lordo }) {
  return <TabAnalisiDimensione dimensione="trattamenti" campo="trattamento" titolo="Analisi trattamenti" lordo={lordo} />
}
