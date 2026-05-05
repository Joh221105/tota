# CODEBASE_STATE.md — Town & Table
# Paste this file at the TOP of every Cursor prompt, before the task block.
# Update the relevant rows after each task completes.
# Do not add narrative. Keep entries terse.

---

## CURRENT TASK
<!-- Update this before starting each session -->
Task: [7.4] — [Neighbourhood feed + leaderboard]
Status: COMPLETE

Deliverables:
- [x] supabase/functions/neighbourhood-feed/index.ts — addNeighbourhoodFeedEvent, getNeighbourhoodFeed, getNeighbourhoodLeaderboard, addLevelMilestoneFeedEvent
- [x] supabase/functions/neighbourhood-feed/index_test.ts — T7.4 test cases with mocked Supabase client
- [x] supabase/migrations/010_add_neighbourhood_feed.sql — neighbourhood_feed table, lifetime_stats column, feed trim trigger

Done When:
- T7.4.1–T7.4.10 all pass
- addNeighbourhoodFeedEvent inserts neighbourhood_feed rows for players in a neighbourhood and skips unassigned players
- getNeighbourhoodFeed filters by player neighbourhood, excludes expired rows, sorts newest first, paginates, and adds timeAgoString
- getNeighbourhoodLeaderboard returns top 10, player rank, player score, and category
- Feed retention trims oldest entries beyond 200 through database trigger
- Level 20 creates a milestone event; Level 15 does not
- attemptSteal writes an anonymous STEAL feed event best-effort after successful steals

KEY IMPLEMENTATION NOTES:
- Feed events expire after 7 days.
- Feed retention is implemented in migration as trg_trim_neighbourhood_feed, not inline in addNeighbourhoodFeedEvent.
- Leaderboard category restaurant_earnings maps to lifetime_stats.restaurant_earnings_lifetime.
- Level milestone helper treats multiples of 20 as V1 milestones.
- Steal feed event_data excludes thief display/name fields and includes anonymous:true.

TEST CASES SUMMARY:
- T7.4.1: Feed event added → appears in feed
- T7.4.2: Multiple events → sorted newest first
- T7.4.3: Expired event → not returned
- T7.4.4: Steal event → event_data has no thief name
- T7.4.5: Level 15 → no feed event
- T7.4.6: Level 20 → feed event created
- T7.4.7: Other neighbourhood events → filtered out
- T7.4.8: 12 leaderboard players → exactly 10 entries
- T7.4.9: Player ranked 14th → top 10 plus playerRank:14
- T7.4.10: 201 feed events → oldest removed, 200 retained

SPEC_AMBIGUITY: Task 7.4 only says level 15 is not a feed event and level 20 is; the full milestone cadence is unspecified. V1 treats multiples of 20 as level milestones.
SPEC_AMBIGUITY: Task 7.4 category is "restaurant_earnings", but the documented players.lifetime_stats key is "restaurant_earnings_lifetime"; implementation maps the category to that stored key for ordering/scoring.

---

## PREVIOUS TASKS

### Task 7.2 — COMPLETE
Task: [7.2] — [Neighbourhood assignment + monthly inactive rotation]
Deliverables all complete. T7.2.1–T7.2.8 pass.
assignToNeighbourhood skips already-assigned players, prefers friends' neighbourhood with space, falls back to available neighbourhood, creates a new neighbourhood when all full, inserts membership, increments member_count, and writes players.neighbourhood_id. updateLastActive writes players.last_active_timestamp as current Unix seconds. runMonthlyRotation removes players inactive for more than 7 days.
SPEC_AMBIGUITY: Task 7.2 pseudocode puts supabaseAdmin.rpc(...) inside update({member_count: ...}), but Supabase update values cannot be RPC calls; implementation uses increment_member_count/decrement_member_count RPCs directly as the task text requests for atomicity.

### Task 7.1 — COMPLETE
Task: [7.1] — [Friends: sendFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriend, isMutualFriend, getFriendsList, hasHelpNeeded]
Deliverables all complete. T7.1.1–T7.1.9 pass.
sendFriendRequest inserts pending row, sends notification, blocks self-requests, duplicates, and already-friends. acceptFriendRequest inserts bilateral friendship rows, updates request status, and sends notification. declineFriendRequest updates status to declined. removeFriend deletes both friendship rows. isMutualFriend checks bilateral row count. getFriendsList returns public profile plus has_help_needed.
SPEC_AMBIGUITY: None.

### Task 6.4 — COMPLETE
Task: [6.4] — [Steal History + Neighbour Score Helpers]
Deliverables all complete. T6.4.1–T6.4.10 pass.
getPublicThiefStats returns public stats only. successRatePercent handles 0 attempts and rounds to 1 decimal. updateNeighbourScore clamps to 0–100. getDailyStrangerStealCount resets stale UTC dates on read. resetDailyStrangerSteals writes {count:0, resetDate:todayUTC}.
SPEC_AMBIGUITY: None.

### Task 6.3 — COMPLETE
Task: [6.3] — [Steal: attemptSteal]
Deliverables all complete. T6.3.1–T6.3.15 pass.
attemptSteal performs validation, race guard, charge, farm pool decrement, inventory award, stats updates, anonymous notification, and result return.
SPEC_AMBIGUITY: Task 6.3 requires an addNeighbourhoodFeedEvent stub but does not define its signature, payload, or anonymity requirements.

### Task 6.2 — COMPLETE
Task: [6.2] — [Steal: validateStealAttempt]
Deliverables all complete. T6.2.1–T6.2.10 pass.
validateStealAttempt returns structured validation results and performs no writes. Reads target level/neighbourhood_id, thief neighbourhood_id, thief stranger_steals_today, farm state, steal configs, and balance only. Uses validateCanAfford for affordability.
SPEC_AMBIGUITY: calculatePlotState converts exhausted steal pools to RIPE, but T6.2.7 expects STEAL_POOL_EXHAUSTED for a target plot with stealPoolRemaining:0; implementation checks exhausted pool before the state error.

### Task 6.1 — COMPLETE
Task: [6.1] — [Steal: getStealableItems]
Deliverables all complete. T6.1.1–T6.1.8 pass.
getStealableItems reads target level, applies NEW_PLAYER_PROTECTION_LEVEL, uses getFarmState(targetPlayerId), filters STEALABLE plots with stealPoolRemaining > 0, fetches all STEAL_COST_* keys in one getConfigs call, and returns structured results without throwing. isMutualFriend is a V1 stub with test override; default true. Fox pet is a V1 stub; gradeVisible is always 'Unknown'.
SPEC_AMBIGUITY: None.

### Task 5.3 — COMPLETE
Task: [5.3] — [Restaurant Staff: hireStaff, upgradeStaff, calculateStaffBonuses]
Deliverables all complete. T5.3.1–T5.3.10 pass.
hireStaff reads staff config, blocks duplicate hires, debits STAFF_HIRE through debitCoins, and writes restaurant.staff[staffType] with tier 1. upgradeStaff blocks missing and max-tier staff, debits STAFF_UPGRADE through debitCoins, and increments tier. calculateStaffBonuses is pure and returns head chef, maitre d, guard, promoter, and cleaner bonuses.
SPEC_AMBIGUITY: Task 5.2 accepted unspecified staff JSON while Task 5.3 defines Record<staffType, StaffRecord>; implementation tolerates legacy array-shaped staff but writes 5.3 record-shaped staff.

### Task 5.2 — COMPLETE
Task: [5.2] — [Restaurant: collectRestaurantEarnings, getFavouredDish]
Deliverables all complete. T5.2.1–T5.2.10 pass.
collectRestaurantEarnings sells listed dishes by tier customer rate and demand weight, applies grade/time/favoured/staff/decor multipliers, credits coins through creditCoins, removes depleted listings, updates xpAwardedDate once per UTC day, and writes players.restaurant once at end. getFavouredDish follows the deterministic hash spec.
SPEC_AMBIGUITY: Task 5.2 calls calculateStaffBonuses but does not define restaurant.staff shape; implementation accepts array entries or object keys with role/type/staffType names.
SPEC_AMBIGUITY: Task 5.2 recipe pseudocode reads baseGoldValue, but existing cooking recipe configs use goldValue; implementation supports baseGoldValue first and falls back to goldValue.
SPEC_AMBIGUITY: Task 5.2 maps side_dish to dish_onion_rings_dish, while Task 4.2 cooking output and demand config use dish_onion_rings.

### Task 5.1 — COMPLETE
Task: [5.1] — [Restaurant: listDishOnMenu, unlistDishFromMenu, getRestaurantState, calculateTimeMultiplier, restaurant/index.ts]
Deliverables all complete. T5.1.1–T5.1.10 pass.
listDishOnMenu validates dish_ prefix, enforces restaurant tier menu slot limits by unique dishId, removes cooked dishes through inventory helper, updates players.restaurant listings, and resets menuLastChangedAt. unlistDishFromMenu returns listed dishes through inventory helper and removes listings. getRestaurantState returns currentMultiplier, menu slot usage, and restaurant fields.
SPEC_AMBIGUITY: removeItemFromInventory reports short stacks as INSUFFICIENT_QUANTITY:{have}:{requested}, while Task 5.1 expects exact bare INSUFFICIENT_QUANTITY for listing more than owned.

### Task 4.2 — COMPLETE
Task: [4.2] — [Cooking: startCookingJob, collectCookingOutput]
Deliverables all complete. T4.2.1–T4.2.10 pass.
startCookingJob validates all inputs before removal, consumes ingredients through inventory helpers, writes RUNNING cooking slot, enforces c3/c4 level gates, and awards XP + cooking skill XP from COOKING_XP_BY_TIER. collectCookingOutput adds dish outputs through inventory helpers, pauses on full cooked_dishes inventory, and clears completed slots.
SPEC_AMBIGUITY: Task 4.2 inherits Task 4.1 PAUSED behavior; implementation treats PAUSED as a retryable collectible state.
SPEC_AMBIGUITY: Task 4.2 says cooking recipes use the same structure as processing recipes, where examples use outputQty but pseudocode used outputQuantity.
SPEC_AMBIGUITY: Task 4.2 names a cooking side recipe recipe_fries, but Task 4.1 already uses recipe_fries for processing fries; implementation uses recipe_fries_dish for the cooked side dish config key.
SPEC_AMBIGUITY: Cooking recipe inputs are listed as shorthand names (bun, beef, lettuce); implementation maps them to concrete V1 inventory item IDs such as processed_bun, animal_beef, crop_lettuce.

### Task 4.1 — COMPLETE
Task: [4.1] — [Processing: startProcessingJob, calculateSlotState, collectProcessingOutput]
Deliverables all complete. T4.1.1–T4.1.15 pass.
startProcessingJob validates all inputs before removal, consumes ingredients through inventory helpers, writes RUNNING processing slot, and awards 20 XP. collectProcessingOutput adds outputs through inventory helpers, pauses on full inventory, clears completed slots, and credits crate coins through creditCoins.
SPEC_AMBIGUITY: Recipe examples use outputQty, but pseudocode reads recipe.outputQuantity.
SPEC_AMBIGUITY: The grade probability table stops at weight 5 although Legendary has weight 6; implementation clamps averages above 5 to the weight-5 row.
SPEC_AMBIGUITY: PAUSED resumes conflicts with calculateSlotState returning PAUSED; implementation treats PAUSED as a collectible retry state.
SPEC_AMBIGUITY: recipe_recycle_mixed uses any_junk as an input item, but inventory stores concrete item IDs.
SPEC_AMBIGUITY: random_normal_crop/random_bronze_crop are placeholders, not concrete item IDs; implementation rolls uniformly from the V1 crop catalog.

### Task 3.4 — COMPLETE
Task: [3.4] — [Fishing: startFishingSession, submitFishingResult, fishing/index.ts]
Deliverables all complete. T3.4.1–T3.4.11 pass.
startFishingSession consumes Normal bait through inventory helper and writes players.active_fishing_session JSONB. submitFishingResult validates token/expiry, awards fish through inventory helper, awards XP stubs, sends legendary notification stub, and clears the active session.
SPEC_AMBIGUITY: Impatient grade adjustment creates negative Gold and Diamond rates; implementation follows literal additive table and normalises without clamping so T3.4.4 can exceed 70% Normal.
SPEC_AMBIGUITY: Task expects no bait to throw exactly INSUFFICIENT_QUANTITY, but removeItemFromInventory throws ITEM_NOT_FOUND:item:grade for a missing stack and INSUFFICIENT_QUANTITY:have:requested for a short stack.

### Task 3.3 — COMPLETE
Task: [3.3] — [Fishing Traps: calculateTrapState, collectTrap, traps/index.ts]
Deliverables all complete. T3.3.1–T3.3.10 pass.
collectTrap mutates players.fishing_traps JSONB only through players update and uses addItemToInventory for loot.
SPEC_AMBIGUITY: Junk items are specified as a literal list, not a game_config key.

### Task 3.2 — COMPLETE
Task: [3.2] — [Animals: feedAnimal, collectAnimalProduce, animals/index.ts]
Deliverables all complete. T3.2.1–T3.2.13 pass.
feedAnimal and collectAnimalProduce mutate players.animals JSONB only through players update and use economy/inventory helpers.
SPEC_AMBIGUITY: collectAnimalProduce hardcodes 0.15 for egg feather side drops, but AnimalProduct also defines dropChance in animal config.

### Task 3.1 — COMPLETE
Task: [3.1] — [Animals: getAnimalConfig, calculateAnimalHappiness, lib/animals.ts]
Deliverables all complete. T3.1.1–T3.1.10 pass.
getAnimalConfig fetches animal_{animalType} from game_config and throws ANIMAL_NOT_FOUND:{animalType}. calculateAnimalHappiness is pure.
SPEC_AMBIGUITY: Prompt says value is a JSON-encoded AnimalConfig but sample seed JSON omits animalType and displayName.

### Task 2.8 — COMPLETE
Task: [2.8] — [Farm: rollGrade, harvest-plot/index.ts]
Deliverables all complete. T2.8.1–T2.8.10 pass.
rollGrade applies base rates, fertiliser, farming skill, and watering boosts, then normalises and rolls highest rarity first.
SPEC_AMBIGUITY: Max V1 fertiliser, skill 10, and 3 waterings do not drive Normal below 1%, so floor behavior is only directly observable with out-of-range boost inputs.

### Task 2.7 — COMPLETE
Task: [2.7] — [Farm: harvestPlot, harvest-plot/index.ts]
Deliverables all complete. T2.7.1–T2.7.14 pass.
harvestPlot calculates stolen/penalized yield, adds inventory through helper, awards XP stubs, and resets annual/perpetual plots. Updated by Task 2.8 to use real rollGrade.
SPEC_AMBIGUITY: Top-level throws list says NEEDS_WATER should throw PLOT_NOT_READY, but Step 2 requires PLOT_EMPTY.

### Task 2.6 — COMPLETE
Task: [2.6] — [Farm: applyFertiliser, apply-fertiliser/index.ts]
Deliverables all complete. T2.6.1–T2.6.8 pass.
applyFertiliser stores bronze/silver boosts on GROWING plots, enforces caps before writes, uses friend stubs, awards guest_buff_token through inventory helper.

### Task 2.5 — COMPLETE
Task: [2.5] — [Farm: waterPlot, water-plot/index.ts]
Deliverables all complete. T2.5.1–T2.5.12 pass.
waterPlot moves plantedAt/regrowStartedAt backwards to reduce remaining time and uses V1 friend stubs for help action, XP, and notification.
SPEC_AMBIGUITY: Spec sample computes newTimeRemaining from plantedAt even for perpetual regrow plots; perpetual tests require using regrowStartedAt.

### Task 2.4 — COMPLETE
Task: [2.4] — [Farm: getFarmState, get-farm-state/index.ts]
Deliverables all complete. T2.4.1–T2.4.7 pass.
getFarmState uses one players query and one batched getConfigs query. calculatePlotState is called once per plot with no DB calls inside the map.

### Task 2.3 — COMPLETE
Task: [2.3] — [Farm: calculatePlotState, lib/farm.ts]
Deliverables all complete. T2.3.1–T2.3.15 pass.
calculatePlotState is pure, makes zero DB calls, and derives all state from arguments.
SPEC_AMBIGUITY: Behavior is not specified when isPerpetualRegrowing is true but regrowStartedAt or regrowTimeSeconds is null.

### Task 2.2 — COMPLETE
Task: [2.2] — [Farm: plantCrop, plant-crop/index.ts]
Deliverables all complete. T2.2.1–T2.2.12 pass.
plantCrop deducts coins via debitCoins, locks yield and stealPool at planting time, and writes entire farm_plots JSONB array back.
SPEC_AMBIGUITY: plantCrop spec says validateCanAfford throws INSUFFICIENT_FUNDS, but Task 1.5 helper returns canAfford=false.
SPEC_AMBIGUITY: plantCrop throws list mentions INVALID_CROP_ID, but Step 3 and T2.2.12 require CROP_NOT_FOUND from getCropConfig.

### Task 2.1 — COMPLETE
Task: [2.1] — [Crops: getCropConfig, getAllCropConfigs, lib/crops.ts]
Deliverables all complete. T2.1.1–T2.1.9 pass.
getCropConfig validates cropId against CROP_IDS list before DB call. getAllCropConfigs uses single batch getConfigs call.

### Task 1.7 — COMPLETE
Task: [1.7] — [Inventory: expandInventory, expand-inventory/index.ts]
Deliverables all complete. T1.7.1–T1.7.8 pass.
SPEC_AMBIGUITY: T1.7.2 says 0 Wooden Planks should throw INSUFFICIENT_QUANTITY, but removeItemFromInventory throws ITEM_NOT_FOUND when no stack exists.

### Task 1.6 — COMPLETE
Task: [1.6] — [Inventory: addItemToInventory, removeItemFromInventory, getInventory, lib/inventory.ts]
Deliverables all complete. T1.6.1–T1.6.13 pass.
SPEC_AMBIGUITY: getInventory required by state file but exact return shape/error cases not defined.

### Task 1.5 — COMPLETE
Task: [1.5] — [Economy: getBalance, validateCanAfford, lib/economy.ts]
Deliverables all complete. T1.5.1–T1.5.8 pass.
Both functions are READ-ONLY — no coin mutations.

### Task 1.4 — COMPLETE
Task: [1.4] — [Economy: creditCoins, lib/economy.ts, credit_coins Postgres RPC]
Deliverables all complete. T1.4.1–T1.4.7 pass.
creditCoins is the ONLY function that may run UPDATE players SET coins = coins + amount.

### Task 1.3 — COMPLETE
Task: [1.3] — [Economy: debitCoins, lib/economy.ts, debit_coins Postgres RPC]
Deliverables all complete. T1.3.1–T1.3.11 pass.
debitCoins is the ONLY function that may run UPDATE players SET coins = coins - amount.

### Task 1.2 — COMPLETE
Task: [1.2] — [Auth: loginOrCreate, getPlayerProfile, TownAndTableAuth.swift]
Deliverables all complete. T1.2.1–T1.2.13 pass.
RESOLVED SPEC_AMBIGUITY: neighbour_score column not defined → ADD to players table: neighbour_score INTEGER NOT NULL DEFAULT 50

### Task 1.1 — COMPLETE
Task: [1.1] — [Database Foundation: Schema, Seed, initialiseNewPlayer, lib/config.ts]
Status: COMPLETE (T1.1.1–T1.1.12 all pass)

---

## STACK
- Client:   SwiftUI (iOS 17+, Swift 5.9+)
- Backend:  Supabase Edge Functions (TypeScript, Deno runtime)
- Database: Supabase PostgreSQL
- Auth:     Supabase Auth — Anonymous (device_id) + Sign in with Apple (V2)
- Config:   game_config table in Supabase (key TEXT, value TEXT/JSON)
- Realtime: Supabase Realtime (push notifications)
- Tests:    Deno.test with mocked Supabase client

---

## DATABASE TABLES
<!-- Status: MIGRATED | PENDING -->

| Table               | Status  | Notes                                              |
|---------------------|---------|----------------------------------------------------|
| players             | MIGRATED | Main player row. JSONB cols: farm_plots, skills, inventory_slots, restaurant, etc. neighbour_score INTEGER NOT NULL DEFAULT 50 (resolved ambiguity 1.2). |
| inventory           | MIGRATED | One row per (player_id, item_id, grade). UNIQUE constraint on all three. |
| coin_transactions   | MIGRATED | Audit log. idempotency_key UNIQUE constraint.      |
| game_config         | MIGRATED | key TEXT PK, value TEXT (JSON-encoded).            |
| friend_requests     | PENDING  | id UUID PK, from_id, to_id, status (pending/accepted/declined), sent_at. RLS enabled. |
| friendships         | PENDING  | (player_id, friend_id) composite PK. Bilateral: both directions inserted on accept. RLS enabled. |

---

## MIGRATIONS
<!-- List SQL migration files in order. Status: APPLIED | PENDING -->

| File                        | Status  | Contents                              |
|-----------------------------|---------|---------------------------------------|
| 001_initial_schema.sql      | APPLIED | All tables + RLS policies             |
| 003_rpc_credit_coins.sql    | APPLIED | credit_coins() Postgres function      |
| 004_add_neighbour_score.sql | APPLIED | ALTER TABLE players ADD COLUMN neighbour_score INTEGER NOT NULL DEFAULT 50 |
| 005_rpc_debit_coins.sql     | APPLIED | debit_coins() Postgres function (SELECT FOR UPDATE, UPDATE players, INSERT coin_transactions) |
| 006_add_sabotage_log.sql    | APPLIED | Adds sabotage_log column to players   |
| 007_add_steal_log.sql       | PENDING | ALTER TABLE players ADD COLUMN steal_log JSONB NOT NULL DEFAULT '[]' |
| 008_add_friends_tables.sql  | PENDING | CREATE TABLE friend_requests + CREATE TABLE friendships (bilateral PK). RLS enabled on both. |
| seed_game_config.sql        | APPLIED | All balance constants + 11 crop configs |
| seed_animal_config.sql      | APPLIED | V1 animal configs                     |
| seed_trap_config.sql        | APPLIED | V1 trap configs + trap roll constants |
| seed_fishing_config.sql     | APPLIED | Fishing pools, durations, expiry, legendary chance             |
| seed_processing_config.sql  | APPLIED | 14 recipe configs + CRATE_RANDOM_LOOT                          |
| seed_cooking_config.sql     | APPLIED | 12 cooking recipes + COOKING_XP_BY_TIER                        |
| seed_restaurant_config.sql  | APPLIED | Restaurant slot, earnings, and staff configs                   |

---

## EDGE FUNCTIONS
<!-- Status: COMPLETE | STUBBED | BROKEN | PENDING -->
<!-- STUBBED = deployed but contains placeholder logic marked // STUB -->

| Task | Function Name              | File Path                                      | Status  | Notes |
|------|----------------------------|------------------------------------------------|---------|-------|
| 1.1  | initialiseNewPlayer        | supabase/functions/initialise-new-player/index.ts | COMPLETE | Idempotent. Inserts players row + farm_plots array. |
| 1.2  | loginOrCreate              | supabase/functions/login-or-create/index.ts    | COMPLETE | Creates anon auth user + links to players row. Email: ${deviceId}@device.local |
| 1.2  | getPlayerProfile           | supabase/functions/get-player-profile/index.ts | COMPLETE | Public fields only. No coins, no inventory. SELECTs neighbour_score. |
| 1.3  | debitCoins                 | supabase/functions/lib/economy.ts              | COMPLETE | Calls debit_coins() RPC. ONLY coins decrement path. |
| 1.4  | creditCoins                | supabase/functions/lib/economy.ts              | COMPLETE | Calls credit_coins() RPC. ONLY coins increment path. |
| 1.5  | getBalance                 | supabase/functions/lib/economy.ts              | COMPLETE | READ-ONLY. SELECT coins FROM players.           |
| 1.5  | validateCanAfford          | supabase/functions/lib/economy.ts              | COMPLETE | READ-ONLY. Returns {canAfford, balance, required}. |
| 1.6  | addItemToInventory         | supabase/functions/lib/inventory.ts            | COMPLETE | UPSERT on inventory table. Enforces slot limits. |
| 1.6  | removeItemFromInventory    | supabase/functions/lib/inventory.ts            | COMPLETE | Deletes row if quantity hits 0.                 |
| 1.6  | getInventory               | supabase/functions/lib/inventory.ts            | COMPLETE | Returns all or one category. SPEC_AMBIGUITY on exact shape. |
| 1.7  | expandInventory            | supabase/functions/expand-inventory/index.ts   | COMPLETE | Consumes material, updates inventory_slots JSONB. |
| 2.1  | getCropConfig              | supabase/functions/lib/crops.ts                | COMPLETE | Reads game_config table. Throws CROP_NOT_FOUND. |
| 2.1  | getAllCropConfigs          | supabase/functions/lib/crops.ts                | COMPLETE | Batch fetch all 11 Phase 1 crops.               |
| 2.2  | plantCrop                  | supabase/functions/plant-crop/index.ts         | COMPLETE | Writes to farm_plots JSONB array.            |
| 2.3  | calculatePlotState         | supabase/functions/lib/farm.ts                 | COMPLETE | PURE FUNCTION. Zero DB calls. Pass consts in. |
| 2.4  | getFarmState               | supabase/functions/get-farm-state/index.ts     | COMPLETE | Max 2 DB queries. Returns EnrichedPlot[].    |
| 2.5  | waterPlot                  | supabase/functions/water-plot/index.ts         | COMPLETE | Moves plantedAt backwards. Contains STUBs (7.1).|
| 2.6  | applyFertiliser            | supabase/functions/apply-fertiliser/index.ts   | COMPLETE | Stores bronzeBoost/silverBoost on plot. Contains STUBs (7.1, 7.3, 10.1, 12.1). |
| 2.7  | harvestPlot                | supabase/functions/harvest-plot/index.ts       | COMPLETE | Harvests yield, rolls grades, awards XP, resets/updates plot. Contains STUBs (10.1, 10.2). |
| 2.8  | rollGrade                  | supabase/functions/harvest-plot/index.ts       | COMPLETE | Pure grade roller integrated into harvestPlot. |
| 3.2  | animals                    | supabase/functions/animals/index.ts            | COMPLETE | feedAnimal and collectAnimalProduce. Contains STUBs (7.1, 7.3, 10.1, 10.2, 12.1). |
| 3.3  | traps                      | supabase/functions/traps/index.ts              | COMPLETE | calculateTrapState and collectTrap. Contains STUBs (10.1, 10.2). |
| 3.4  | fishing                    | supabase/functions/fishing/index.ts            | COMPLETE | startFishingSession, submitFishingResult. Contains STUBs (10.1, 10.2, 12.1). |
| 4.1  | processing                 | supabase/functions/processing/index.ts         | COMPLETE | startProcessingJob, calculateSlotState, collectProcessingOutput, rollOutputGrade, rollCrateLoot. |
| 4.2  | cooking                    | supabase/functions/cooking/index.ts            | COMPLETE | startCookingJob, collectCookingOutput. Contains STUBs (10.1, 10.2). |
| 5.1-5.3 | restaurant              | supabase/functions/restaurant/index.ts         | COMPLETE | Menu listing/state, earnings, favoured dishes, and staff hire/upgrade. |
| 6.1-6.4 | steal                   | supabase/functions/steal/index.ts              | COMPLETE | Steal UI, validation, execution, history, and score helpers. Fox pet stub (Task 11.2). |
| 7.1  | friends                    | supabase/functions/friends/index.ts            | PENDING  | sendFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriend, isMutualFriend (replaces stub), getFriendsList, hasHelpNeeded. |

---

## HELPER MODULES
<!-- Shared libs used by multiple Edge Functions -->

| File                              | Status  | Exports                                          |
|-----------------------------------|---------|--------------------------------------------------|
| supabase/functions/lib/config.ts  | COMPLETE | getConfig(key), getConfigs(keys[])               |
| supabase/functions/lib/economy.ts | COMPLETE | debitCoins, creditCoins, getBalance, validateCanAfford |
| supabase/functions/lib/inventory.ts | COMPLETE | addItemToInventory, removeItemFromInventory, getInventory, getCategory |
| supabase/functions/lib/crops.ts   | COMPLETE | getCropConfig, getAllCropConfigs, parseCropConfig |
| supabase/functions/lib/farm.ts    | COMPLETE | calculatePlotState, PlotConstants, FarmPlot, PlotStateResult |
| supabase/functions/lib/animals.ts | COMPLETE | getAnimalConfig, calculateAnimalHappiness, AnimalConfig, AnimalRecord |
| supabase/functions/lib/supabase.ts | COMPLETE | supabaseAdmin (service_role client)              |

---

## SWIFT CLIENT FILES
<!-- Status: COMPLETE | STUBBED | PENDING -->

| File                        | Status  | Notes                                            |
|-----------------------------|---------|--------------------------------------------------|
| TownAndTableAuth.swift      | COMPLETE | loginOnLaunch(). deviceId = identifierForVendor. Stores sessionToken in Keychain. |
| FarmViewModel.swift         | COMPLETE | loadFarm(playerId:). Calls get-farm-state.   |

---

## TYPESCRIPT INTERFACES (Canonical Definitions)
<!-- Source of truth for data shapes. Do not let Cursor redefine these. -->

```typescript
// FarmPlot — stored in players.farm_plots JSONB array
interface FarmPlot {
  plotId: string;               // 'plot_1' through 'plot_N'
  cropId: string | null;
  state: PlotState;
  plantedAt: number;            // unix seconds, server time
  regrowStartedAt: number | null;
  yield: number;
  stealPool: number;            // floor(yield * 0.40), min 1
  stealPoolRemaining: number;
  waterings: number;            // 0–3
  hasBugs: boolean;
  hasWeeds: boolean;
  fertilised: boolean;
  fertiliserBronzeBoost: number;
  fertiliserSilverBoost: number;
  isPerpetualRegrowing: boolean;
  needsWater: boolean;
  lastPestCheck: number;
}
type PlotState = 'EMPTY'|'PLANTED'|'GROWING'|'RIPE'|'STEALABLE'|'WITHERED'|'NEEDS_WATER';

// PlotConstants — always fetched from game_config, never hardcoded
interface PlotConstants {
  STEAL_WINDOW_SECONDS: number;     // 60
  OFFLINE_CAP_SECONDS: number;      // 57600
  WITHER_TIME_MULTIPLIER: number;   // 2.0
  MAX_WATERINGS_PER_CYCLE: number;  // 3
}

// CropConfig — parsed from game_config rows
interface CropConfig {
  cropId: string;
  growTimeSeconds: number;
  regrowTimeSeconds: number | null;
  seedCostCoins: number;
  isPerpetual: boolean;
  unlockLevel: number;
  baseYieldMin: number;
  baseYieldMax: number;
  seasonAvailability: string;
  itemCategory: 'crops';
}

// InventoryStack — one row in the inventory table
interface InventoryStack {
  itemId: string;
  grade: 'Normal'|'Bronze'|'Silver'|'Gold'|'Diamond'|'Legendary';
  quantity: number;  // 1–999
}
type InventoryCategory = 'crops'|'fish'|'animal_produce'|'processed'|'cooked_dishes'|'tools';

// ProcessingSlot — stored in players.processing_slots JSONB array
interface ProcessingSlot {
  slotId: string;
  recipeId: string | null;
  state: 'EMPTY'|'RUNNING'|'COMPLETE'|'PAUSED';
  startedAt: number | null;
  inputGrades: string[];  // flat array, one entry per input unit
}

// ProcessingRecipe — parsed from game_config rows (key = recipeId)
interface ProcessingRecipe {
  inputs: { itemId: string; qty: number }[];
  outputItemId: string;
  outputQty: number;
  durationSeconds: number;
  unlockLevel: number;
  recipeType: 'processing'|'recycler';
}

// CookingSlot — stored in players.cooking_slots JSONB array
interface CookingSlot {
  slotId: 'c1'|'c2'|'c3'|'c4';
  recipeId: string | null;
  state: 'EMPTY'|'RUNNING'|'COMPLETE'|'PAUSED';
  startedAt: number | null;
  inputGrades: string[];
}

// CookingRecipe — parsed from game_config rows (key = recipeId)
interface CookingRecipe {
  inputs: { itemId: string; qty: number }[];
  outputItemId: string;
  outputQty: number;
  durationSeconds: number;
  goldValue: number;
  tier: 1|2|3|'side';
  unlockLevel: number;
  recipeType: 'cooking';
}
```

---

## ERROR STRINGS (Exact — Do Not Change)
<!-- Cursor must use these exact strings. No variations. -->

| Error String                              | Thrown By                  |
|-------------------------------------------|----------------------------|
| INVALID_AMOUNT                            | debitCoins, creditCoins, validateCanAfford |
| INVALID_TRANSACTION_TYPE                  | debitCoins, creditCoins    |
| INVALID_IDEMPOTENCY_KEY                   | debitCoins, creditCoins    |
| INSUFFICIENT_FUNDS:{balance}:{amount}     | debitCoins (via Postgres RPC) |
| PLAYER_NOT_FOUND:{playerId}               | getPlayerProfile, getBalance |
| INVALID_DEVICE_ID                         | loginOrCreate              |
| INVALID_PLATFORM                          | loginOrCreate              |
| CONFIG_KEY_NOT_FOUND:{key}                | getConfig, getConfigs      |
| CROP_NOT_FOUND:{cropId}                   | getCropConfig              |
| INVALID_GRADE                             | addItemToInventory         |
| INVALID_QUANTITY                          | addItemToInventory         |
| INVENTORY_FULL:{category}:{used}:{max}    | addItemToInventory         |
| STACK_OVERFLOW                            | addItemToInventory         |
| ITEM_NOT_FOUND:{itemId}:{grade}           | removeItemFromInventory    |
| INSUFFICIENT_QUANTITY:{have}:{requested}  | removeItemFromInventory    |
| INVALID_EXPANSION_MATERIAL                | expandInventory            |
| STEEL_BEAM_REQUIRES_CATEGORY              | expandInventory            |
| INVALID_CATEGORY                          | expandInventory            |
| AT_MAX_CAPACITY:{category}:{current}      | expandInventory            |
| PLOT_NOT_FOUND:{plotId}                   | plantCrop, waterPlot, harvestPlot |
| PLOT_OCCUPIED:{plotId}                    | plantCrop                  |
| CROP_NOT_UNLOCKED:{cropId}                | plantCrop                  |
| PLOT_NOT_GROWING:{state}                  | waterPlot                  |
| MAX_WATERINGS_REACHED                     | waterPlot                  |
| NOT_FRIENDS                               | waterPlot, applyFertiliser |
| HELP_ACTIONS_EXHAUSTED                    | waterPlot, applyFertiliser |
| FERTILISER_AT_MAX:{plotId}                | applyFertiliser            |
| PLOT_EMPTY                                | harvestPlot                |
| PLOT_NOT_READY                            | harvestPlot                |
| ANIMAL_NOT_FOUND:{animalType}             | getAnimalConfig            |
| ANIMAL_NOT_FOUND:{animalId}               | feedAnimal, collectAnimalProduce |
| INVALID_PRODUCT:{productItemId}           | collectAnimalProduce       |
| NEGLECTED_NO_PRODUCE:{animalId}           | collectAnimalProduce       |
| PRODUCE_NOT_READY:{seconds}               | collectAnimalProduce       |
| TRAP_NOT_FOUND:{trapId}                   | collectTrap                |
| TRAP_NOT_READY:{timeRemaining}            | collectTrap                |
| INVALID_BAIT_TYPE                         | startFishingSession        |
| FISHING_SESSION_ACTIVE                    | startFishingSession        |
| NO_ACTIVE_SESSION                         | submitFishingResult        |
| INVALID_SESSION_TOKEN                     | submitFishingResult        |
| SESSION_EXPIRED                           | submitFishingResult        |
| INVALID_COMPLETION_PERCENT                | submitFishingResult        |
| SLOT_NOT_FOUND:{slotId}                   | startProcessingJob, collectProcessingOutput, startCookingJob, collectCookingOutput |
| SLOT_OCCUPIED:{slotId}                    | startProcessingJob, startCookingJob |
| SLOT_NOT_UNLOCKED:c3                      | startCookingJob            |
| SLOT_NOT_UNLOCKED:c4                      | startCookingJob            |
| RECIPE_NOT_FOUND:{recipeId}               | startProcessingJob, startCookingJob |
| RECIPE_NOT_UNLOCKED                       | startProcessingJob, startCookingJob |
| INSUFFICIENT_INGREDIENTS:{recipeId}:{itemId} | startProcessingJob, startCookingJob |
| JOB_NOT_COMPLETE:{state}                  | collectProcessingOutput, collectCookingOutput |
| INVALID_DISH_ID:{dishId}                  | listDishOnMenu                     |
| MENU_FULL:{slotLimit}                     | listDishOnMenu                     |
| LISTING_NOT_FOUND:{dishId}:{grade}        | unlistDishFromMenu                 |

---

## KNOWN DEVIATIONS FROM PRD
<!-- Anything resolved differently from the spec. Be specific. -->

| Task | Deviation | Resolution |
|------|-----------|------------|
| —    | —         | —          |

---

## RESOLVED SPEC_AMBIGUITIES
<!-- Any // SPEC_AMBIGUITY comments Cursor flagged and how you resolved them. -->

| Task | Ambiguity | Resolution |
|------|-----------|------------|
| 1.2  | neighbour_score column not defined in schema | ADD to players table: neighbour_score INTEGER NOT NULL DEFAULT 50 |
| 1.6  | getInventory required by CODEBASE_STATE.md but exact return shape/error cases not defined in task prompt | Implemented `{ playerId, category, items }`, optional category filter, DB_ERROR only |
| 1.7  | T1.7.2 says 0 Wooden Planks should throw INSUFFICIENT_QUANTITY, but removeItemFromInventory throws ITEM_NOT_FOUND when no stack exists | Test uses a zero-quantity mocked stack to exercise the specified INSUFFICIENT_QUANTITY path without changing the Task 1.6 helper contract |
| 2.7  | Top-level throws list says NEEDS_WATER should throw PLOT_NOT_READY, but Step 2 requires PLOT_EMPTY | Followed Step 2 exact error string: PLOT_EMPTY |
| 2.8  | Max V1 fertiliser, skill 10, and 3 waterings do not drive Normal below 1%, so floor behavior is not observable under only V1 max boosts | Implemented floor exactly and tested V1 max plus an out-of-range boost case for the floor branch |
| 3.1  | Prompt says value is a JSON-encoded AnimalConfig but sample seed JSON omits animalType and displayName | Seeded full AnimalConfig rows and parseAnimalConfig fills animalType/displayName from animalType when legacy rows omit them |
| 3.2  | collectAnimalProduce hardcodes 0.15 for egg feather side drops, but AnimalProduct also defines dropChance in animal config | Used animal_feather dropChance from animal config when present, with 0.15 fallback |
| 3.3  | Junk items are specified as a literal list, not a game_config key | Used the specified literal list `junk_boot`, `junk_net`, `junk_crate` with equal weight |

---

## ACTIVE STUBS
<!-- Functions deployed but not yet fully implemented. Replace by listed task. -->

| Stub Function           | Lives In          | Replace In | Behaviour Until Replaced       |
|-------------------------|-------------------|------------|--------------------------------|
| isMutualFriend          | water-plot        | Task 7.1 ← THIS TASK | Stub — replace by importing from friends/index.ts |
| incrementDailyHelpActions | water-plot      | Task 7.3   | Always succeeds                |
| awardXP                 | water-plot        | Task 10.1  | Logs but does not write        |
| sendNotification        | water-plot        | Task 12.1  | Logs but does not send         |
| awardXP                 | harvest-plot      | Task 10.1  | Logs but does not write        |
| awardSkillXP            | harvest-plot      | Task 10.2  | Logs but does not write        |
| isMutualFriend          | animals           | Task 7.1 ← THIS TASK | Stub — replace by importing from friends/index.ts |
| isMutualFriend          | steal             | Task 7.1 ← THIS TASK | Stub — replace by importing from friends/index.ts |
| incrementDailyHelpActions | animals         | Task 7.3   | Always succeeds                |
| awardXP                 | animals           | Task 10.1  | Logs but does not write        |
| awardSkillXP            | animals           | Task 10.2  | Logs but does not write        |
| sendNotification        | animals           | Task 12.1  | Logs but does not send         |
| awardXP                 | traps             | Task 10.1  | Logs but does not write        |
| awardSkillXP            | traps             | Task 10.2  | Logs but does not write        |
| awardXP                 | fishing           | Task 10.1  | Logs but does not write        |
| awardSkillXP            | fishing           | Task 10.2  | Logs but does not write        |
| sendNotification        | fishing           | Task 12.1  | Logs but does not send         |
| hasFoxPet               | steal             | Task 11.2  | Always false                   |

---

## GAME_CONFIG KEYS SEEDED
<!-- Track what is actually in the DB so Cursor doesn't re-seed or mis-reference. -->
<!-- Status: SEEDED | PENDING -->

| Key                                    | Value   | Status  |
|----------------------------------------|---------|---------|
| STEAL_WINDOW_SECONDS                   | 60      | SEEDED  |
| STEAL_POOL_PERCENT                     | 0.40    | SEEDED  |
| STRANGER_DAILY_STEAL_LIMIT             | 3       | SEEDED  |
| STEAL_COST_NORMAL                      | 15      | SEEDED  |
| STEAL_COST_BRONZE                      | 30      | SEEDED  |
| STEAL_COST_SILVER                      | 60      | SEEDED  |
| STEAL_COST_GOLD                        | 120     | SEEDED  |
| STEAL_COST_DIAMOND                     | 300     | SEEDED  |
| STEAL_COST_LEGENDARY                   | 1000    | SEEDED  |
| STEAL_UNITS_MIN                        | 1       | SEEDED  |
| STEAL_UNITS_MAX                        | 2       | SEEDED  |
| NEW_PLAYER_PROTECTION_LEVEL            | 5       | SEEDED  |
| GRADE_NORMAL_RATE                      | 0.58    | SEEDED  |
| GRADE_BRONZE_RATE                      | 0.25    | SEEDED  |
| GRADE_SILVER_RATE                      | 0.12    | SEEDED  |
| GRADE_GOLD_RATE                        | 0.04    | SEEDED  |
| GRADE_DIAMOND_RATE                     | 0.01    | SEEDED  |
| GRADE_LEGENDARY_RATE                   | 0.001   | SEEDED  |
| OFFLINE_CAP_SECONDS                    | 57600   | SEEDED  |
| PEST_SPAWN_CHANCE                      | 0.10    | SEEDED  |
| WEED_TIMER_PENALTY_MULTIPLIER          | 1.25    | SEEDED  |
| BUG_YIELD_PENALTY                      | 0.50    | SEEDED  |
| WATER_REDUCTION_PERCENT                | 0.15    | SEEDED  |
| MAX_WATERINGS_PER_CYCLE                | 3       | SEEDED  |
| WITHER_YIELD_MULTIPLIER                | 0.50    | SEEDED  |
| WITHER_TIME_MULTIPLIER                 | 2.0     | SEEDED  |
| FERTILISER_BRONZE_BOOST                | 0.02    | SEEDED  |
| FERTILISER_SILVER_BOOST                | 0.01    | SEEDED  |
| FRIEND_FERTILISER_BRONZE_BOOST         | 0.02    | SEEDED  |
| FRIEND_FERTILISER_SILVER_BOOST         | 0.01    | SEEDED  |
| MAX_FERTILISER_BRONZE_BOOST            | 0.04    | SEEDED  |
| MAX_FERTILISER_SILVER_BOOST            | 0.02    | SEEDED  |
| RESTAURANT_MULTIPLIER_MAX              | 1.5     | SEEDED  |
| RESTAURANT_MULTIPLIER_BUILDUP_SECONDS  | 14400   | SEEDED  |
| FAVOURED_DISH_BONUS                    | 1.30    | SEEDED  |
| PET_FEED_DURATION_SECONDS              | 43200   | SEEDED  |
| PET_FOOD_COST                          | 10      | SEEDED  |
| PET_STEAL_BLOCK_CHANCE                 | 0.25    | SEEDED  |
| PET_RESTAURANT_BONUS                   | 0.10    | SEEDED  |
| PET_YIELD_BONUS                        | 0.10    | SEEDED  |
| PET_XP_BONUS                           | 0.15    | SEEDED  |
| STARTER_COINS                          | 500     | SEEDED  |
| SUNDAY_MARKET_FEE                      | 10000   | SEEDED  |
| SUNDAY_MARKET_STALL_SIZE               | 5       | SEEDED  |
| LOTTERY_MIN_ENTRY                      | 100     | SEEDED  |
| LOTTERY_DIMINISHING_RETURNS_THRESHOLD  | 10000   | SEEDED  |
| NOTIFICATION_BATCH_WINDOW_SECONDS      | 1800    | SEEDED  |
| crop_lettuce                           | {...}   | SEEDED  |
| crop_tomato                            | {...}   | SEEDED  |
| crop_cucumber                          | {...}   | SEEDED  |
| crop_onion                             | {...}   | SEEDED  |
| crop_wheat                             | {...}   | SEEDED  |
| crop_potato                            | {...}   | SEEDED  |
| crop_jalapeno                          | {...}   | SEEDED  |
| crop_sesame                            | {...}   | SEEDED  |
| crop_strawberry                        | {...}   | SEEDED  |
| crop_blueberry                         | {...}   | SEEDED  |
| crop_herb                              | {...}   | SEEDED  |
| animal_cow                             | {...}   | SEEDED  |
| animal_chicken                         | {...}   | SEEDED  |
| trap_wooden_trap                       | {...}   | SEEDED  |
| trap_wire_trap                         | {...}   | SEEDED  |
| trap_deep_trap                         | {...}   | SEEDED  |
| TRAP_WORN_CHANCE                       | 0.10    | SEEDED  |
| TRAP_JUNK_CHANCE                       | 0.05    | SEEDED  |
| TRAP_GRADE_NORMAL                      | 0.65    | SEEDED  |
| TRAP_GRADE_BRONZE                      | 0.25    | SEEDED  |
| TRAP_GRADE_SILVER                      | 0.08    | SEEDED  |
| TRAP_GRADE_GOLD                        | 0.02    | SEEDED  |
| TRAP_GRADE_DIAMOND                     | 0.001   | SEEDED  |
| TRAP_WORN_NORMAL                       | 0.85    | SEEDED  |
| TRAP_WORN_BRONZE                       | 0.12    | SEEDED  |
| TRAP_WORN_SILVER                       | 0.03    | SEEDED  |
| FISHING_PROGRESS_DURATION              | {...}   | SEEDED  |
| FISHING_SESSION_EXPIRY_SECONDS         | 300     | SEEDED  |
| LEGENDARY_CHANCE_SPECIAL               | 0.0002  | SEEDED  |
| fishing_pool_bait_basic                | [...]   | SEEDED  |
| fishing_pool_bait_fly                  | [...]   | SEEDED  |
| fishing_pool_bait_special              | [...]   | SEEDED  |
| recipe_bun                             | {...}   | SEEDED  |
| recipe_cheese                          | {...}   | SEEDED  |
| recipe_pickles                         | {...}   | SEEDED  |
| recipe_bacon                           | {...}   | SEEDED  |
| recipe_ketchup                         | {...}   | SEEDED  |
| recipe_mayo                            | {...}   | SEEDED  |
| recipe_fries                           | {...}   | SEEDED  |
| recipe_onion_rings                     | {...}   | SEEDED  |
| recipe_fly_bait                        | {...}   | SEEDED  |
| recipe_special_bait                    | {...}   | SEEDED  |
| recipe_recycle_boot                    | {...}   | SEEDED  |
| recipe_recycle_net                     | {...}   | SEEDED  |
| recipe_recycle_crate                   | {...}   | SEEDED  |
| recipe_recycle_mixed                   | {...}   | SEEDED  |
| CRATE_RANDOM_LOOT                      | [...]   | SEEDED  |
| recipe_classic_burger                  | {...}   | SEEDED  |
| recipe_cheeseburger                    | {...}   | SEEDED  |
| recipe_egg_burger                      | {...}   | SEEDED  |
| recipe_bacon_burger                    | {...}   | SEEDED  |
| recipe_fish_fillet                     | {...}   | SEEDED  |
| recipe_spicy_burger                    | {...}   | SEEDED  |
| recipe_shrimp_burger                   | {...}   | SEEDED  |
| recipe_crab_burger                     | {...}   | SEEDED  |
| recipe_tuna_melt                       | {...}   | SEEDED  |
| recipe_fries_dish                      | {...}   | SEEDED  |
| recipe_onion_rings_dish                | {...}   | SEEDED  |
| recipe_strawberry_milkshake            | {...}   | SEEDED  |
| COOKING_XP_BY_TIER                     | {...}   | SEEDED  |
| RESTAURANT_TIER_SLOT_LIMITS            | {1:3,2:5,3:8,4:12,5:16} | SEEDED  |
| RESTAURANT_BASE_CUSTOMERS_RATE         | {...}   | SEEDED  |
| DISH_DEMAND_WEIGHT                     | {...}   | SEEDED  |
| staff_head_chef                        | {...}   | SEEDED  |
| staff_maitre_d                         | {...}   | SEEDED  |
| staff_promoter                         | {...}   | SEEDED  |
| staff_cleaner                          | {...}   | SEEDED  |
| staff_guard                            | {...}   | SEEDED  |

---

## HOW TO USE THIS FILE

1. Paste this entire file at the top of your Cursor prompt, before the task block.
2. After a task completes and all Done When criteria pass:
   - Change the CURRENT TASK block to the next task.
   - Flip the relevant Status fields from PENDING → COMPLETE (or STUBBED).
   - Add any SPEC_AMBIGUITY resolutions to the table.
   - Note any deviations from the PRD.
3. Never delete rows — change status instead. Cursor needs to know what exists.
4. Keep the interfaces section frozen unless a task explicitly changes a data shape.
