export const GEORGIAN_CITIES = [
  'თბილისი',
  'რუსთავი',
  'ქუთაისი',
  'ბათუმი',
  'თელავი',
  'ხაშური',
  'გორი',
  'ვანი',
] as const;

export type GeorgianCity = (typeof GEORGIAN_CITIES)[number];

/** Local YYYY-MM-DD for tomorrow (earliest allowed delivery date). */
export function minDeliveryDateIso(from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + 1);
  return toDateInputValue(d);
}

export function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isDeliveryDateAllowed(
  value: string,
  options?: { allowExistingPast?: boolean; originalValue?: string },
): boolean {
  if (!value) {
    return false;
  }
  const min = minDeliveryDateIso();
  if (value >= min) {
    return true;
  }
  // Allow opening/editing historical orders without forcing date change
  if (options?.allowExistingPast && options.originalValue && value === options.originalValue) {
    return true;
  }
  return false;
}
