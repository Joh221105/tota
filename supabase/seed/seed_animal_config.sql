INSERT INTO game_config (key, value, description) VALUES
  (
    'animal_cow',
    '{"animalType":"cow","displayName":"Cow","feedIntervalSeconds":28800,"feedCostCoins":5,"feedItemId":"animal_hay","unlockLevel":1,"products":[{"itemId":"animal_beef","produceTimerSeconds":28800,"yieldMin":2,"yieldMax":3,"dropChance":1.0},{"itemId":"animal_milk","produceTimerSeconds":18000,"yieldMin":2,"yieldMax":3,"dropChance":1.0}]}',
    'V1 cow animal config'
  ),
  (
    'animal_chicken',
    '{"animalType":"chicken","displayName":"Chicken","feedIntervalSeconds":28800,"feedCostCoins":3,"feedItemId":"animal_grain","unlockLevel":3,"products":[{"itemId":"animal_egg","produceTimerSeconds":10800,"yieldMin":2,"yieldMax":4,"dropChance":1.0},{"itemId":"animal_feather","produceTimerSeconds":10800,"yieldMin":1,"yieldMax":1,"dropChance":0.15}]}',
    'V1 chicken animal config'
  )
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();
