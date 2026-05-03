CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT UNIQUE NOT NULL,
  auth_user_id UUID REFERENCES auth.users(id),
  display_name TEXT,
  coins INTEGER NOT NULL DEFAULT 500 CHECK (coins >= 0),
  level INTEGER NOT NULL DEFAULT 1,
  character_xp INTEGER NOT NULL DEFAULT 0,
  skills JSONB NOT NULL DEFAULT '{
    "farming": {"level":0,"xp":0,"available_points":0,"active_bonuses":[]},
    "fishing": {"level":0,"xp":0,"available_points":0,"active_bonuses":[]},
    "ranching": {"level":0,"xp":0,"available_points":0,"active_bonuses":[]},
    "cooking": {"level":0,"xp":0,"available_points":0,"active_bonuses":[]},
    "commerce": {"level":0,"xp":0,"available_points":0,"active_bonuses":[]}
  }',
  inventory_slots JSONB NOT NULL DEFAULT '{"crops":20,"fish":10,"animal_produce":10,"processed":15,"cooked_dishes":10,"tools":10}',
  farm_plots JSONB NOT NULL DEFAULT '[]',
  animals JSONB NOT NULL DEFAULT '{}',
  fishing_traps JSONB NOT NULL DEFAULT '[]',
  active_fishing_session JSONB,
  processing_slots JSONB NOT NULL DEFAULT '[
    {"slotId":"p1","recipeId":null,"state":"EMPTY","startedAt":null,"inputGrades":[]},
    {"slotId":"p2","recipeId":null,"state":"EMPTY","startedAt":null,"inputGrades":[]}
  ]',
  cooking_slots JSONB NOT NULL DEFAULT '[
    {"slotId":"c1","recipeId":null,"state":"EMPTY","startedAt":null,"inputGrades":[]},
    {"slotId":"c2","recipeId":null,"state":"EMPTY","startedAt":null,"inputGrades":[]}
  ]',
  restaurant JSONB NOT NULL DEFAULT '{"tier":1,"listings":[],"staff":{},"lastCollectionTimestamp":0,"openedAt":0,"menuLastChangedAt":0,"reputation":0,"decorScore":0}',
  equipped_pet TEXT,
  pet_fed_until BIGINT NOT NULL DEFAULT 0,
  michelin_stars INTEGER NOT NULL DEFAULT 0,
  michelin_deposits JSONB NOT NULL DEFAULT '{"star1":0,"star2":0,"star3":0,"star4":0,"star5":0}',
  steal_protection_active BOOLEAN NOT NULL DEFAULT TRUE,
  neighbourhood_id UUID,
  stranger_steals_today JSONB NOT NULL DEFAULT '{"count":0,"resetDate":""}',
  thief_stats JSONB NOT NULL DEFAULT '{"totalAttemptsLifetime":0,"totalSuccessesLifetime":0,"nemesisPlayerId":null,"nemesisDisplayName":null,"timesStorenFrom":0}',
  daily_challenge_progress JSONB NOT NULL DEFAULT '{}',
  sunday_market_stall JSONB NOT NULL DEFAULT '{"paidThisWeek":false,"paidWeekId":"","listings":[],"stallSize":5}',
  wishlist_posts_today JSONB NOT NULL DEFAULT '{"count":0,"date":""}',
  help_actions_today JSONB NOT NULL DEFAULT '{"count":0,"date":""}',
  notification_preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  grade TEXT NOT NULL CHECK (grade IN ('Normal','Bronze','Silver','Gold','Diamond','Legendary')),
  quantity INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 999),
  category TEXT NOT NULL CHECK (category IN ('crops','fish','animal_produce','processed','cooked_dishes','tools')),
  UNIQUE(player_id, item_id, grade)
);

CREATE TABLE coin_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id),
  direction TEXT NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount INTEGER NOT NULL,
  transaction_type TEXT NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  idempotency_key TEXT UNIQUE,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE game_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY player_self ON players
  USING (auth_user_id = auth.uid());

CREATE POLICY inventory_self ON inventory
  USING (player_id = (SELECT id FROM players WHERE auth_user_id = auth.uid()));

CREATE POLICY config_read ON game_config FOR SELECT USING (true);
