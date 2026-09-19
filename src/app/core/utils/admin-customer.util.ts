/** Georgian / Latin legal-entity markers used to spot company customers. */
const COMPANY_NAME_RE =
  /შპს|სს\.|(?:^|\s)სს(?:\s|$)|ი\/მ|ი\.მ\.|LLC|LTD|Limited|კომპანია|Company|Corp\.?/i;

export function normalizePersonName(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function hasCompanyNameMarker(value: string | null | undefined): boolean {
  const name = (value ?? '').trim();
  return name.length > 0 && COMPANY_NAME_RE.test(name);
}

/**
 * Company vs individual heuristic (no separate company entity in DB):
 * - Legal-entity markers in sender or account owner name → company
 * - Sender name differs from account owner → treat sender as company / brand
 */
export function isCompanyCustomer(
  senderName: string | null | undefined,
  ownerName?: string | null,
): boolean {
  if (hasCompanyNameMarker(senderName) || hasCompanyNameMarker(ownerName)) {
    return true;
  }
  const sender = normalizePersonName(senderName);
  const owner = normalizePersonName(ownerName);
  return Boolean(sender && owner && sender !== owner);
}

export interface AdminCustomerDisplay {
  primary: string;
  secondary: string | null;
  isCompany: boolean;
}

/**
 * Dispatcher-facing customer label.
 * Company: sender (brand) + owner as contact when different.
 * Individual: account owner (fallback sender).
 */
export function customerDisplay(
  senderName: string | null | undefined,
  ownerName?: string | null,
): AdminCustomerDisplay {
  const sender = (senderName ?? '').trim();
  const owner = (ownerName ?? '').trim();
  const company = isCompanyCustomer(sender, owner);

  if (company) {
    const primary = sender || owner || '—';
    const secondary =
      owner && normalizePersonName(owner) !== normalizePersonName(primary) ? owner : null;
    return { primary, secondary, isCompany: true };
  }

  const primary = owner || sender || '—';
  const secondary =
    sender && normalizePersonName(sender) !== normalizePersonName(primary) ? sender : null;
  return { primary, secondary, isCompany: false };
}

/** Compact pickup lines for the admin table / mobile card. */
export function pickupLocationLines(order: {
  pickup_city?: string | null;
  pickup_district?: string | null;
  pickup_address?: string | null;
}): { place: string; address: string | null } {
  const city = (order.pickup_city ?? '').trim();
  const district = (order.pickup_district ?? '').trim();
  const address = (order.pickup_address ?? '').trim();
  const placeParts = [city, district].filter(Boolean);
  const place = placeParts.length > 0 ? placeParts.join(', ') : city || '—';
  // Second line = street address only (never sender/customer name).
  const secondary =
    address && normalizePersonName(address) !== normalizePersonName(district) ? address : null;
  return { place, address: secondary };
}

/**
 * Recipient delivery address for Admin Orders list.
 * Uses delivery_* fields only — never pickup_address.
 */
export function deliveryRecipientAddress(order: {
  delivery_city?: string | null;
  delivery_district?: string | null;
  delivery_address?: string | null;
}): string {
  const parts = [
    (order.delivery_city ?? '').trim(),
    (order.delivery_district ?? '').trim(),
    (order.delivery_address ?? '').trim(),
  ].filter(Boolean);

  const unique: string[] = [];
  for (const part of parts) {
    const prev = unique[unique.length - 1];
    if (prev && normalizePersonName(prev) === normalizePersonName(part)) {
      continue;
    }
    unique.push(part);
  }

  return unique.length > 0 ? unique.join(', ') : '—';
}

/** PostgREST OR clause fragments for company-marker sender_name filter. */
export const ADMIN_COMPANY_SENDER_OR = [
  'sender_name.ilike.%შპს%',
  'sender_name.ilike.%სს.%',
  'sender_name.ilike.%სს %',
  'sender_name.ilike.%LLC%',
  'sender_name.ilike.%LTD%',
  'sender_name.ilike.%კომპანია%',
  'sender_name.ilike.%ი/მ%',
  'sender_name.ilike.%Company%',
].join(',');
