INSERT INTO game_config (key, value, description) VALUES
  (
    'recipe_bun',
    '{"inputs":[{"itemId":"crop_wheat","qty":2},{"itemId":"animal_egg","qty":1}],"outputItemId":"processed_bun","outputQty":2,"durationSeconds":1200,"unlockLevel":1,"recipeType":"processing"}',
    'Processing recipe: bun'
  ),
  (
    'recipe_cheese',
    '{"inputs":[{"itemId":"animal_milk","qty":3}],"outputItemId":"processed_cheese","outputQty":2,"durationSeconds":3600,"unlockLevel":2,"recipeType":"processing"}',
    'Processing recipe: cheese'
  ),
  (
    'recipe_pickles',
    '{"inputs":[{"itemId":"crop_cucumber","qty":2}],"outputItemId":"processed_pickles","outputQty":1,"durationSeconds":2700,"unlockLevel":3,"recipeType":"processing"}',
    'Processing recipe: pickles'
  ),
  (
    'recipe_bacon',
    '{"inputs":[{"itemId":"animal_beef","qty":2}],"outputItemId":"processed_bacon","outputQty":3,"durationSeconds":1800,"unlockLevel":4,"recipeType":"processing"}',
    'Processing recipe: bacon'
  ),
  (
    'recipe_ketchup',
    '{"inputs":[{"itemId":"crop_tomato","qty":3}],"outputItemId":"processed_ketchup","outputQty":1,"durationSeconds":1500,"unlockLevel":5,"recipeType":"processing"}',
    'Processing recipe: ketchup'
  ),
  (
    'recipe_mayo',
    '{"inputs":[{"itemId":"animal_egg","qty":2}],"outputItemId":"processed_mayo","outputQty":1,"durationSeconds":900,"unlockLevel":6,"recipeType":"processing"}',
    'Processing recipe: mayo'
  ),
  (
    'recipe_fries',
    '{"inputs":[{"itemId":"crop_potato","qty":2}],"outputItemId":"processed_fries","outputQty":1,"durationSeconds":1200,"unlockLevel":7,"recipeType":"processing"}',
    'Processing recipe: fries'
  ),
  (
    'recipe_onion_rings',
    '{"inputs":[{"itemId":"crop_onion","qty":3}],"outputItemId":"processed_onion_rings","outputQty":1,"durationSeconds":1500,"unlockLevel":9,"recipeType":"processing"}',
    'Processing recipe: onion rings'
  ),
  (
    'recipe_fly_bait',
    '{"inputs":[{"itemId":"animal_feather","qty":3}],"outputItemId":"bait_fly","outputQty":1,"durationSeconds":600,"unlockLevel":5,"recipeType":"processing"}',
    'Processing recipe: fly bait'
  ),
  (
    'recipe_special_bait',
    '{"inputs":[{"itemId":"crop_jalapeno","qty":2},{"itemId":"crop_sesame","qty":1}],"outputItemId":"bait_special","outputQty":1,"durationSeconds":1800,"unlockLevel":10,"recipeType":"processing"}',
    'Processing recipe: special bait'
  ),
  (
    'recipe_recycle_boot',
    '{"inputs":[{"itemId":"junk_boot","qty":3}],"outputItemId":"bait_basic","outputQty":1,"durationSeconds":300,"unlockLevel":1,"recipeType":"recycler"}',
    'Recycler recipe: boot to basic bait'
  ),
  (
    'recipe_recycle_net',
    '{"inputs":[{"itemId":"junk_net","qty":2}],"outputItemId":"rope","outputQty":1,"durationSeconds":300,"unlockLevel":1,"recipeType":"recycler"}',
    'Recycler recipe: net to rope'
  ),
  (
    'recipe_recycle_crate',
    '{"inputs":[{"itemId":"junk_crate","qty":1}],"outputItemId":"random_loot","outputQty":1,"durationSeconds":600,"unlockLevel":1,"recipeType":"recycler"}',
    'Recycler recipe: crate random loot'
  ),
  (
    'recipe_recycle_mixed',
    '{"inputs":[{"itemId":"any_junk","qty":5}],"outputItemId":"random_bronze_crop","outputQty":1,"durationSeconds":900,"unlockLevel":1,"recipeType":"recycler"}',
    'Recycler recipe: mixed junk to bronze crop'
  ),
  (
    'CRATE_RANDOM_LOOT',
    '[{"type":"coins","amount":100,"weight":0.30},{"type":"item","itemId":"bait_basic","qty":2,"weight":0.25},{"type":"item","itemId":"random_normal_crop","qty":3,"weight":0.25},{"type":"item","itemId":"expand_wooden_plank","qty":1,"weight":0.15},{"type":"item","itemId":"timeskip_5min","qty":1,"weight":0.05}]',
    'Recycler crate random loot table'
  )
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();
