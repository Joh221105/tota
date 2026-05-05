CREATE TABLE neighbourhood_feed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  neighbourhood_id UUID NOT NULL REFERENCES neighbourhoods(id),
  event_type TEXT NOT NULL,
  event_data JSONB NOT NULL,
  trigger_player_id UUID REFERENCES players(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_feed_neighbourhood
  ON neighbourhood_feed(neighbourhood_id, expires_at DESC);

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS lifetime_stats JSONB NOT NULL DEFAULT '{
    "crops_harvested": 0,
    "fish_caught": 0,
    "help_actions_given": 0,
    "steals_attempted": 0,
    "restaurant_earnings_lifetime": 0
  }';

CREATE OR REPLACE FUNCTION trim_neighbourhood_feed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM neighbourhood_feed
  WHERE id IN (
    SELECT id
    FROM neighbourhood_feed
    WHERE neighbourhood_id = NEW.neighbourhood_id
    ORDER BY created_at DESC
    OFFSET 200
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_trim_neighbourhood_feed
AFTER INSERT ON neighbourhood_feed
FOR EACH ROW
EXECUTE FUNCTION trim_neighbourhood_feed();

ALTER TABLE neighbourhood_feed ENABLE ROW LEVEL SECURITY;
