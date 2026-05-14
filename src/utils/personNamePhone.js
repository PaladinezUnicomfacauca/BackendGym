const NAME_PATTERN = /^[\p{L}]+(?:\s+[\p{L}]+)*$/u;

export const isPhone10Digits = (phone) => /^\d{10}$/.test(String(phone));

/** Nombre visible: solo letras Unicode y espacios entre segmentos; sin números ni otros símbolos. */
export const isValidPersonDisplayName = (name) => {
  const t = String(name ?? '').trim();
  if (!t) return false;
  return NAME_PATTERN.test(t);
};
