-- Admin Orders list performance indexes
-- Safe to re-run: create index if not exists
-- Does NOT duplicate existing:
--   orders_assigned_courier_id_idx
--   orders_status_idx
--   orders_delivered_at_idx
--   orders_courier_status_delivered_idx
--   orders_courier_sort_idx
--   orders_cancelled_at_idx

-- Newest-first Admin list (Pending default, All Orders)
create index if not exists orders_created_at_desc_idx
  on public.orders (created_at desc);

-- Status + newest (Pending / Delivered / Cancelled tabs)
create index if not exists orders_status_created_at_desc_idx
  on public.orders (status, created_at desc);

-- Status + delivery date (date filter on tabs)
create index if not exists orders_status_delivery_date_idx
  on public.orders (status, delivery_date);

-- Delivery date filter alone
create index if not exists orders_delivery_date_idx
  on public.orders (delivery_date);

-- Delivery city filter
create index if not exists orders_delivery_city_idx
  on public.orders (delivery_city);

-- Pickup city filter
create index if not exists orders_pickup_city_idx
  on public.orders (pickup_city);

-- Courier filter + status (Admin courier filter / Active-by-courier)
create index if not exists orders_assigned_courier_status_idx
  on public.orders (assigned_courier_id, status);

-- User lookup / ownership joins
create index if not exists orders_user_id_idx
  on public.orders (user_id);
