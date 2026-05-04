INSERT INTO game_config (key, value, description) VALUES
  (
    'recipe_classic_burger',
    '{"inputs":[{"itemId":"processed_bun","qty":1},{"itemId":"animal_beef","qty":1},{"itemId":"crop_lettuce","qty":1}],"outputItemId":"dish_classic_burger","outputQty":1,"durationSeconds":600,"goldValue":80,"tier":1,"unlockLevel":1,"recipeType":"cooking"}',
    'Cooking recipe: classic burger'
  ),
  (
    'recipe_cheeseburger',
    '{"inputs":[{"itemId":"processed_bun","qty":1},{"itemId":"animal_beef","qty":1},{"itemId":"processed_cheese","qty":1},{"itemId":"crop_lettuce","qty":1}],"outputItemId":"dish_cheeseburger","outputQty":1,"durationSeconds":720,"goldValue":120,"tier":1,"unlockLevel":2,"recipeType":"cooking"}',
    'Cooking recipe: cheeseburger'
  ),
  (
    'recipe_egg_burger',
    '{"inputs":[{"itemId":"processed_bun","qty":1},{"itemId":"animal_beef","qty":1},{"itemId":"animal_egg","qty":1},{"itemId":"crop_tomato","qty":1}],"outputItemId":"dish_egg_burger","outputQty":1,"durationSeconds":720,"goldValue":100,"tier":1,"unlockLevel":3,"recipeType":"cooking"}',
    'Cooking recipe: egg burger'
  ),
  (
    'recipe_bacon_burger',
    '{"inputs":[{"itemId":"processed_bun","qty":1},{"itemId":"animal_beef","qty":1},{"itemId":"processed_bacon","qty":1},{"itemId":"processed_cheese","qty":1},{"itemId":"processed_pickles","qty":1}],"outputItemId":"dish_bacon_burger","outputQty":1,"durationSeconds":1080,"goldValue":160,"tier":2,"unlockLevel":6,"recipeType":"cooking"}',
    'Cooking recipe: bacon burger'
  ),
  (
    'recipe_fish_fillet',
    '{"inputs":[{"itemId":"processed_bun","qty":1},{"itemId":"fish_catfish","qty":1},{"itemId":"crop_lettuce","qty":1},{"itemId":"processed_mayo","qty":1}],"outputItemId":"dish_fish_fillet","outputQty":1,"durationSeconds":900,"goldValue":140,"tier":2,"unlockLevel":7,"recipeType":"cooking"}',
    'Cooking recipe: fish fillet'
  ),
  (
    'recipe_spicy_burger',
    '{"inputs":[{"itemId":"processed_bun","qty":1},{"itemId":"animal_beef","qty":1},{"itemId":"crop_jalapeno","qty":1},{"itemId":"processed_cheese","qty":1},{"itemId":"crop_tomato","qty":1}],"outputItemId":"dish_spicy_burger","outputQty":1,"durationSeconds":1200,"goldValue":170,"tier":2,"unlockLevel":9,"recipeType":"cooking"}',
    'Cooking recipe: spicy burger'
  ),
  (
    'recipe_shrimp_burger',
    '{"inputs":[{"itemId":"processed_bun","qty":1},{"itemId":"fish_shrimp","qty":1},{"itemId":"crop_lettuce","qty":1},{"itemId":"processed_mayo","qty":1}],"outputItemId":"dish_shrimp_burger","outputQty":1,"durationSeconds":1080,"goldValue":155,"tier":2,"unlockLevel":10,"recipeType":"cooking"}',
    'Cooking recipe: shrimp burger'
  ),
  (
    'recipe_crab_burger',
    '{"inputs":[{"itemId":"processed_bun","qty":1},{"itemId":"fish_crab","qty":1},{"itemId":"crop_lettuce","qty":1},{"itemId":"crop_tomato","qty":1},{"itemId":"processed_mayo","qty":1}],"outputItemId":"dish_crab_burger","outputQty":1,"durationSeconds":1500,"goldValue":220,"tier":3,"unlockLevel":13,"recipeType":"cooking"}',
    'Cooking recipe: crab burger'
  ),
  (
    'recipe_tuna_melt',
    '{"inputs":[{"itemId":"processed_bun","qty":1},{"itemId":"fish_tuna","qty":1},{"itemId":"processed_cheese","qty":1},{"itemId":"processed_onion_rings","qty":1},{"itemId":"processed_ketchup","qty":1}],"outputItemId":"dish_tuna_melt","outputQty":1,"durationSeconds":1680,"goldValue":240,"tier":3,"unlockLevel":15,"recipeType":"cooking"}',
    'Cooking recipe: tuna melt'
  ),
  (
    'recipe_fries_dish',
    '{"inputs":[{"itemId":"processed_fries","qty":1}],"outputItemId":"dish_fries","outputQty":1,"durationSeconds":300,"goldValue":50,"tier":"side","unlockLevel":4,"recipeType":"cooking"}',
    'Cooking recipe: fries side dish'
  ),
  (
    'recipe_onion_rings_dish',
    '{"inputs":[{"itemId":"processed_onion_rings","qty":1}],"outputItemId":"dish_onion_rings","outputQty":1,"durationSeconds":300,"goldValue":60,"tier":"side","unlockLevel":9,"recipeType":"cooking"}',
    'Cooking recipe: onion rings side dish'
  ),
  (
    'recipe_strawberry_milkshake',
    '{"inputs":[{"itemId":"animal_milk","qty":1},{"itemId":"crop_strawberry","qty":1}],"outputItemId":"dish_strawberry_milkshake","outputQty":1,"durationSeconds":600,"goldValue":90,"tier":"side","unlockLevel":11,"recipeType":"cooking"}',
    'Cooking recipe: strawberry milkshake'
  ),
  (
    'COOKING_XP_BY_TIER',
    '{"1":25,"2":40,"3":60,"side":15}',
    'Cooking XP by recipe tier'
  )
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();
