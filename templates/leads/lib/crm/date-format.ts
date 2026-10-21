// Formatters contain locale options only. Never cache customer records here.
const formatters = new Map<string, Intl.DateTimeFormat>();

export function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify([locale, options]);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, formatter);
    if (formatters.size > 64) formatters.delete(formatters.keys().next().value!);
  }
  return formatter;
}
