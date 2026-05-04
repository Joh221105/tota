INSERT INTO game_config (key, value, description) VALUES
  (
    'fishing_pool_bait_basic',
    '[{"itemId":"fish_catfish","weight":0.70},{"itemId":"fish_shrimp","weight":0.30}]',
    'V1 active fishing pool for basic bait'
  ),
  (
    'fishing_pool_bait_fly',
    '[{"itemId":"fish_salmon","weight":0.50},{"itemId":"fish_crab","weight":0.25},{"itemId":"fish_tuna","weight":0.25}]',
    'V1 active fishing pool for fly bait'
  ),
  (
    'fishing_pool_bait_special',
    '[{"itemId":"fish_tuna","weight":0.35},{"itemId":"fish_pufferfish","weight":0.35},{"itemId":"fish_oarfish","weight":0.30}]',
    'V1 active fishing pool for special bait'
  ),
  (
    'FISHING_PROGRESS_DURATION',
    '{"bait_basic":60,"bait_fly":50,"bait_special":90}',
    'Seconds required to fill the active fishing progress bar by bait type'
  ),
  (
    'FISHING_SESSION_EXPIRY_SECONDS',
    '300',
    'Seconds before an active fishing session expires'
  ),
  (
    'LEGENDARY_CHANCE_SPECIAL',
    '0.0002',
    'Chance for bait_special active fishing to catch fish_ghostcarp'
  )
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();
