// Unisce nomi di classe ignorando i valori falsy: cx('a', cond && 'b') → 'a b'
export function cx(...parti) {
  return parti.filter(Boolean).join(' ')
}
