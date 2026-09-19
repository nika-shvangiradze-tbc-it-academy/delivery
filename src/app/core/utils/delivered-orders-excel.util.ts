import * as XLSX from 'xlsx';
import { Order } from '../models/order.model';
import { courierStatusLabel } from './order-status.util';

export interface DeliveredOrderExportRow {
  orderId: number;
  deliveredDate: string;
  deliveredTime: string;
  customer: string;
  phone: string;
  courier: string;
  city: string;
  district: string;
  address: string;
  parcelCount: number;
  amountToCollect: number;
  collectedAmount: number;
  paymentMethod: string;
  status: string;
}

const EXPORT_HEADERS = [
  'შეკვეთის ID',
  'ჩაბარების თარიღი',
  'ჩაბარების დრო',
  'კლიენტი',
  'ტელეფონი',
  'კურიერი',
  'ქალაქი',
  'რაიონი',
  'მისამართი',
  'ამანათების რაოდენობა',
  'ასაღები თანხა',
  'მიღებული თანხა',
  'გადახდის მეთოდი',
  'სტატუსი',
] as const;

const COLUMN_WIDTHS = [12, 14, 12, 22, 14, 16, 14, 14, 28, 14, 14, 14, 14, 14];

function tbilisiParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) {
    return { date: '—', time: '—' };
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return { date: '—', time: '—' };
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tbilisi',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${get('day')}.${get('month')}.${get('year')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

function exportPaymentLabel(method: Order['payment_method']): string {
  if (method === 'cash') return 'ნაღდი';
  if (method === 'card') return 'ბარათი';
  return '—';
}

function displayText(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed || '—';
}

export function mapOrderToDeliveredExportRow(
  order: Order,
  courierNameById: Map<string, string>,
): DeliveredOrderExportRow {
  const { date, time } = tbilisiParts(order.delivered_at);
  const courierId = order.assigned_courier_id;
  const courier = (courierId && courierNameById.get(courierId)?.trim()) || '—';

  return {
    orderId: order.id,
    deliveredDate: date,
    deliveredTime: time,
    customer: displayText(order.recipient_name),
    phone: displayText(order.recipient_phone),
    courier,
    city: displayText(order.delivery_city),
    district: displayText(order.delivery_district),
    address: displayText(order.delivery_address),
    parcelCount: Number.isFinite(order.parcel_count) ? order.parcel_count : 0,
    amountToCollect: Number.isFinite(order.amount_to_collect) ? order.amount_to_collect : 0,
    collectedAmount: Number.isFinite(order.collected_amount) ? order.collected_amount : 0,
    paymentMethod: exportPaymentLabel(order.payment_method),
    status: courierStatusLabel(order.status),
  };
}

function rowToAoA(row: DeliveredOrderExportRow): (string | number)[] {
  return [
    row.orderId,
    row.deliveredDate,
    row.deliveredTime,
    row.customer,
    row.phone,
    row.courier,
    row.city,
    row.district,
    row.address,
    row.parcelCount,
    row.amountToCollect,
    row.collectedAmount,
    row.paymentMethod,
    row.status,
  ];
}

function todayIsoDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tbilisi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function buildDeliveredOrdersExcelFilename(): string {
  const day = todayIsoDate();
  // Prefer Georgian filename; ASCII fallback if the environment rejects it.
  try {
    const georgian = `ჩაბარებული_შეკვეთები_${day}.xlsx`;
    // Encode/decode round-trip sanity check
    if (decodeURIComponent(encodeURIComponent(georgian)) === georgian) {
      return georgian;
    }
  } catch {
    // fall through
  }
  return `delivered-orders-${day}.xlsx`;
}

export function buildDeliveredOrdersWorkbook(rows: DeliveredOrderExportRow[]): XLSX.WorkBook {
  const aoa: (string | number)[][] = [Array.from(EXPORT_HEADERS), ...rows.map(rowToAoA)];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  worksheet['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }));
  const lastRow = Math.max(1, rows.length + 1);
  const lastCol = EXPORT_HEADERS.length - 1;
  const range = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: lastRow - 1, c: lastCol },
  });
  worksheet['!autofilter'] = { ref: range };
  worksheet['!views'] = [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }];

  // Bold header row (supported when the writer persists styles).
  for (let c = 0; c < EXPORT_HEADERS.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = worksheet[addr];
    if (cell && typeof cell === 'object') {
      cell.s = {
        font: { bold: true },
        alignment: { vertical: 'center' },
      };
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'ჩაბარებული');
  return workbook;
}

export function downloadDeliveredOrdersExcel(rows: DeliveredOrderExportRow[]): void {
  const workbook = buildDeliveredOrdersWorkbook(rows);
  const filename = buildDeliveredOrdersExcelFilename();
  XLSX.writeFile(workbook, filename, { bookType: 'xlsx', cellStyles: true });
}
