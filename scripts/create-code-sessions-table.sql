-- Hosted coding sessions (BlueTAO Code Agent) backed by the James worker.
CREATE TABLE IF NOT EXISTS public.code_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sid TEXT UNIQUE NOT NULL,
  token TEXT NOT NULL,
  session_key TEXT NOT NULL,
  title TEXT,
  mode TEXT NOT NULL DEFAULT 'auto',
  git_url TEXT,
  status TEXT NOT NULL DEFAULT 'alive',   -- alive | destroyed | killed
  killed TEXT,
  spent_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  model_calls INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS code_sessions_user_idx ON public.code_sessions(user_id, created_at DESC);
ALTER TABLE public.code_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'code_sessions' AND policyname = 'code_sessions_select_own') THEN
    CREATE POLICY code_sessions_select_own ON public.code_sessions FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;
