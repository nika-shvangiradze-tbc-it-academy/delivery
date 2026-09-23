# -*- coding: utf-8 -*-
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def replace_all(path: Path, reps: list[tuple[str, str]]) -> None:
    text = path.read_text(encoding="utf-8")
    for old, new in reps:
        count = text.count(old)
        if count == 0:
            print(f"MISSING in {path.name}: {old[:100]!r}")
        else:
            text = text.replace(old, new)
            if count > 1:
                print(f"  replaced {count}x in {path.name}")
    path.write_text(text, encoding="utf-8")
    ka = len(re.findall(r"[\u10A0-\u10FF]", text))
    print(f"{path.relative_to(ROOT)}: {ka} KA chars")


# ========== courier-orders.html ==========
replace_all(
    ROOT / "src/app/features/courier/courier-orders/courier-orders.html",
    [
        ('        <p class="courier-active__count">• {{ orders().length }} აქტიური</p>',
         '        <p class="courier-active__count">• {{ \'courier.activeCount\' | t: { count: orders().length } }}</p>'),
        ('      <span class="courier-active__saving">ინახება...</span>',
         '      <span class="courier-active__saving">{{ \'ui.saving\' | t }}</span>'),
        ('  <div class="courier-active__toolbar" role="toolbar" aria-label="სიის კონტროლი">',
         '  <div class="courier-active__toolbar" role="toolbar" [attr.aria-label]="\'courier.toolbarLabel\' | t">'),
        ('    <span class="courier-active__toolbar-count">აქტიური {{ orders().length }}</span>',
         '    <span class="courier-active__toolbar-count">{{ \'courier.activeLabel\' | t: { count: orders().length } }}</span>'),
        ("        დასრულება\n",
         "        {{ 'courier.complete' | t }}\n"),
        ("        პირველ რიგში{{ selectedSortCount() ? ` (${selectedSortCount()})` : '' }}",
         "        {{ 'courier.moveFirst' | t }}{{ selectedSortCount() ? ` (${selectedSortCount()})` : '' }}"),
        ("        დალაგება\n",
         "        {{ 'courier.sort' | t }}\n"),
        ("        {{ isCompact() ? 'კლასიკური' : 'კომპაქტური' }}",
         "        {{ isCompact() ? ('courier.classic' | t) : ('courier.compact' | t) }}"),
        ('    <div class="courier-active__filters" role="group" aria-label="სწრაფი ფილტრი">',
         '    <div class="courier-active__filters" role="group" [attr.aria-label]="\'courier.quickFilter\' | t">'),
        ("        ყველა\n",
         "        {{ 'courier.all' | t }}\n"),
        ("        დღეს\n",
         "        {{ 'courier.today' | t }}\n"),
        # large amount filter - check if exists
        ('  <section class="courier-active__summary" aria-label="დღის შეჯამება">',
         '  <section class="courier-active__summary" [attr.aria-label]="\'courier.daySummary\' | t">'),
        ('    <section class="courier-pickup" aria-label="აღების დავალებები">',
         '    <section class="courier-pickup" [attr.aria-label]="\'courier.pickupTasksTitle\' | t">'),
        ("        <p>{{ pickupTasks().length }} დავალება</p>",
         "        <p>{{ 'courier.pickupTasksCount' | t: { count: pickupTasks().length } }}</p>"),
        ('            <p class="courier-pickup__badge">🟠 აღების დავალება</p>',
         '            <p class="courier-pickup__badge">🟠 {{ \'courier.pickupTaskBadge\' | t }}</p>'),
        ("                  completingPickupId() === task.id ? 'ინახება…' : '🟢 აღება შესრულებულია'",
         "                  completingPickupId() === task.id ? ('courier.savingEllipsis' | t) : ('🟢 ' + ('courier.pickupCompleteGreen' | t))"),
        ('          <span class="visually-hidden">მიზეზი</span>',
         '          <span class="visually-hidden">{{ \'ui.reason\' | t }}</span>'),
        ("            უკან\n",
         "            {{ 'ui.back' | t }}\n"),
        ("              cancellingPickupId() === cancelTask.id ? 'ინახება…' : 'გაუქმების დადასტურება'",
         "              cancellingPickupId() === cancelTask.id ? ('courier.savingEllipsis' | t) : ('courier.confirmCancel' | t)"),
        ('                  aria-label="გადაადგილება"',
         '                  [attr.aria-label]="\'courier.move\' | t"'),
        ("                  [attr.aria-label]=\"'პოზიცია, მაქს ' + orders().length\"",
         '                  [attr.aria-label]="\'courier.positionMax\' | t: { max: orders().length }"'),
        ("                  [attr.aria-label]=\"'პოზიცია ' + orderPosition(order.id) + ' — შეცვლა'\"",
         '                  [attr.aria-label]="\'courier.positionChange\' | t: { pos: orderPosition(order.id) }"'),
        ('                    <span class="courier-card__fragile-dot" title="მსხვრევადი">⚠</span>',
         '                    <span class="courier-card__fragile-dot" [attr.title]="\'courier.fragile\' | t">⚠</span>'),
        ("                  [attr.aria-label]=\"'დარეკვა: ' + formatPhone(order.recipient_phone)\"",
         '                  [attr.aria-label]="\'courier.callPhone\' | t: { phone: formatPhone(order.recipient_phone) }"'),
        ('                  title="პირველად"',
         '                  [attr.title]="\'courier.moveFirstShort\' | t"'),
        ('                    aria-label="გადაადგილება"',
         '                    [attr.aria-label]="\'courier.move\' | t"'),
        ("                    [attr.aria-label]=\"'პოზიცია, მაქს ' + orders().length\"",
         '                    [attr.aria-label]="\'courier.positionMax\' | t: { max: orders().length }"'),
        ("                    [attr.aria-label]=\"'პოზიცია ' + orderPosition(order.id) + ' — შეცვლა'\"",
         '                    [attr.aria-label]="\'courier.positionChange\' | t: { pos: orderPosition(order.id) }"'),
        ("                    პირველად\n",
         "                    {{ 'courier.moveFirstShort' | t }}\n"),
        ("                    [attr.aria-label]=\"'დარეკვა: ' + formatPhone(order.recipient_phone)\"",
         '                    [attr.aria-label]="\'courier.callPhone\' | t: { phone: formatPhone(order.recipient_phone) }"'),
        ("                    რაოდენობა: {{ order.parcel_count }} ერთეული",
         "                    {{ 'courier.quantityUnits' | t: { count: order.parcel_count } }}"),
        ('                  aria-label="დეტალების დახურვა"',
         '                  [attr.aria-label]="\'courier.closeDetails\' | t"'),
        ("                  <dd>{{ selectedPayment(order.id) === 'cash' ? 'ქეში' : selectedPayment(order.id) === 'card' ? 'ბარათი' : '—' }}</dd>",
         "                  <dd>{{ selectedPayment(order.id) === 'cash' ? ('ui.cash' | t) : selectedPayment(order.id) === 'card' ? ('ui.card' | t) : '—' }}</dd>"),
        ("                    {{ savingId() === order.id ? 'ინახება...' : 'აღებულია' }}",
         "                    {{ savingId() === order.id ? ('ui.saving' | t) : ('courier.pickedUpAction' | t) }}"),
        ('                  <div class="courier-card__pay-toggle" role="group" aria-label="გადახდის მეთოდი">',
         '                  <div class="courier-card__pay-toggle" role="group" [attr.aria-label]="\'courier.paymentMethod\' | t">'),
        ("                      ქეში\n",
         "                      {{ 'ui.cash' | t }}\n"),
        ("                      ბარათი\n",
         "                      {{ 'ui.card' | t }}\n"),
        ("                    {{ savingId() === order.id ? 'ინახება...' : 'ჩაბარებულია' }}",
         "                    {{ savingId() === order.id ? ('ui.saving' | t) : ('courier.deliveredAction' | t) }}"),
        ("                        გაუქმების მიზეზი\n",
         "                        {{ 'courier.cancelReason' | t }}\n"),
        ('                        placeholder="მიუთითეთ გაუქმების მიზეზი..."',
         '                        [attr.placeholder]="\'courier.cancelReasonPlaceholder\' | t"'),
        ("                          {{ savingId() === order.id ? 'ინახება...' : 'დიახ' }}",
         "                          {{ savingId() === order.id ? ('ui.saving' | t) : ('ui.yes' | t) }}"),
        ("                          არა\n",
         "                          {{ 'ui.no' | t }}\n"),
        ("                      გაუქმება\n",
         "                      {{ 'courier.cancelAction' | t }}\n"),
    ],
)

# Fix the pickup complete green ternary - Angular may not like string concat with pipe.
# Better: use only the key without emoji prefix, or two keys.
# Re-read and fix if needed after.

# Check for remaining large-amount filter button text
co = (ROOT / "src/app/features/courier/courier-orders/courier-orders.html").read_text(encoding="utf-8")
# Fix broken green button ternary
bad = "completingPickupId() === task.id ? ('courier.savingEllipsis' | t) : ('🟢 ' + ('courier.pickupCompleteGreen' | t))"
if bad in co:
    co = co.replace(
        bad,
        "completingPickupId() === task.id ? ('courier.savingEllipsis' | t) : ('courier.pickupCompleteGreen' | t)",
    )
    # keep emoji in translation or add separately
    # Update EN/KA keys already say "Pickup completed" / "აღება შესრულებულია"
    # Add emoji in template:
    # actually: use @if
    print("Note: simplified pickup complete button text (emoji removed from ternary)")
(ROOT / "src/app/features/courier/courier-orders/courier-orders.html").write_text(co, encoding="utf-8")

# Add emoji back via key update - or wrap in template. Let's put emoji in key values.
# For now add 🟢 in template differently:
co = (ROOT / "src/app/features/courier/courier-orders/courier-orders.html").read_text(encoding="utf-8")
# Find remaining KA
ka_lines = [ln for ln in co.splitlines() if re.search(r"[\u10A0-\u10FF]", ln)]
print("Remaining KA lines in courier-orders.html:")
for ln in ka_lines:
    print(" ", ln.strip()[:120])
