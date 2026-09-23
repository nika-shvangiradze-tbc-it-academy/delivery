# -*- coding: utf-8 -*-
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
path = ROOT / "src/app/features/admin/orders/orders.ts"
text = path.read_text(encoding="utf-8")

reps = [
    (
        """const EMPTY_BY_GROUP: Record<AdminStatusGroup, string> = {
  pending: 'მოლოდინში შეკვეთები არ არის',
  office: 'ოფისში შეკვეთები არ მოიძებნა',
  active: 'აქტიური შეკვეთები არ მოიძებნა',
  delivered: 'ჩაბარებული შეკვეთები არ მოიძებნა',
  cancelled: 'გაუქმებული შეკვეთები არ მოიძებნა',
  all: 'შეკვეთები არ მოიძებნა',
};""",
        """const EMPTY_BY_GROUP_KEYS: Record<AdminStatusGroup, string> = {
  pending: 'adminUi.emptyPending',
  office: 'adminUi.emptyOffice',
  active: 'adminUi.emptyActive',
  delivered: 'adminUi.emptyDelivered',
  cancelled: 'adminUi.emptyCancelled',
  all: 'adminUi.emptyAll',
};""",
    ),
    (
        """const STATUS_GROUP_LABELS: Record<AdminStatusGroup, string> = {
  pending: 'მოლოდინში',
  office: 'ოფისში',
  active: 'აქტიური',
  delivered: 'ჩაბარებული',
  cancelled: 'გაუქმებული',
  all: 'ყველა',
};""",
        """const STATUS_GROUP_LABEL_KEYS: Record<AdminStatusGroup, string> = {
  pending: 'ui.pending',
  office: 'ui.atOffice',
  active: 'ui.active',
  delivered: 'ui.delivered',
  cancelled: 'ui.cancelled',
  all: 'ui.all',
};""",
    ),
    (
        """const GROUP_BY_OPTIONS: ReadonlyArray<{ value: PlanningGroupBy; label: string }> = [
  { value: 'none', label: 'დაჯგუფება: გამორთული' },
  { value: 'customer', label: 'დაჯგუფება: შემკვეთი' },
  { value: 'pickup_city', label: 'დაჯგუფება: აღების ქალაქი' },
];""",
        """const GROUP_BY_OPTION_KEYS: ReadonlyArray<{ value: PlanningGroupBy; labelKey: string }> = [
  { value: 'none', labelKey: 'adminUi.groupByNone' },
  { value: 'customer', labelKey: 'adminUi.groupByCustomer' },
  { value: 'pickup_city', labelKey: 'adminUi.groupByPickupCity' },
];""",
    ),
    ("this.errorMessage.set('აირჩიე კურიერი');", "this.errorMessage.set(i18next.t('adminUi.selectCourier'));"),
    (
        "? 'აღების დავალება ვერ გაიგზავნა. გაუშვით მიგრაცია 20260919_pickup_one_customer_location.sql'",
        "? i18next.t('adminUi.pickupSendFailedMigration')",
    ),
    (
        """        ? `აღების კურიერი განახლდა (${updated} შეკვეთა) — ${group.label}`
        : `აღების დავალება შეიქმნა (${updated} შეკვეთა) — ${group.label}`,""",
        """        ? i18next.t('adminUi.pickupCourierUpdated', { count: updated, label: group.label })
        : i18next.t('adminUi.pickupTaskCreatedCount', { count: updated, label: group.label }),""",
    ),
    (
        "this.errorMessage.set('გთხოვთ შეავსოთ ყველა სავალდებულო ველი.');",
        "this.errorMessage.set(i18next.t('validation.requiredFields'));",
    ),
    (
        "this.errorMessage.set('მიწოდების თარიღი უნდა იყოს ხვალ ან უფრო გვიან.');",
        "this.errorMessage.set(i18next.t('validation.deliveryDateTomorrow'));",
    ),
    (
        "this.errorMessage.set(error ?? 'შენახვა ვერ მოხერხდა');",
        "this.errorMessage.set(error ?? i18next.t('ui.saveFailed'));",
    ),
    (
        "this.successMessage.set(`შეკვეთა #${order.id} განახლდა`);",
        "this.successMessage.set(i18next.t('adminUi.orderUpdated', { id: order.id }));",
    ),
    (
        "this.errorMessage.set('ჩაბარებული შეკვეთები ვერ მოიძებნა');",
        "this.errorMessage.set(i18next.t('adminUi.noDeliveredForExcel'));",
    ),
    (
        "this.successMessage.set(`Excel გადმოწერილია (${rows.length} შეკვეთა)`);",
        "this.successMessage.set(i18next.t('adminUi.excelDownloaded', { count: rows.length }));",
    ),
    (
        "const message = err instanceof Error ? err.message : 'Excel ექსპორტი ვერ შესრულდა';",
        "const message = err instanceof Error ? err.message : i18next.t('adminUi.excelExportFailed');",
    ),
    (
        "this.errorMessage.set('მონიშნე ერთი ან მეტი შეკვეთა');",
        "this.errorMessage.set(i18next.t('adminUi.selectOrders'));",
    ),
    (
        "this.successMessage.set(`${data.length} შეკვეთა მიენიჭა კურიერს`);",
        "this.successMessage.set(i18next.t('adminUi.assignedToCourier', { count: data.length }));",
    ),
    (
        "this.successMessage.set(`${data.length} შეკვეთიდან კურიერი მოიხსნა`);",
        "this.successMessage.set(i18next.t('adminUi.unassignedFromCourier', { count: data.length }));",
    ),
    (
        "this.errorMessage.set(error ?? 'სტატუსის განახლება ვერ მოხერხდა');",
        "this.errorMessage.set(error ?? i18next.t('adminUi.statusUpdateFailed'));",
    ),
]

for old, new in reps:
    if old not in text:
        print("MISSING:", ascii(old[:80]))
    else:
        text = text.replace(old, new)
        print("OK:", ascii(old[:50]))

# Update references to renamed consts
text = text.replace("EMPTY_BY_GROUP[", "EMPTY_BY_GROUP_KEYS[")
text = text.replace("STATUS_GROUP_LABELS[", "STATUS_GROUP_LABEL_KEYS[")
text = text.replace("GROUP_BY_OPTIONS", "GROUP_BY_OPTION_KEYS")

# Fix usages that expect string labels - need methods. Search patterns.
# emptyMessage likely uses EMPTY_BY_GROUP[group] directly -> wrap with i18next.t
# statusGroupLabel similarly
# groupBy options .label -> .labelKey with t()

path.write_text(text, encoding="utf-8")
ka = len(re.findall(r"[\u10A0-\u10FF]", text))
print(f"orders.ts KA chars: {ka}")

# Show remaining KA and usages of keys
for i, ln in enumerate(text.splitlines(), 1):
    if re.search(r"[\u10A0-\u10FF]", ln) or "EMPTY_BY_GROUP" in ln or "STATUS_GROUP_LABEL" in ln or "GROUP_BY_OPTION" in ln or ".labelKey" in ln or "emptyMessage" in ln:
        if "EMPTY" in ln or "STATUS_GROUP" in ln or "GROUP_BY" in ln or "labelKey" in ln or re.search(r"[\u10A0-\u10FF]", ln):
            print(f"{i}: {ascii(ln.strip()[:120])}")
