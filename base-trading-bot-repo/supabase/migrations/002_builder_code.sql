alter table trade_executions
add column if not exists builder_code text,
add column if not exists builder_code_applied boolean not null default false;
