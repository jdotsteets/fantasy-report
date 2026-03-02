create schema if not exists exec;

create table if not exists exec.projects (
  id bigserial primary key,
  name text not null,
  area text not null default 'general',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists exec.tasks (
  id bigserial primary key,
  title text not null,
  notes text,
  category text not null default 'general',
  priority smallint not null default 3,
  status text not null default 'inbox',
  due_date date,
  project_id bigint references exec.projects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_exec_tasks_status on exec.tasks(status);
create index if not exists idx_exec_tasks_category on exec.tasks(category);
create index if not exists idx_exec_tasks_due_date on exec.tasks(due_date);
create index if not exists idx_exec_tasks_project on exec.tasks(project_id);

create or replace view exec.task_rollup as
select
  t.id,
  t.title,
  t.notes,
  t.category,
  t.priority,
  t.status,
  t.due_date,
  t.created_at,
  t.updated_at,
  p.name as project_name
from exec.tasks t
left join exec.projects p on p.id = t.project_id;
