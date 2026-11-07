-- Provider-neutral voice design projects; no synthesized audio is generated or billed here.
CREATE TABLE IF NOT EXISTS echo_voice_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id text NOT NULL,
 universe_id text NOT NULL,
 character_id text NOT NULL,
 mode text NOT NULL CHECK (mode IN ('prompt','reference')),
 prompt text NOT NULL DEFAULT '',
 language text NOT NULL DEFAULT 'en',
 variant_count integer NOT NULL DEFAULT 3 CHECK (variant_count BETWEEN 2 AND 3),
 consent_confirmed boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','awaiting_provider','ready')),
 selected_sample_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (owner_id,universe_id,character_id)
);
CREATE TABLE IF NOT EXISTS echo_voice_samples (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES echo_voice_projects(id) ON DELETE CASCADE,
 owner_id text NOT NULL,
 provider text,
 provider_sample_id text,
 audio_object_path text,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS echo_voice_samples_project_idx ON echo_voice_samples(project_id);
