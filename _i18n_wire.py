# -*- coding: utf-8 -*-
"""One-shot i18n wiring for remaining hardcoded Georgian UI strings."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def replace_all(path: Path, reps: list[tuple[str, str]]) -> None:
    text = path.read_text(encoding="utf-8")
    for old, new in reps:
        if old not in text:
            print(f"MISSING in {path}: {old[:80]!r}")
        else:
            text = text.replace(old, new)
    path.write_text(text, encoding="utf-8")
    ka = len(re.findall(r"[\u10A0-\u10FF]", text))
    print(f"{path.relative_to(ROOT)}: {ka} Georgian chars left")


# --- courier-history.html ---
replace_all(
    ROOT / "src/app/features/courier/courier-history/courier-history.html",
    [
        (
            "    <p>მიწოდების და აღების დასრულებული დავალებები</p>",
            "    <p>{{ 'courier.historyLead' | t }}</p>",
        ),
        (
            '  <div class="courier-history__sections" role="tablist" aria-label="ისტორიის ტიპი">',
            '  <div class="courier-history__sections" role="tablist" [attr.aria-label]="\'courier.historyType\' | t">',
        ),
        ("      მიწოდებული შეკვეთები", "      {{ 'courier.deliveredOrdersTab' | t }}"),
        ("      აღებული დავალებები", "      {{ 'courier.pickedUpTasksTab' | t }}"),
        (
            '    <div class="courier-history__filters" role="tablist" aria-label="მიწოდების ფილტრი">',
            '    <div class="courier-history__filters" role="tablist" [attr.aria-label]="\'courier.deliveryFilter\' | t">',
        ),
        ("                <span>ასაღები</span>", "                <span>{{ 'courier.amountDue' | t }}</span>"),
        ("                <span>აღებული</span>", "                <span>{{ 'courier.amountTaken' | t }}</span>"),
        ("                <span>გადახდა</span>", "                <span>{{ 'ui.payment' | t }}</span>"),
        (
            "                <span>{{ order.status === 'cancelled' ? 'გაუქმდა' : 'ჩაბარდა' }}</span>",
            "                <span>{{ order.status === 'cancelled' ? ('courier.wasCancelled' | t) : ('courier.wasDelivered' | t) }}</span>",
        ),
        (
            '                <p class="history-card__correct-label">ახალი სტატუსი</p>',
            '                <p class="history-card__correct-label">{{ \'courier.newStatus\' | t }}</p>',
        ),
        (
            '                  <p class="history-card__correct-label">გადახდა</p>',
            '                  <p class="history-card__correct-label">{{ \'ui.payment\' | t }}</p>',
        ),
        (
            "                სტატუსის შეცვლა\n              </button>",
            "                {{ 'courier.changeStatus' | t }}\n              </button>",
        ),
        ("                <dt>Customer</dt>", "                <dt>{{ 'ui.customer' | t }}</dt>"),
        ("                <dt>Phone</dt>", "                <dt>{{ 'ui.phone' | t }}</dt>"),
        ("                <dt>შეკვეთები</dt>", "                <dt>{{ 'courier.ordersLabel' | t }}</dt>"),
        ("                <dt>ამანათები</dt>", "                <dt>{{ 'courier.parcelsLabel' | t }}</dt>"),
        (
            "                აღების დრო: {{ formatPickupTime(task.completed_at) }}",
            "                {{ 'courier.pickupTime' | t: { time: formatPickupTime(task.completed_at) } }}",
        ),
        (
            '                <p class="pickup-history-card__reason">მიზეზი: {{ task.cancellation_reason }}</p>',
            '                <p class="pickup-history-card__reason">{{ \'courier.reasonWithValue\' | t: { reason: task.cancellation_reason } }}</p>',
        ),
        (
            "                  გაუქმების დრო: {{ formatCancelTime(task.cancelled_at) }}",
            "                  {{ 'courier.cancelTime' | t: { time: formatCancelTime(task.cancelled_at) } }}",
        ),
    ],
)

# --- courier-history.ts ---
replace_all(
    ROOT / "src/app/features/courier/courier-history/courier-history.ts",
    [
        (
            """  readonly filterOptions: ReadonlyArray<{ id: HistoryFilter; label: string }> = [
    { id: 'all', label: 'ყველა' },
    { id: 'delivered', label: 'ჩაბარებული' },
    { id: 'cancelled', label: 'გაუქმებული' },
  ];

  readonly pickupFilterOptions: ReadonlyArray<{
    id: CourierPickupHistoryFilter;
    label: string;
  }> = [
    { id: 'all', label: 'ყველა' },
    { id: 'picked_up', label: 'აღებული' },
    { id: 'cancelled', label: 'გაუქმებული' },
  ];""",
            """  readonly filterOptions: ReadonlyArray<HistoryFilter> = ['all', 'delivered', 'cancelled'];

  readonly pickupFilterOptions: ReadonlyArray<CourierPickupHistoryFilter> = [
    'all',
    'picked_up',
    'cancelled',
  ];""",
        ),
        (
            """  emptyStateText(): string {
    switch (this.historyFilter()) {
      case 'delivered':
        return 'ჩაბარებული შეკვეთები არ არის.';
      case 'cancelled':
        return 'გაუქმებული შეკვეთები არ არის.';
      default:
        return 'ისტორია ცარიელია.';
    }
  }

  pickupEmptyStateText(): string {
    switch (this.pickupHistoryFilter()) {
      case 'picked_up':
        return 'აღებული დავალებები არ არის.';
      case 'cancelled':
        return 'გაუქმებული აღების დავალებები არ არის.';
      default:
        return 'აღების ისტორია ცარიელია.';
    }
  }""",
            """  filterLabel(id: HistoryFilter): string {
    switch (id) {
      case 'delivered':
        return i18next.t('ui.delivered');
      case 'cancelled':
        return i18next.t('ui.cancelled');
      default:
        return i18next.t('ui.all');
    }
  }

  pickupFilterLabel(id: CourierPickupHistoryFilter): string {
    switch (id) {
      case 'picked_up':
        return i18next.t('ui.pickedUp');
      case 'cancelled':
        return i18next.t('ui.cancelled');
      default:
        return i18next.t('ui.all');
    }
  }

  emptyStateText(): string {
    switch (this.historyFilter()) {
      case 'delivered':
        return i18next.t('courier.emptyDeliveredHistory');
      case 'cancelled':
        return i18next.t('courier.emptyCancelledHistory');
      default:
        return i18next.t('courier.emptyHistory');
    }
  }

  pickupEmptyStateText(): string {
    switch (this.pickupHistoryFilter()) {
      case 'picked_up':
        return i18next.t('courier.emptyPickedUpTasks');
      case 'cancelled':
        return i18next.t('courier.emptyCancelledPickupTasks');
      default:
        return i18next.t('courier.emptyPickupHistory');
    }
  }""",
        ),
        (
            "    return status === 'cancelled' ? 'გაუქმებული' : 'აღებული';",
            "    return status === 'cancelled' ? i18next.t('ui.cancelled') : i18next.t('ui.pickedUp');",
        ),
        (
            "      this.errorMessage.set(error ?? 'სტატუსის შეცვლა ვერ მოხერხდა');",
            "      this.errorMessage.set(error ?? i18next.t('courier.statusUpdateFailed'));",
        ),
        (
            "    this.successMessage.set('სტატუსი განახლდა');",
            "    this.successMessage.set(i18next.t('courier.statusUpdated'));",
        ),
    ],
)

# Fix history template loops for new option shape
hist = ROOT / "src/app/features/courier/courier-history/courier-history.html"
ht = hist.read_text(encoding="utf-8")
ht = ht.replace(
    """      @for (option of filterOptions; track option.id) {
        <button
          type="button"
          class="courier-history__filter"
          role="tab"
          [class.is-active]="historyFilter() === option.id"
          [attr.aria-selected]="historyFilter() === option.id"
          (click)="setHistoryFilter(option.id)"
        >
          {{ option.label }}
        </button>
      }""",
    """      @for (option of filterOptions; track option) {
        <button
          type="button"
          class="courier-history__filter"
          role="tab"
          [class.is-active]="historyFilter() === option"
          [attr.aria-selected]="historyFilter() === option"
          (click)="setHistoryFilter(option)"
        >
          {{ filterLabel(option) }}
        </button>
      }""",
)
ht = ht.replace(
    """      @for (option of pickupFilterOptions; track option.id) {
        <button
          type="button"
          class="courier-history__filter"
          role="tab"
          [class.is-active]="pickupHistoryFilter() === option.id"
          [attr.aria-selected]="pickupHistoryFilter() === option.id"
          (click)="setPickupHistoryFilter(option.id)"
        >
          {{ option.label }}
        </button>
      }""",
    """      @for (option of pickupFilterOptions; track option) {
        <button
          type="button"
          class="courier-history__filter"
          role="tab"
          [class.is-active]="pickupHistoryFilter() === option"
          [attr.aria-selected]="pickupHistoryFilter() === option"
          (click)="setPickupHistoryFilter(option)"
        >
          {{ pickupFilterLabel(option) }}
        </button>
      }""",
)
hist.write_text(ht, encoding="utf-8")
print("history loops updated")

# ensure i18next import in courier-history.ts
hts = (ROOT / "src/app/features/courier/courier-history/courier-history.ts").read_text(encoding="utf-8")
if "import i18next" not in hts:
    hts = hts.replace(
        "import { Router } from '@angular/router';",
        "import { Router } from '@angular/router';\nimport i18next from 'i18next';",
    )
    (ROOT / "src/app/features/courier/courier-history/courier-history.ts").write_text(hts, encoding="utf-8")
    print("added i18next import to history.ts")
