-- Create memories table for persistent user memory
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "memories_select_own" ON public.memories FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "memories_insert_own" ON public.memories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "memories_update_own" ON public.memories FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "memories_delete_own" ON public.memories FOR DELETE USING (auth.uid() = user_id);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS memories_user_id_idx ON public.memories(user_id);
CREATE INDEX IF NOT EXISTS memories_created_at_idx ON public.memories(created_at DESC);
