// Stili condivisi — tema light per tutte le pagine HotelOS

export const colors = {
  pageBg:       '#f5f7fa',
  cardBg:       '#fff',
  cardBorder:   '#e2e8f0',
  textPrimary:  '#1e293b',
  textMuted:    '#64748b',
  textWhite:    '#fff',
  headerBg:     '#1a1a2e',
  btnPrimary:   '#d97706',
  btnSecondary: '#f1f5f9',
  btnDanger:    '#dc2626',
  inputBorder:  '#e2e8f0',
  rowBorder:    '#f1f5f9',
  subTileBg:    '#f8fafc',
  accent:       '#d97706',
}

export const cardStyle = {
  background: colors.cardBg,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: 8,
  padding: '14px 18px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
}

export const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
}

export const thStyle = {
  padding: '10px 12px',
  background: colors.headerBg,
  color: colors.textWhite,
  fontWeight: 700,
  textAlign: 'left',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  whiteSpace: 'nowrap',
}

export const tdStyle = {
  padding: '9px 12px',
  borderBottom: `1px solid ${colors.rowBorder}`,
  color: colors.textPrimary,
  verticalAlign: 'middle',
}

export const inputStyle = {
  padding: '7px 10px',
  border: `1px solid ${colors.inputBorder}`,
  borderRadius: 6,
  fontSize: 13,
  background: colors.cardBg,
  color: colors.textPrimary,
  outline: 'none',
}

export const btnPrimary = {
  padding: '7px 16px',
  background: colors.btnPrimary,
  color: colors.textWhite,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}

export const btnSecondary = {
  padding: '7px 14px',
  background: colors.btnSecondary,
  color: colors.textPrimary,
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
}

export const btnDanger = {
  padding: '3px 10px',
  background: '#fef2f2',
  color: colors.btnDanger,
  border: '1px solid #fecaca',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
}

export const h2Style = {
  fontSize: 16,
  fontWeight: 700,
  color: colors.textPrimary,
  marginBottom: 16,
  marginTop: 0,
}

export const BADGE = {
  ok:   { background: '#d1fae5', color: '#065f46', borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 700, display: 'inline-block' },
  ko:   { background: '#fee2e2', color: '#991b1b', borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 700, display: 'inline-block' },
  warn: { background: '#fef3c7', color: '#92400e', borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 700, display: 'inline-block' },
  info: { background: '#dbeafe', color: '#1e40af', borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 700, display: 'inline-block' },
}
