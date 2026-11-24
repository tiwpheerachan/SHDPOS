-- Calendar filters use actual sale time when a deferred bill was posted later.
create index if not exists pos_orders_actual_sale_calendar on orders((coalesce(sale_occurred_at,created_at)),branch_id)where status in('completed','partially_refunded');
