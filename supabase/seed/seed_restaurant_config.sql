INSERT INTO game_config (key, value, description) VALUES
  (
    'RESTAURANT_TIER_SLOT_LIMITS',
    '{"1":3,"2":5,"3":8,"4":12,"5":16}',
    'Restaurant menu slot limits by restaurant tier'
  ),
  (
    'RESTAURANT_BASE_CUSTOMERS_RATE',
    '{"1":0.0003,"2":0.0008,"3":0.0015,"4":0.0025,"5":0.0040}',
    'Restaurant base customers per second by restaurant tier'
  ),
  (
    'DISH_DEMAND_WEIGHT',
    '{"dish_classic_burger":0.20,"dish_cheeseburger":0.18,"dish_egg_burger":0.10,"dish_bacon_burger":0.15,"dish_fish_fillet":0.10,"dish_spicy_burger":0.08,"dish_shrimp_burger":0.08,"dish_crab_burger":0.05,"dish_tuna_melt":0.05,"dish_fries":0.50,"dish_onion_rings":0.30,"dish_onion_rings_dish":0.30,"dish_strawberry_milkshake":0.20}',
    'Restaurant demand weight by dish'
  ),
  (
    'staff_head_chef',
    '{"hireCost":500,"tiers":[{"t":1,"bonus":"revenue+15%","revMult":1.15},{"t":2,"bonus":"revenue+25%","revMult":1.25,"upgCost":1500},{"t":3,"bonus":"revenue+40%","revMult":1.40,"upgCost":4000}]}',
    'Restaurant staff config: head chef'
  ),
  (
    'staff_maitre_d',
    '{"hireCost":400,"tiers":[{"t":1,"custMult":1.20},{"t":2,"custMult":1.20,"special":"vip_events","upgCost":1200}]}',
    'Restaurant staff config: maitre d'
  ),
  (
    'staff_promoter',
    '{"hireCost":300,"tiers":[{"t":1,"repDecayReduce":0.50},{"t":2,"repGainMult":2.0,"upgCost":900}]}',
    'Restaurant staff config: promoter'
  ),
  (
    'staff_cleaner',
    '{"hireCost":200,"tiers":[{"t":1,"preventsDecorDecay":true},{"t":2,"passiveDecorGain":1,"upgCost":600}]}',
    'Restaurant staff config: cleaner'
  ),
  (
    'staff_guard',
    '{"hireCost":600,"tiers":[{"t":1,"stealReduc":0.30,"alerts":false},{"t":2,"stealReduc":0.50,"alerts":true,"upgCost":2000}]}',
    'Restaurant staff config: guard'
  )
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();
