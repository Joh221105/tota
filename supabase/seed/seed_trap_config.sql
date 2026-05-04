INSERT INTO game_config (key, value, description) VALUES
  (
    'trap_wooden_trap',
    '{"fillSeconds":10800,"unlockLevel":1,"loot":[{"itemId":"fish_shrimp","weight":0.60},{"itemId":"fish_catfish","weight":0.30},{"itemId":"fish_crab","weight":0.10}]}',
    'V1 wooden fishing trap config'
  ),
  (
    'trap_wire_trap',
    '{"fillSeconds":14400,"unlockLevel":8,"loot":[{"itemId":"fish_shrimp","weight":0.40},{"itemId":"fish_crab","weight":0.40},{"itemId":"fish_clam","weight":0.20}]}',
    'V1 wire fishing trap config'
  ),
  (
    'trap_deep_trap',
    '{"fillSeconds":21600,"unlockLevel":14,"loot":[{"itemId":"fish_crab","weight":0.35},{"itemId":"fish_salmon","weight":0.35},{"itemId":"fish_pufferfish","weight":0.30}]}',
    'V1 deep fishing trap config'
  ),
  ('TRAP_WORN_CHANCE', '0.10', 'Chance a trap becomes worn after collection'),
  ('TRAP_JUNK_CHANCE', '0.05', 'Chance a trap returns junk instead of fish'),
  ('TRAP_GRADE_NORMAL', '0.65', NULL),
  ('TRAP_GRADE_BRONZE', '0.25', NULL),
  ('TRAP_GRADE_SILVER', '0.08', NULL),
  ('TRAP_GRADE_GOLD', '0.02', NULL),
  ('TRAP_GRADE_DIAMOND', '0.001', NULL),
  ('TRAP_WORN_NORMAL', '0.85', NULL),
  ('TRAP_WORN_BRONZE', '0.12', NULL),
  ('TRAP_WORN_SILVER', '0.03', NULL)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();
