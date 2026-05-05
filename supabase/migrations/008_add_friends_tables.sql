CREATE TABLE friend_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id UUID NOT NULL REFERENCES players(id),
  to_id UUID NOT NULL REFERENCES players(id),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE friendships (
  player_id UUID NOT NULL REFERENCES players(id),
  friend_id UUID NOT NULL REFERENCES players(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, friend_id)
);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;
