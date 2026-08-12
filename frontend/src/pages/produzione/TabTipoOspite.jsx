import TabAnalisiDimensione from './TabAnalisiDimensione'

export default function TabTipoOspite({ lordo }) {
  return <TabAnalisiDimensione dimensione="tipo-ospite" campo="tipo_ospite" titolo="Analisi tipo ospite" lordo={lordo} />
}
