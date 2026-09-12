export function nextHeaderVisibility({ mobile, current, previous, maximum, hidden }) {
  if (!mobile || maximum <= 0) return false;
  const position = Math.max(0, Math.min(current, maximum));
  const baseline = Math.min(previous, maximum);
  if (position > baseline + 5 && position > 24) return true;
  if (position < baseline - 5 || position === 0) return false;
  return hidden;
}
