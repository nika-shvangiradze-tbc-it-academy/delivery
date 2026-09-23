# -*- coding: utf-8 -*-
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def replace_all(path: Path, reps: list[tuple[str, str]]) -> None:
    text = path.read_text(encoding="utf-8")
    for old, new in reps:
        if old not in text:
            print(f"MISSING in {path.name}: {ascii(old[:80])}")
        else:
            text = text.replace(old, new)
    path.write_text(text, encoding="utf-8")
    ka = len(re.findall(r"[\u10A0-\u10FF]", text))
    print(f"{path.relative_to(ROOT)}: {ka} KA chars")


replace_all(
    ROOT / "src/app/features/admin/orders/orders.html",
    [
        ("                    {{ group.order_count }} შეკვეთა",
         "                    {{ 'adminUi.ordersCount' | t: { count: group.order_count } }}"),
        ("              გადასაცემი ერთეულები: {{ analytics().summary.parcel_count }}",
         "              {{ 'adminUi.parcelUnits' | t: { count: analytics().summary.parcel_count } }}"),
        ('            <p class="admin-orders__summary-label">ქეში</p>',
         '            <p class="admin-orders__summary-label">{{ \'ui.cash\' | t }}</p>'),
        ('            <p class="admin-orders__summary-label">ბარათი</p>',
         '            <p class="admin-orders__summary-label">{{ \'ui.card\' | t }}</p>'),
        ('      <p class="admin-orders__bulk-count">მონიშნული: {{ selectedCount() }}</p>',
         '      <p class="admin-orders__bulk-count">{{ \'adminUi.selectedCount\' | t: { count: selectedCount() } }}</p>'),
        ("        მინიჭება\n",
         "        {{ 'adminUi.assign' | t }}\n"),
        ("        მოხსნა\n",
         "        {{ 'adminUi.unassign' | t }}\n"),
        ('        <p class="admin-orders__page-info">სულ {{ total() }} შეკვეთა</p>',
         '        <p class="admin-orders__page-info">{{ \'adminUi.totalOrdersCount\' | t: { count: total() } }}</p>'),
        ('          <label for="admin-page-size">გვერდზე</label>',
         '          <label for="admin-page-size">{{ \'adminUi.perPage\' | t }}</label>'),
        ("              <th>შემკვეთი</th>",
         "              <th>{{ 'adminUi.customerCol' | t }}</th>"),
        ("              <th>აღების ადგილი</th>",
         "              <th>{{ 'adminUi.pickupPlaceCol' | t }}</th>"),
        ("              <th>მიმღების მისამართი</th>",
         "              <th>{{ 'adminUi.recipientAddressCol' | t }}</th>"),
        ("              <th>თანხა</th>",
         "              <th>{{ 'adminUi.amountCol' | t }}</th>"),
        ('                    <span class="admin-orders__fragile" title="მსხვრევადი ამანათი">⚠</span>',
         '                    <span class="admin-orders__fragile" [attr.title]="\'ui.fragileParcel\' | t">⚠</span>'),
        ("                    რედაქტირება\n",
         "                    {{ 'ui.edit' | t }}\n"),
        ('      <div class="admin-orders__cards" aria-label="შეკვეთები (მობილური)">',
         '      <div class="admin-orders__cards" [attr.aria-label]="\'adminUi.mobileOrders\' | t">'),
        ('              <span class="admin-orders__card-pickup-label">აღების ადგილი</span>',
         '              <span class="admin-orders__card-pickup-label">{{ \'adminUi.pickupPlaceCol\' | t }}</span>'),
        ("                რედაქტირება\n",
         "                {{ 'ui.edit' | t }}\n"),
        ("            გვერდი {{ page() }} / {{ totalPages() }}",
         "            {{ 'adminUi.pageOf' | t: { page: page(), total: totalPages() } }}"),
        ('          <p class="admin-orders__page-total">სულ {{ total() }} შეკვეთა</p>',
         '          <p class="admin-orders__page-total">{{ \'adminUi.totalOrdersCount\' | t: { count: total() } }}</p>'),
        ('          <label for="admin-page-size-list">გვერდზე</label>',
         '          <label for="admin-page-size-list">{{ \'adminUi.perPage\' | t }}</label>'),
        ("            ‹ წინა\n",
         "            {{ 'adminUi.prev' | t }}\n"),
        ("            შემდეგ ›\n",
         "            {{ 'adminUi.next' | t }}\n"),
        ('          <h3 class="admin-orders__detail-heading">შეკვეთა</h3>',
         '          <h3 class="admin-orders__detail-heading">{{ \'ui.order\' | t }}</h3>'),
        ("              <dt>ჩაბარების დრო</dt>",
         "              <dt>{{ 'adminUi.deliveredAtLabel' | t }}</dt>"),
        ('          <h3 class="admin-orders__detail-heading">ამანათი და გადახდა</h3>',
         '          <h3 class="admin-orders__detail-heading">{{ \'adminUi.parcelAndPayment\' | t }}</h3>'),
        ("              <dt>გადასაცემი ერთეულები</dt>",
         "              <dt>{{ 'adminUi.deliveryUnits' | t }}</dt>"),
        ("                <dt>ამანათი</dt>",
         "                <dt>{{ 'adminUi.parcel' | t }}</dt>"),
        ("              <dt>ასაღები თანხა</dt>",
         "              <dt>{{ 'ui.amountToCollect' | t }}</dt>"),
        ("              <dt>აღებული თანხა</dt>",
         "              <dt>{{ 'ui.collectedAmount' | t }}</dt>"),
        ("              <dt>გადახდა</dt>",
         "              <dt>{{ 'ui.payment' | t }}</dt>"),
        ('            <h3 class="admin-orders__detail-heading">გაუქმება</h3>',
         '            <h3 class="admin-orders__detail-heading">{{ \'adminUi.cancelSection\' | t }}</h3>'),
        ('              <p class="admin-orders__cancel-title">გაუქმების მიზეზი</p>',
         '              <p class="admin-orders__cancel-title">{{ \'ui.cancelReason\' | t }}</p>'),
        # ui.cancelReason exists as courier.cancelReason and ui might not - check
        ("                გააუქმა: {{ courierName(order.assigned_courier_id) }}",
         "                {{ 'adminUi.cancelledBy' | t: { name: courierName(order.assigned_courier_id) } }}"),
        ("                გაუქმების დრო: {{ formatCancelTime(order.cancelled_at) }}",
         "                {{ 'adminUi.cancelTimeLabel' | t: { time: formatCancelTime(order.cancelled_at) } }}"),
        ('        <p class="admin-orders__muted">იტვირთება...</p>',
         '        <p class="admin-orders__muted">{{ \'adminUi.loading\' | t }}</p>'),
        ("                  გაუქმების მიზეზი: {{ order.cancellation_reason }}",
         "                  {{ 'adminUi.cancelReasonWithValue' | t: { reason: order.cancellation_reason } }}"),
        ("        <h2>შეკვეთის რედაქტირება #{{ order.id }}</h2>",
         "        <h2>{{ 'adminUi.editOrderTitle' | t: { id: order.id } }}</h2>"),
        ("          <label><span>გამგზავნი</span><input formControlName=\"sender_name\" /></label>",
         "          <label><span>{{ 'adminUi.senderLabel' | t }}</span><input formControlName=\"sender_name\" /></label>"),
        ("          <label><span>გამგზავნის ტელ.</span><input formControlName=\"sender_phone\" /></label>",
         "          <label><span>{{ 'adminUi.senderPhoneShort' | t }}</span><input formControlName=\"sender_phone\" /></label>"),
        ("            <span>აღების ქალაქი</span>",
         "            <span>{{ 'adminUi.pickupCity' | t }}</span>"),
        ("          <label><span>აღების უბანი</span><input formControlName=\"pickup_district\" /></label>",
         "          <label><span>{{ 'adminUi.pickupDistrict' | t }}</span><input formControlName=\"pickup_district\" /></label>"),
        ("          <label class=\"full\"><span>აღების მისამართი</span><input formControlName=\"pickup_address\" /></label>",
         "          <label class=\"full\"><span>{{ 'adminUi.pickupAddress' | t }}</span><input formControlName=\"pickup_address\" /></label>"),
        ("          <label><span>მიმღები</span><input formControlName=\"recipient_name\" /></label>",
         "          <label><span>{{ 'adminUi.recipientLabel' | t }}</span><input formControlName=\"recipient_name\" /></label>"),
        ("          <label><span>მიმღების ტელ.</span><input formControlName=\"recipient_phone\" /></label>",
         "          <label><span>{{ 'adminUi.recipientPhoneShort' | t }}</span><input formControlName=\"recipient_phone\" /></label>"),
        ("            <span>მიწოდების ქალაქი</span>",
         "            <span>{{ 'adminUi.deliveryCity' | t }}</span>"),
        ("          <label><span>მიწოდების უბანი</span><input formControlName=\"delivery_district\" /></label>",
         "          <label><span>{{ 'adminUi.deliveryDistrict' | t }}</span><input formControlName=\"delivery_district\" /></label>"),
        ("          <label class=\"full\"><span>მიწოდების მისამართი</span><input formControlName=\"delivery_address\" /></label>",
         "          <label class=\"full\"><span>{{ 'adminUi.deliveryAddress' | t }}</span><input formControlName=\"delivery_address\" /></label>"),
        ("            <span>გადასაცემი ერთეულების რაოდენობა</span>",
         "            <span>{{ 'courier.parcelCount' | t }}</span>"),
        ("            <span>მიწოდების თარიღი</span>",
         "            <span>{{ 'ui.deliveryDate' | t }}</span>"),
        ("            <span>ასაღები თანხა</span>",
         "            <span>{{ 'ui.amountToCollect' | t }}</span>"),
        ("            <span>მსხვრევადი ამანათი</span>",
         "            <span>{{ 'ui.fragileParcel' | t }}</span>"),
        ("          <label class=\"full\"><span>შენიშვნა</span><textarea rows=\"3\" formControlName=\"notes\"></textarea></label>",
         "          <label class=\"full\"><span>{{ 'ui.note' | t }}</span><textarea rows=\"3\" formControlName=\"notes\"></textarea></label>"),
        ("          {{ updating() ? 'ინახება...' : 'შენახვა' }}",
         "          {{ updating() ? ('ui.saving' | t) : ('ui.save' | t) }}"),
        ("        <h2>{{ 'adminUi.sendCourier' | t }} — აღების დავალება</h2>",
         "        <h2>{{ 'adminUi.dispatchTitle' | t }}</h2>"),
        ("        ერთი აღების დავალება · ერთი აღების მისამართი (კლიენტის პროფილი). მიწოდების შეკვეთები არ იცვლება.",
         "        {{ 'adminUi.dispatchHelp' | t }}"),
        ("        <span>კურიერი</span>",
         "        <span>{{ 'ui.courier' | t }}</span>"),
        ('        <button type="button" class="admin-orders__link-btn" (click)="closeDispatch()">გაუქმება</button>',
         '        <button type="button" class="admin-orders__link-btn" (click)="closeDispatch()">{{ \'ui.cancel\' | t }}</button>'),
    ],
)

# Fix cancel reason - ui.cancelReason may not exist; use courier.cancelReason or add.
# Check ui keys - we have cancelReasonPlaceholder but not cancelReason in ui.
# I used ui.cancelReason - need to fix to courier.cancelReason or admin something.

oh = (ROOT / "src/app/features/admin/orders/orders.html").read_text(encoding="utf-8")
if "'ui.cancelReason'" in oh:
    oh = oh.replace("'ui.cancelReason'", "'courier.cancelReason'")
    (ROOT / "src/app/features/admin/orders/orders.html").write_text(oh, encoding="utf-8")
    print("fixed cancelReason key")

ka_lines = [ln for ln in oh.splitlines() if re.search(r"[\u10A0-\u10FF]", ln)]
print("Remaining KA in orders.html:")
for ln in ka_lines:
    print(" ", ascii(ln.strip()[:100]))
