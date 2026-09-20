import * as XLSX from 'xlsx';
import { GEORGIAN_CITIES, isDeliveryDateAllowed, toDateInputValue } from '../constants/cities';
import { CreateOrderPayload } from '../models/order.model';
import { centsToNumber, toCents } from './order-status.util';

/** Excel column headers expected in the customer template. */
export const ORDER_EXCEL_HEADERS = [
  'customer_name',
  'phone',
  'recipient_address',
  'city',
  'district',
  'delivery_date',
  'quantity',
  'amount_to_collect',
  'note',
  'fragile',
  'pickup_location',
] as const;

export type OrderExcelHeader = (typeof ORDER_EXCEL_HEADERS)[number];

/** Max rows accepted per Excel import / bulk RPC (must match customer_bulk_create_orders). */
export const MAX_BULK_IMPORT_ORDERS = 700;

export const BULK_IMPORT_TOO_MANY_MESSAGE = `Too many orders (max ${MAX_BULK_IMPORT_ORDERS})`;

/** Sender / pickup defaults applied to every imported row (from profile or form). */
export interface OrderImportSenderDefaults {
  sender_name: string;
  sender_phone: string;
  pickup_city: string;
  pickup_district: string;
  pickup_address: string;
}

export interface ParsedExcelOrderRow {
  rowNumber: number;
  raw: Record<string, unknown>;
}

export interface ValidatedImportRow {
  rowNumber: number;
  valid: boolean;
  error: string | null;
  /** Preview fields */
  customerName: string;
  phone: string;
  address: string;
  city: string;
  district: string;
  deliveryDate: string;
  quantity: number | null;
  amountToCollect: number | null;
  fragile: boolean;
  note: string;
  pickupLocation: string;
  /** Ready for insert when valid */
  payload: CreateOrderPayload | null;
}

export interface OrderExcelParseResult {
  rows: ParsedExcelOrderRow[];
  fileName: string;
  fingerprint: string;
}

export interface OrderExcelValidationResult {
  total: number;
  validCount: number;
  errorCount: number;
  rows: ValidatedImportRow[];
}

const CITY_ALIASES: Record<string, (typeof GEORGIAN_CITIES)[number]> = {
  თბილისი: 'თბილისი',
  tbilisi: 'თბილისი',
  რუსთავი: 'რუსთავი',
  rustavi: 'რუსთავი',
  ქუთაისი: 'ქუთაისი',
  kutaisi: 'ქუთაისი',
  ბათუმი: 'ბათუმი',
  batumi: 'ბათუმი',
  თელავი: 'თელავი',
  telavi: 'თელავი',
  ხაშური: 'ხაშური',
  khashuri: 'ხაშური',
  hasuri: 'ხაშური',
  გორი: 'გორი',
  gori: 'გორი',
  ვანი: 'ვანი',
  vani: 'ვანი',
};

/** Map alternate / Georgian / DB-style headers onto canonical Excel keys. */
const HEADER_ALIASES: Record<string, OrderExcelHeader> = {
  // English / DB-style
  customer_name: 'customer_name',
  recipient_name: 'customer_name',
  name: 'customer_name',
  phone: 'phone',
  customer_phone: 'phone',
  recipient_phone: 'phone',
  tel: 'phone',
  telephone: 'phone',
  recipient_address: 'recipient_address',
  delivery_address: 'recipient_address',
  address: 'recipient_address',
  city: 'city',
  delivery_city: 'city',
  district: 'district',
  delivery_district: 'district',
  delivery_date: 'delivery_date',
  date: 'delivery_date',
  quantity: 'quantity',
  parcel_count: 'quantity',
  qty: 'quantity',
  amount_to_collect: 'amount_to_collect',
  amount: 'amount_to_collect',
  gel: 'amount_to_collect',
  lari: 'amount_to_collect',
  note: 'note',
  notes: 'note',
  fragile: 'fragile',
  is_fragile: 'fragile',
  pickup_location: 'pickup_location',
  pickup_address: 'pickup_location',

  // Georgian labels (normalized: spaces → _, BOM/punct stripped)
  მიმღები: 'customer_name',
  მიმღების_ტელეფონი: 'phone',
  მიმღებისტელეფონი: 'phone',
  მიმღების_მისამართი: 'recipient_address',
  მიმღებისმისამართი: 'recipient_address',
  ქალაქი: 'city',
  უბანი: 'district',
  მიწოდების_თარიღი: 'delivery_date',
  მიწოდებისთარიღი: 'delivery_date',
  თარიღი: 'delivery_date',
  რაოდენობა: 'quantity',
  ასაღები_თანხა: 'amount_to_collect',
  ასაღებთანხა: 'amount_to_collect',
  თანხა: 'amount_to_collect',
  შენიშვნა: 'note',
  შენიშვნები: 'note',
  მსხვრევადი: 'fragile',
  აღების_მისამართი: 'pickup_location',
  აღებისმისამართი: 'pickup_location',
};

const IMPORT_FINGERPRINT_PREFIX = 'order-excel-import:';

function cellToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return toDateInputValue(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Prefer plain number string; dates handled separately.
    return String(value);
  }
  return String(value).trim();
}

/**
 * Normalize Excel header for alias lookup:
 * - strip BOM / zero-width chars
 * - trim + collapse whitespace
 * - lowercase Latin (Georgian unchanged)
 * - spaces → underscore
 * - drop punctuation (keep Latin, Georgian, digits, _)
 * Special-case currency-only headers like "₾".
 */
function normalizeHeader(raw: unknown): string {
  let s = String(raw ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();

  s = s.replace(/\s+/g, ' ').trim();
  if (!s) {
    return '';
  }

  // Currency / amount-only headers (would otherwise be stripped to empty).
  const noSpace = s.replace(/\s+/g, '');
  if (noSpace === '₾' || noSpace === 'gel' || noSpace === 'lari' || /^₾+$/.test(noSpace)) {
    return 'amount_to_collect';
  }

  return s.replace(/\s+/g, '_').replace(/[^\w\u10a0-\u10ff]/gi, '');
}

function mapHeader(raw: unknown): OrderExcelHeader | null {
  const key = normalizeHeader(raw);
  if (!key) {
    return null;
  }
  if (HEADER_ALIASES[key]) {
    return HEADER_ALIASES[key];
  }
  const compact = key.replace(/_/g, '');
  if (compact && HEADER_ALIASES[compact]) {
    return HEADER_ALIASES[compact];
  }
  return null;
}

/** Normalize city input to a GEORGIAN_CITIES value, or null if unknown. */
export function normalizeImportCity(value: unknown): string | null {
  const raw = cellToString(value);
  if (!raw) {
    return null;
  }
  const alias = CITY_ALIASES[raw.toLowerCase()] ?? CITY_ALIASES[raw];
  if (alias) {
    return alias;
  }
  if ((GEORGIAN_CITIES as readonly string[]).includes(raw)) {
    return raw;
  }
  return null;
}

/**
 * Parse Excel serial date or common string formats to YYYY-MM-DD.
 * SheetJS may give Date objects when cellDates is enabled.
 * Does not rely on `new Date(string)` for locale-ambiguous formats.
 */
export function parseImportDeliveryDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return excelJsDateToIso(value);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return excelSerialToIso(value);
  }

  const raw = cellToString(value);
  if (!raw) {
    return null;
  }

  // Numeric string that looks like an Excel serial (e.g. "45925").
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (Number.isFinite(serial) && serial > 20000 && serial < 100000) {
      return excelSerialToIso(serial);
    }
  }

  // YYYY-MM-DD (optional time suffix)
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    return ymdToIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  // DD.MM.YYYY or DD/MM/YYYY (optional time)
  const eu = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+.*)?$/);
  if (eu) {
    return ymdToIso(Number(eu[3]), Number(eu[2]), Number(eu[1]));
  }

  // DD-MM-YYYY
  const dashed = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+.*)?$/);
  if (dashed) {
    return ymdToIso(Number(dashed[3]), Number(dashed[2]), Number(dashed[1]));
  }

  // "25 Sep 2026" / "25 September 2026"
  const dmyEn = raw.match(/^(\d{1,2})\s+([A-Za-zა-ჰ]+)\.?\s+(\d{4})$/u);
  if (dmyEn) {
    const month = monthNameToNumber(dmyEn[2]);
    if (month) {
      return ymdToIso(Number(dmyEn[3]), month, Number(dmyEn[1]));
    }
  }

  // "Sep 25, 2026" / "Sep 25 2026"
  const mdyEn = raw.match(/^([A-Za-zა-ჰ]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/u);
  if (mdyEn) {
    const month = monthNameToNumber(mdyEn[1]);
    if (month) {
      return ymdToIso(Number(mdyEn[3]), month, Number(mdyEn[2]));
    }
  }

  return null;
}

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
  // Georgian month names (short + full)
  იან: 1,
  იანვარი: 1,
  თებ: 2,
  თებერვალი: 2,
  მარ: 3,
  მარტი: 3,
  აპრ: 4,
  აპრილი: 4,
  მაი: 5,
  მაისი: 5,
  ივნ: 6,
  ივნისი: 6,
  ივლ: 7,
  ივლისი: 7,
  აგვ: 8,
  აგვისტო: 8,
  სექ: 9,
  სექტ: 9,
  სექტემბერი: 9,
  ოქტ: 10,
  ოქტომბერი: 10,
  ნოე: 11,
  ნოემბერი: 11,
  დეკ: 12,
  დეკემბერი: 12,
};

function monthNameToNumber(name: string): number | null {
  const key = name.trim().toLowerCase();
  return MONTH_NAME_TO_NUMBER[key] ?? null;
}

function ymdToIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  // Reject impossible calendar dates (e.g. 31 Feb).
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Excel serial → YYYY-MM-DD via SheetJS SSF (handles 1900 leap-year quirk). */
function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial)) {
    return null;
  }
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) {
    return null;
  }
  return ymdToIso(parsed.y, parsed.m, parsed.d);
}

/**
 * SheetJS Date → YYYY-MM-DD without timezone day-shift.
 * Prefer UTC Y-M-D when the instant is midnight UTC (typical Excel serial decode).
 */
function excelJsDateToIso(date: Date): string | null {
  const isUtcMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;

  if (isUtcMidnight) {
    return ymdToIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  const isLocalMidnight =
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0;

  if (isLocalMidnight) {
    return ymdToIso(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  // DateTime cell: use calendar day in local zone (delivery is date-only).
  return ymdToIso(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function parseFragileFlag(value: unknown): boolean | null {
  if (value === null || value === undefined || cellToString(value) === '') {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  const raw = cellToString(value).toLowerCase();
  const truthy = new Set(['true', 'yes', 'y', '1', 'კი', 'მართალი', 'მსხვრევადი']);
  const falsy = new Set(['false', 'no', 'n', '0', 'არა', 'მცდარი']);
  if (truthy.has(raw)) return true;
  if (falsy.has(raw)) return false;
  return null;
}

function parseQuantity(value: unknown): { ok: true; value: number } | { ok: false; empty: boolean } {
  if (value === null || value === undefined || cellToString(value) === '') {
    return { ok: true, value: 1 };
  }
  const n =
    typeof value === 'number'
      ? value
      : Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return { ok: false, empty: false };
  }
  return { ok: true, value: n };
}

function parseAmount(value: unknown): { ok: true; value: number } | { ok: false } {
  if (value === null || value === undefined || cellToString(value) === '') {
    return { ok: true, value: 0 };
  }
  const normalized = String(value).replace(/[^\d,.\-]/g, '').replace(',', '.').trim();
  if (normalized === '' || normalized === '-' || normalized === '.') {
    return { ok: false };
  }
  const amount = centsToNumber(toCents(value as string | number));
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false };
  }
  return { ok: true, value: amount };
}

function isPhoneValid(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 6;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function parseExcelFile(file: File): Promise<OrderExcelParseResult> {
  const buffer = await file.arrayBuffer();
  const fingerprint = await sha256Hex(buffer);
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('Excel ფაილში ფურცელი არ მოიძებნა');
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | Date | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
  });

  if (!matrix.length) {
    throw new Error('Excel ფაილი ცარიელია');
  }

  const headerRow = matrix[0] ?? [];
  const columnMap = new Map<number, OrderExcelHeader>();
  headerRow.forEach((cell, index) => {
    const mapped = mapHeader(cell);
    if (mapped && ![...columnMap.values()].includes(mapped)) {
      columnMap.set(index, mapped);
    }
  });

  if (columnMap.size === 0) {
    throw new Error('Excel-ში საჭირო სვეტები ვერ მოიძებნა. ჩამოტვირთეთ ნიმუში.');
  }

  const rows: ParsedExcelOrderRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i] ?? [];
    const isEmpty = line.every((cell) => cellToString(cell) === '');
    if (isEmpty) {
      continue;
    }

    const raw: Record<string, unknown> = {};
    for (const [colIndex, key] of columnMap.entries()) {
      raw[key] = line[colIndex];
    }
    rows.push({ rowNumber: i + 1, raw });
  }

  if (rows.length === 0) {
    throw new Error('Excel-ში მონაცემების სტრიქონები არ მოიძებნა');
  }

  if (rows.length > MAX_BULK_IMPORT_ORDERS) {
    throw new Error(BULK_IMPORT_TOO_MANY_MESSAGE);
  }

  return { rows, fileName: file.name, fingerprint };
}

export function validateImportedOrder(
  row: ParsedExcelOrderRow,
  sender: OrderImportSenderDefaults,
): ValidatedImportRow {
  const raw = row.raw;
  const customerName = cellToString(raw['customer_name']);
  const phone = cellToString(raw['phone']);
  const address = cellToString(raw['recipient_address']);
  // District column is optional in many Excel templates; DB still needs a non-empty value.
  const district = cellToString(raw['district']) || '-';
  const note = cellToString(raw['note']);
  const pickupLocation = cellToString(raw['pickup_location']);
  const cityNormalized = normalizeImportCity(raw['city']);
  const cityDisplay = cityNormalized ?? cellToString(raw['city']);
  const deliveryDate = parseImportDeliveryDate(raw['delivery_date']);
  const quantityParsed = parseQuantity(raw['quantity']);
  const amountParsed = parseAmount(raw['amount_to_collect']);
  const fragileParsed = parseFragileFlag(raw['fragile']);

  const basePreview: Omit<ValidatedImportRow, 'valid' | 'error' | 'payload'> = {
    rowNumber: row.rowNumber,
    customerName,
    phone,
    address,
    city: cityDisplay,
    district: cellToString(raw['district']),
    deliveryDate: deliveryDate ?? cellToString(raw['delivery_date']),
    quantity: quantityParsed.ok ? quantityParsed.value : null,
    amountToCollect: amountParsed.ok ? amountParsed.value : null,
    fragile: fragileParsed === true,
    note,
    pickupLocation,
  };

  const fail = (error: string): ValidatedImportRow => ({
    ...basePreview,
    valid: false,
    error,
    payload: null,
  });

  const senderName = sender.sender_name.trim();
  const senderPhone = sender.sender_phone.trim();
  const pickupCity = normalizeImportCity(sender.pickup_city) ?? sender.pickup_city.trim();
  const pickupDistrict = sender.pickup_district.trim();
  const pickupAddressBase = sender.pickup_address.trim();
  const pickupAddress = pickupLocation || pickupAddressBase;

  if (!senderName || !senderPhone || !pickupCity || !pickupDistrict || !pickupAddress) {
    return fail('შეავსეთ გამგზავნის/აღების ველები ფორმაში Excel იმპორტამდე');
  }
  if (!isPhoneValid(senderPhone)) {
    return fail('გამგზავნის ტელეფონი არასწორია (ფორმაში)');
  }
  if (!(GEORGIAN_CITIES as readonly string[]).includes(pickupCity)) {
    return fail('აღების ქალაქი არასწორია (ფორმაში)');
  }

  if (!customerName) {
    return fail('მიმღების სახელი აუცილებელია');
  }
  if (!phone) {
    return fail('ტელეფონის ნომერი აუცილებელია');
  }
  if (!isPhoneValid(phone)) {
    return fail('მიუთითეთ სწორი ტელეფონის ნომერი');
  }
  if (!address) {
    return fail('მისამართი აუცილებელია');
  }
  if (!cityNormalized) {
    return fail('ქალაქი აუცილებელია ან არასწორია');
  }
  if (!deliveryDate) {
    return fail('არასწორი თარიღი');
  }
  if (!isDeliveryDateAllowed(deliveryDate)) {
    return fail('მიწოდების თარიღი უნდა იყოს ხვალ ან უფრო გვიან');
  }
  if (!quantityParsed.ok) {
    return fail('რაოდენობა უნდა იყოს მინიმუმ 1');
  }
  if (!amountParsed.ok) {
    return fail('თანხა უნდა იყოს 0 ან მეტი');
  }
  if (fragileParsed === null) {
    return fail('მსხვრევადობის მნიშვნელობა არასწორია');
  }

  const payload: CreateOrderPayload = {
    sender_name: senderName,
    sender_phone: senderPhone,
    pickup_city: pickupCity,
    pickup_district: pickupDistrict,
    pickup_address: pickupAddress,
    recipient_name: customerName,
    recipient_phone: phone,
    delivery_city: cityNormalized,
    delivery_district: district,
    delivery_address: address,
    parcel_count: quantityParsed.value,
    delivery_date: deliveryDate,
    amount_to_collect: amountParsed.value,
    is_fragile: fragileParsed,
    notes: note || null,
  };

  return {
    ...basePreview,
    city: cityNormalized,
    deliveryDate,
    quantity: quantityParsed.value,
    amountToCollect: amountParsed.value,
    fragile: fragileParsed,
    valid: true,
    error: null,
    payload,
  };
}

export function validateAllRows(
  rows: ParsedExcelOrderRow[],
  sender: OrderImportSenderDefaults,
): OrderExcelValidationResult {
  const validated = rows.map((row) => validateImportedOrder(row, sender));
  const validCount = validated.filter((r) => r.valid).length;
  return {
    total: validated.length,
    validCount,
    errorCount: validated.length - validCount,
    rows: validated,
  };
}

export function wasImportFingerprintUsed(fingerprint: string): boolean {
  try {
    return sessionStorage.getItem(IMPORT_FINGERPRINT_PREFIX + fingerprint) === '1';
  } catch {
    return false;
  }
}

export function markImportFingerprintUsed(fingerprint: string): void {
  try {
    sessionStorage.setItem(IMPORT_FINGERPRINT_PREFIX + fingerprint, '1');
  } catch {
    // ignore quota / private mode
  }
}

export function formatPreviewDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return iso || '—';
  }
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Build and download the customer Excel template (.xlsx). */
export function downloadOrderExcelTemplate(): void {
  const wb = XLSX.utils.book_new();

  const exampleDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return toDateInputValue(d);
  })();

  const dataSheet = XLSX.utils.aoa_to_sheet([
    [...ORDER_EXCEL_HEADERS],
    [
      'Giorgi',
      '555123456',
      'Rustaveli 42',
      'თბილისი',
      'ვაკე',
      exampleDate,
      2,
      50,
      'Call before delivery',
      false,
      '',
    ],
  ]);
  dataSheet['!cols'] = ORDER_EXCEL_HEADERS.map((h) => ({
    wch: Math.max(14, h.length + 2),
  }));
  XLSX.utils.book_append_sheet(wb, dataSheet, 'Orders');

  const instructions = XLSX.utils.aoa_to_sheet([
    ['ინსტრუქცია / Instructions'],
    [''],
    ['1. შეავსეთ Orders ფურცელი. პირველი სტრიქონი არის სათაურები — ნუ წაშლით.'],
    ['2. customer_name = მიმღების სახელი'],
    ['3. phone = მიმღების ტელეფონი (მინ. 6 ციფრი)'],
    ['4. recipient_address / city / district = მიწოდების მისამართი'],
    [`5. city უნდა იყოს ერთ-ერთი: ${GEORGIAN_CITIES.join(', ')}`],
    ['6. delivery_date = ხვალ ან უფრო გვიან (YYYY-MM-DD)'],
    ['7. quantity ცარიელი → 1; amount_to_collect ცარიელი → 0'],
    ['8. fragile: true/false, Yes/No, კი/არა, 1/0'],
    ['9. pickup_location არასავალდებულოა — თუ ცარიელია, გამოიყენება ფორმის აღების მისამართი'],
    ['10. გამგზავნის მონაცემები აღებულია შეკვეთის შექმნის ფორმიდან'],
  ]);
  instructions['!cols'] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, instructions, 'Instructions');

  XLSX.writeFile(wb, 'order-import-template.xlsx');
}
