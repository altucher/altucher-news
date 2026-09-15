-- BlueTAO Assistant (Instinct-style personal assistant) tables.
-- Run with: node scripts/run-sql.mjs scripts/create-assistant-tables.sql

CREATE TABLE IF NOT EXISTS public.assistant_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'waitlist',          -- waitlist | member
  handle TEXT UNIQUE,                                -- local part of the assistant's email address
  display_name TEXT,
  assistant_name TEXT NOT NULL DEFAULT 'Blue',
  timezone TEXT,
  location TEXT,
  standing_instructions TEXT NOT NULL DEFAULT '',
  connections JSONB NOT NULL DEFAULT '{}'::jsonb,
  onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  invited_by UUID,
  invite_code TEXT,
  invites_left INT NOT NULL DEFAULT 3,
  notify_email BOOLEAN NOT NULL DEFAULT TRUE,
  last_checkin_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.assistant_invites (
  code TEXT PRIMARY KEY,
  created_by UUID,
  uses_left INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.assistant_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invited_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.assistant_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',            -- queued | working | waiting | done | failed | cancelled
  summary TEXT,
  result TEXT,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  needs TEXT,                                        -- what the assistant is waiting on from the user
  run_after TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  nudged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS assistant_jobs_user_idx ON public.assistant_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_jobs_status_idx ON public.assistant_jobs(status, run_after);

CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                                -- user | assistant | event
  kind TEXT NOT NULL DEFAULT 'text',                 -- text | job_update | checkin | email_in | email_out | system
  content TEXT NOT NULL,
  job_id UUID REFERENCES public.assistant_jobs(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'web',               -- web | voice | email | cron
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS assistant_messages_user_idx ON public.assistant_messages(user_id, created_at);

CREATE TABLE IF NOT EXISTS public.assistant_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.assistant_jobs(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',            -- pending | sent | cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS assistant_followups_due_idx ON public.assistant_followups(status, due_at);

CREATE TABLE IF NOT EXISTS public.assistant_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,                           -- in | out
  provider_id TEXT,
  from_addr TEXT,
  to_addr TEXT[],
  subject TEXT,
  body TEXT,
  job_id UUID REFERENCES public.assistant_jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS assistant_emails_user_idx ON public.assistant_emails(user_id, created_at DESC);

-- RLS: the app talks to these tables through server routes with the service
-- role, but lock them down so the anon/browser key can only read a user's own rows.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['assistant_profiles','assistant_jobs','assistant_messages','assistant_followups','assistant_emails'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_select_own') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (auth.uid() = user_id)', t || '_select_own', t);
    END IF;
  END LOOP;
END $$;
ALTER TABLE public.assistant_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_waitlist ENABLE ROW LEVEL SECURITY;
