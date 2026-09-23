# -*- coding: utf-8 -*-
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def replace_all(path: Path, reps: list[tuple[str, str]]) -> None:
    text = path.read_text(encoding="utf-8")
    for old, new in reps:
        if old not in text:
            print(f"MISSING in {path.name}: {old[:100]!r}")
        else:
            text = text.replace(old, new)
    path.write_text(text, encoding="utf-8")
    ka = len(re.findall(r"[\u10A0-\u10FF]", text))
    print(f"{path.relative_to(ROOT)}: {ka} KA chars")


# ========== courier-order-detail.html ==========
replace_all(
    ROOT / "src/app/features/courier/courier-order-detail/courier-order-detail.html",
    [
        ('  <a routerLink="/courier/orders" class="courier-detail__back">← უკან</a>',
         '  <a routerLink="/courier/orders" class="courier-detail__back">← {{ \'ui.back\' | t }}</a>'),
        ('    <p class="courier-detail__muted">იტვირთება...</p>',
         '    <p class="courier-detail__muted">{{ \'courier.loading\' | t }}</p>'),
        ("    <h1>შეკვეთა #{{ o.id }}</h1>",
         "    <h1>{{ 'courier.orderTitle' | t: { id: o.id } }}</h1>"),
        ("        <strong>ტელეფონი:</strong>",
         "        <strong>{{ 'ui.phone' | t }}:</strong>"),
        ('      <p><strong>ქალაქი:</strong> {{ o.delivery_city }}</p>',
         '      <p><strong>{{ \'courier.city\' | t }}:</strong> {{ o.delivery_city }}</p>'),
        ("      <p><strong>უბანი:</strong> {{ o.delivery_district || '—' }}</p>",
         "      <p><strong>{{ 'courier.district' | t }}:</strong> {{ o.delivery_district || '—' }}</p>"),
        ('      <p><strong>მისამართი:</strong> {{ o.delivery_address }}</p>',
         '      <p><strong>{{ \'ui.address\' | t }}:</strong> {{ o.delivery_address }}</p>'),
        ('      <p><strong>გადასაცემი ერთეულების რაოდენობა:</strong> {{ o.parcel_count }}</p>',
         '      <p><strong>{{ \'courier.parcelCount\' | t }}:</strong> {{ o.parcel_count }}</p>'),
        ('        <p class="courier-detail__fragile" role="status">⚠ მსხვრევადი</p>',
         '        <p class="courier-detail__fragile" role="status">⚠ {{ \'courier.fragile\' | t }}</p>'),
        ('      <p><strong>ასაღები თანხა:</strong> {{ formatGel(o.amount_to_collect) }} ₾</p>',
         '      <p><strong>{{ \'ui.amountToCollect\' | t }}:</strong> {{ formatGel(o.amount_to_collect) }} ₾</p>'),
        ("        <strong>თარიღი:</strong>",
         "        <strong>{{ 'courier.deliveryDate' | t }}:</strong>"),
        ('        <p><strong>შენიშვნა:</strong> {{ o.notes }}</p>',
         '        <p><strong>{{ \'courier.note\' | t }}:</strong> {{ o.notes }}</p>'),
        ("        <strong>სტატუსი:</strong>",
         "        <strong>{{ 'ui.status' | t }}:</strong>"),
        ('      <p><strong>გადახდა:</strong> {{ paymentLabel(o.payment_method) }}</p>',
         '      <p><strong>{{ \'ui.payment\' | t }}:</strong> {{ paymentLabel(o.payment_method) }}</p>'),
        ("            {{ saving() ? 'ინახება...' : 'აღებულია' }}",
         "            {{ saving() ? ('ui.saving' | t) : ('courier.pickedUpAction' | t) }}"),
        ('          <p class="courier-detail__complete-label">გადახდა:</p>',
         '          <p class="courier-detail__complete-label">{{ \'courier.paymentLabel\' | t }}</p>'),
        ("              ქეში\n            </button>",
         "              {{ 'ui.cash' | t }}\n            </button>"),
        ("              ბარათი\n            </button>",
         "              {{ 'ui.card' | t }}\n            </button>"),
        ("            {{ saving() ? 'ინახება...' : 'ჩაბარებულია' }}",
         "            {{ saving() ? ('ui.saving' | t) : ('courier.deliveredAction' | t) }}"),
        ("                გაუქმების მიზეზი\n              </label>",
         "                {{ 'courier.cancelReason' | t }}\n              </label>"),
        ('                placeholder="მიუთითეთ გაუქმების მიზეზი..."',
         '                [attr.placeholder]="\'courier.cancelReasonPlaceholder\' | t"'),
        ("                  {{ saving() ? 'ინახება...' : 'დიახ' }}",
         "                  {{ saving() ? ('ui.saving' | t) : ('ui.yes' | t) }}"),
        ("                  არა\n                </button>",
         "                  {{ 'ui.no' | t }}\n                </button>"),
        ("              გაუქმება\n            </button>",
         "              {{ 'courier.cancelAction' | t }}\n            </button>"),
    ],
)

# ========== courier-order-detail.ts ==========
replace_all(
    ROOT / "src/app/features/courier/courier-order-detail/courier-order-detail.ts",
    [
        ("      this.errorMessage.set('არასწორი შეკვეთა');",
         "      this.errorMessage.set(i18next.t('courier.invalidOrder'));"),
        ("      this.errorMessage.set(error ?? 'შეკვეთა ვერ მოიძებნა');",
         "      this.errorMessage.set(error ?? i18next.t('courier.orderNotFound'));"),
        ("      this.errorMessage.set(`აღება ვერ მოხერხდა: ${message}`);",
         "      this.errorMessage.set(i18next.t('courier.pickupFailedWithReason', { message }));"),
        ("      this.errorMessage.set(`ჩაბარება ვერ მოხერხდა: ${message}`);",
         "      this.errorMessage.set(i18next.t('courier.deliverFailedWithReason', { message }));"),
        ("      this.errorMessage.set(`გაუქმება ვერ მოხერხდა: ${message}`);",
         "      this.errorMessage.set(i18next.t('courier.cancelFailedWithReason', { message }));"),
    ],
)

# ========== profile my-orders snippets ==========
replace_all(
    ROOT / "src/app/features/orders/my-orders/my-orders.html",
    [
        ("                  <dt>ასაღები თანხა</dt>",
         "                  <dt>{{ 'ui.amountToCollect' | t }}</dt>"),
        ("                  {{ expandedId() === order.id ? 'დამალვა' : 'დეტალები' }}",
         "                  {{ expandedId() === order.id ? ('ordersUi.hide' | t) : ('ui.details' | t) }}"),
        ("                    რედაქტირება\n",
         "                    {{ 'ui.edit' | t }}\n"),
        ("        <h2>შეკვეთის რედაქტირება #{{ order.id }}</h2>",
         "        <h2>{{ 'ordersUi.editOrderTitle' | t: { id: order.id } }}</h2>"),
        ('        <button type="button" (click)="closeEdit()" aria-label="დახურვა">×</button>',
         '        <button type="button" (click)="closeEdit()" [attr.aria-label]="\'ui.close\' | t">×</button>'),
        ("            <span>ასაღები თანხა (₾)</span>",
         "            <span>{{ 'ordersUi.amountGel' | t }}</span>"),
        ("            {{ saving() ? 'ინახება...' : 'შენახვა' }}",
         "            {{ saving() ? ('ui.saving' | t) : ('ui.save' | t) }}"),
        ("            გაუქმება\n",
         "            {{ 'ui.cancel' | t }}\n"),
    ],
)

# ========== pickup-tasks ==========
replace_all(
    ROOT / "src/app/features/admin/pickup-tasks/pickup-tasks.html",
    [
        ('    <div class="admin-pickup__summary" aria-label="აღების სტატისტიკა">',
         '    <div class="admin-pickup__summary" [attr.aria-label]="\'adminUi.pickupStats\' | t">'),
        ('      <p class="admin-pickup__muted">იტვირთება…</p>',
         '      <p class="admin-pickup__muted">{{ \'adminUi.loading\' | t }}</p>'),
        ("        {{ 'adminUi.pickupTasksTitle' | t }} ვერ ჩაიტვირთა. გაუშვით მიგრაცია",
         "        {{ 'adminUi.pickupLoadFailed' | t }}"),
        ('      <p class="admin-pickup__muted">{{ \'adminUi.pickupTasksTitle\' | t }} არ არის</p>',
         '      <p class="admin-pickup__muted">{{ \'adminUi.emptyPickupTasks\' | t }}</p>'),
        ("              <p>შექმნა: {{ formatAuditTime(task.created_at) }}</p>",
         "              <p>{{ 'adminUi.createdAt' | t: { time: formatAuditTime(task.created_at) } }}</p>"),
        ("                <p>აღების დრო: {{ formatAuditTime(task.completed_at) }}</p>",
         "                <p>{{ 'adminUi.pickupTimeLabel' | t: { time: formatAuditTime(task.completed_at) } }}</p>"),
        ("                <p>გაუქმება: {{ formatCancelTime(task.cancelled_at) }}</p>",
         "                <p>{{ 'adminUi.cancelLabel' | t: { time: formatCancelTime(task.cancelled_at) } }}</p>"),
        ('                <p class="admin-pickup__reason">მიზეზი: {{ task.cancellation_reason }}</p>',
         '                <p class="admin-pickup__reason">{{ \'adminUi.reasonLabel\' | t: { reason: task.cancellation_reason } }}</p>'),
    ],
)

replace_all(
    ROOT / "src/app/features/admin/pickup-tasks/pickup-tasks.ts",
    [
        ("        return 'აღებული';", "        return i18next.t('ui.pickedUp');"),
        ("        return 'გაუქმებული';", "        return i18next.t('ui.cancelled');"),
        ("        return 'მიმდინარე';", "        return i18next.t('adminUi.current');"),
    ],
)

pts = (ROOT / "src/app/features/admin/pickup-tasks/pickup-tasks.ts").read_text(encoding="utf-8")
if "import i18next" not in pts:
    # add after first import block
    pts = "import i18next from 'i18next';\n" + pts
    (ROOT / "src/app/features/admin/pickup-tasks/pickup-tasks.ts").write_text(pts, encoding="utf-8")
    print("added i18next to pickup-tasks.ts")

print("part2 done")
