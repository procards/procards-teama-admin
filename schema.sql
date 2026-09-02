-- ProCards - Team A : Admin CRM
-- This is a SEPARATE Supabase project from the main ProCards Commission CRM.
-- Run this whole file once in Supabase SQL Editor (your Team A project) to set up all tables.

-- 1. Agents (name + email only — no PIN, no commission fields. Admin-safe.)
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  email text not null,
  created_at timestamptz default now()
);

-- 2. Banks per agency (ORC, ECR). Unionbank does NOT use this table — see agent_codes below.
create table if not exists banks (
  id uuid primary key default gen_random_uuid(),
  agency text not null check (agency in ('ORC', 'ECR')),
  bank_name text not null,
  created_at timestamptz default now(),
  unique (agency, bank_name)
);

-- Seed starting banks
insert into banks (agency, bank_name) values
  ('ORC', 'Eastwest Bank'),
  ('ECR', 'BOC'),
  ('ECR', 'BPI'),
  ('ECR', 'Metrobank (No QR)'),
  ('ECR', 'Metrobank (QR)'),
  ('ECR', 'RCBC'),
  ('ECR', 'Eastwest')
on conflict do nothing;

-- 3. Unionbank Agent Codes (1 code per agent — used instead of a bank list)
create table if not exists unionbank_agent_codes (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references agents(id) on delete cascade,
  agent_code text not null unique,
  created_at timestamptz default now()
);

-- 4. Turn-Ins (Tab 1 — the daily encoding log)
create table if not exists turn_ins (
  id uuid primary key default gen_random_uuid(),
  agency text not null check (agency in ('ORC', 'ECR')),  -- Unionbank has no turn-in step, see unionbank_agent_codes
  banks text[],              -- e.g. {"RCBC","Eastwest"} — null/empty for Unionbank
  agent_id uuid references agents(id),
  agent_name text not null,  -- denormalized for quick display/email
  client_name text not null,
  date_turn_in date not null,
  encoded_by text not null,  -- admin's typed name
  email_sent boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_turn_ins_client on turn_ins (lower(client_name));
create index if not exists idx_turn_ins_agent on turn_ins (agent_name);

-- 5. Approvals (Tab 2/3 — matched result after screening an agency report)
create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  agency text not null check (agency in ('ORC', 'ECR', 'Unionbank')),
  client_name text not null,
  card_type text,
  credit_limit text,
  bank_name text,
  assigned_agent text default 'Outside Agent',  -- set to 'Outside Agent' when no turn-in match is found
  matched_turn_in_id uuid references turn_ins(id),
  match_status text default 'matched' check (match_status in ('matched', 'duplicate_not_awarded', 'outside_agent')),
  duplicate_note text,       -- e.g. "Duplicate — Earlier Turn-In by Donna Mercado"
  pushed_to_main boolean default false,  -- true once sent to main Commission CRM
  created_at timestamptz default now()
);

create index if not exists idx_approvals_client on approvals (lower(client_name));

-- Row Level Security: since this is admin-only tool gated by a shared app PIN
-- (not per-user Supabase auth), keep RLS simple — allow the anon key to read/write.
-- The real gate is the app's PIN screen + the fact that this project's keys are
-- never exposed to agents.
alter table agents enable row level security;
alter table banks enable row level security;
alter table unionbank_agent_codes enable row level security;
alter table turn_ins enable row level security;
alter table approvals enable row level security;

create policy "anon full access" on agents for all using (true) with check (true);
create policy "anon full access" on banks for all using (true) with check (true);
create policy "anon full access" on unionbank_agent_codes for all using (true) with check (true);
create policy "anon full access" on turn_ins for all using (true) with check (true);
create policy "anon full access" on approvals for all using (true) with check (true);
