export function formatListSummary(
  values: string[],
  locale: string,
  formatRemaining: (formattedValues: string, remainingCount: number) => string,
  limit = 3,
): string {
  const nonEmptyValues = values.filter(Boolean);
  const visible = nonEmptyValues.slice(0, limit);
  if (!visible.length) {
    return "";
  }

  const formattedValues = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(visible);
  const remainingCount = nonEmptyValues.length - visible.length;
  return remainingCount > 0 ? formatRemaining(formattedValues, remainingCount) : formattedValues;
}

export function formatLocalizedDate(
  dateValue: string | Date,
  locale: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
): string {
  try {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return String(dateValue);
  }
}

export function formatHistoryTimestamp(date: Date, locale: string): string {
  return formatLocalizedDate(date, locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
