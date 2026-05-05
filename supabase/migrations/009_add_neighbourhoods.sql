CREATE TABLE neighbourhoods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE neighbourhood_members (
  neighbourhood_id UUID NOT NULL REFERENCES neighbourhoods(id),
  player_id UUID NOT NULL REFERENCES players(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (neighbourhood_id, player_id)
);

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS last_active_timestamp INTEGER NOT NULL DEFAULT 0;

ALTER TABLE players
  ADD CONSTRAINT players_neighbourhood_id_fkey
  FOREIGN KEY (neighbourhood_id) REFERENCES neighbourhoods(id);

CREATE OR REPLACE FUNCTION increment_member_count(nb_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE neighbourhoods
  SET member_count = member_count + 1
  WHERE id = nb_id;
$$;

CREATE OR REPLACE FUNCTION decrement_member_count(nb_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE neighbourhoods
  SET member_count = GREATEST(member_count - 1, 0)
  WHERE id = nb_id;
$$;

ALTER TABLE neighbourhoods ENABLE ROW LEVEL SECURITY;
ALTER TABLE neighbourhood_members ENABLE ROW LEVEL SECURITY;
