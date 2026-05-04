# CODEBASE_STATE.md — Town & Table
# Paste this file at the TOP of every Cursor prompt, before the task block.
# Update the relevant rows after each task completes.
# Do not add narrative. Keep entries terse.

---

## CURRENT TASK
<!-- Update this before starting each session -->
Task: [2.7] — [Farm: harvestPlot, harvest-plot/index.ts]
Status: COMPLETE

Deliverables:
- [x] supabase/functions/harvest-plot/index.ts — harvestPlot Edge Function
- [x] supabase/functions/harvest-plot/index_test.ts — test file with mocked Supabase client

Done When:
- T2.7.1–T2.7.14 all pass
- Harvest adds available yield to inventory by rolled grade
- Steal pool, wither penalty, bug penalty, and minimum 1 yield enforced
- GROWING throws PLOT_NOT_READY; EMPTY throws PLOT_EMPTY
- Annual crops reset to EMPTY; perpetual crops transition to needsWater:true and keep cropId
- Harvest awards crop XP and farming skill XP
- INVENTORY_FULL is captured in itemsFailedDueToFullInventory without aborting harvest

KEY IMPLEMENTATION NOTES:
- Loads farm_plots and skills from players.
- Fetches crop config and harvest constants via getConfigs.
- rollGrade is a Task 2.8 stub returning Normal by default.
- Adds harvested crops through addItemToInventory only.
- Captures INVENTORY_FULL failures per grade and continues.
- Returns HarvestResult: { success, itemsHarvested, itemsFailedDueToFullInventory, xpAwarded, yieldPenalties, plotTransition }.

TEST CASES SUMMARY:
- T2.7.1: Clean harvest, no steal — 7 units added, plotTransition EMPTY
- T2.7.2: Partial steal taken — 5 units added
- T2.7.3: Full pool stolen — 4 units added
- T2.7.4: Withered penalty — 4 units
- T2.7.5: Bug penalty — 4 units
- T2.7.6: Both penalties — 2 units
- T2.7.7: Minimum 1 — 1 unit
- T2.7.8: Harvest GROWING — throws PLOT_NOT_READY
- T2.7.9: Harvest EMPTY — throws PLOT_EMPTY
- T2.7.10: Annual resets — cropId:null, state EMPTY
- T2.7.11: Perpetual transitions — needsWater:true, cropId kept
- T2.7.12: Tier-1 XP — 10 XP + 10 farming skill XP
- T2.7.13: Tier-3 XP — 30 XP + 30 farming skill XP
- T2.7.14: Inventory full partial — one grade added, one grade in itemsFailed list

---

## PREVIOUS TASKS

### Task 2.7 — COMPLETE
Task: [2.7] — [Farm: harvestPlot, harvest-plot/index.ts]
Deliverables all complete. T2.7.1–T2.7.14 pass.
harvestPlot calculates stolen/penalized yield, adds inventory through helper, awards XP stubs, and resets annual/perpetual plots.
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
| players             | PENDING | Main player row. JSONB cols: farm_plots, skills, inventory_slots, restaurant, etc. neighbour_score INTEGER NOT NULL DEFAULT 50 (resolved ambiguity 1.2). |
| inventory           | PENDING | One row per (player_id, item_id, grade). UNIQUE constraint on all three. |
| coin_transactions   | PENDING | Audit log. idempotency_key UNIQUE constraint.      |
| game_config         | PENDING | key TEXT PK, value TEXT (JSON-encoded).            |

---

## MIGRATIONS
<!-- List SQL migration files in order. Status: APPLIED | PENDING -->

| File                        | Status  | Contents                              |
|-----------------------------|---------|---------------------------------------|
| 001_initial_schema.sql      | PENDING | All tables + RLS policies             |
| 005_rpc_debit_coins.sql     | PENDING | debit_coins() Postgres function (SELECT FOR UPDATE, UPDATE players, INSERT coin_transactions) |
| 003_rpc_credit_coins.sql    | PENDING | credit_coins() Postgres function      |
| 004_add_neighbour_score.sql | PENDING | ALTER TABLE players ADD COLUMN neighbour_score INTEGER NOT NULL DEFAULT 50 |
| seed_game_config.sql        | PENDING | All balance constants + 11 crop configs |

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
| 2.7  | harvestPlot                | supabase/functions/harvest-plot/index.ts       | COMPLETE | Harvests yield, awards XP, resets/updates plot. Contains STUBs (2.8, 10.1, 10.2). |

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

---

## ACTIVE STUBS
<!-- Functions deployed but not yet fully implemented. Replace by listed task. -->

| Stub Function           | Lives In          | Replace In | Behaviour Until Replaced       |
|-------------------------|-------------------|------------|--------------------------------|
| isMutualFriend          | water-plot        | Task 7.1   | Always returns true            |
| incrementDailyHelpActions | water-plot      | Task 7.1   | Always succeeds                |
| awardXP                 | water-plot        | Task 10.1  | Logs but does not write        |
| sendNotification        | water-plot        | Task 12.1  | Logs but does not send         |
| rollGrade               | harvest-plot      | Task 2.8   | Returns Normal                 |
| awardXP                 | harvest-plot      | Task 10.1  | Logs but does not write        |
| awardSkillXP            | harvest-plot      | Task 10.2  | Logs but does not write        |

---

## GAME_CONFIG KEYS SEEDED
<!-- Track what is actually in the DB so Cursor doesn't re-seed or mis-reference. -->
<!-- Status: SEEDED | PENDING -->

| Key                                    | Value   | Status  |
|----------------------------------------|---------|---------|
| STEAL_WINDOW_SECONDS                   | 60      | PENDING |
| STEAL_POOL_PERCENT                     | 0.40    | PENDING |
| STRANGER_DAILY_STEAL_LIMIT             | 3       | PENDING |
| STEAL_COST_NORMAL                      | 15      | PENDING |
| STEAL_COST_BRONZE                      | 30      | PENDING |
| STEAL_COST_SILVER                      | 60      | PENDING |
| STEAL_COST_GOLD                        | 120     | PENDING |
| STEAL_COST_DIAMOND                     | 300     | PENDING |
| STEAL_COST_LEGENDARY                   | 1000    | PENDING |
| STEAL_UNITS_MIN                        | 1       | PENDING |
| STEAL_UNITS_MAX                        | 2       | PENDING |
| NEW_PLAYER_PROTECTION_LEVEL            | 5       | PENDING |
| GRADE_NORMAL_RATE                      | 0.58    | PENDING |
| GRADE_BRONZE_RATE                      | 0.25    | PENDING |
| GRADE_SILVER_RATE                      | 0.12    | PENDING |
| GRADE_GOLD_RATE                        | 0.04    | PENDING |
| GRADE_DIAMOND_RATE                     | 0.01    | PENDING |
| GRADE_LEGENDARY_RATE                   | 0.001   | PENDING |
| OFFLINE_CAP_SECONDS                    | 57600   | PENDING |
| PEST_SPAWN_CHANCE                      | 0.10    | PENDING |
| WEED_TIMER_PENALTY_MULTIPLIER          | 1.25    | PENDING |
| BUG_YIELD_PENALTY                      | 0.50    | PENDING |
| WATER_REDUCTION_PERCENT                | 0.15    | PENDING |
| MAX_WATERINGS_PER_CYCLE                | 3       | PENDING |
| WITHER_YIELD_MULTIPLIER                | 0.50    | PENDING |
| WITHER_TIME_MULTIPLIER                 | 2.0     | PENDING |
| FERTILISER_BRONZE_BOOST                | 0.02    | PENDING |
| FERTILISER_SILVER_BOOST                | 0.01    | PENDING |
| FRIEND_FERTILISER_BRONZE_BOOST         | 0.02    | PENDING |
| FRIEND_FERTILISER_SILVER_BOOST         | 0.01    | PENDING |
| MAX_FERTILISER_BRONZE_BOOST            | 0.04    | PENDING |
| MAX_FERTILISER_SILVER_BOOST            | 0.02    | PENDING |
| RESTAURANT_MULTIPLIER_MAX              | 1.5     | PENDING |
| RESTAURANT_MULTIPLIER_BUILDUP_SECONDS  | 14400   | PENDING |
| FAVOURED_DISH_BONUS                    | 1.30    | PENDING |
| PET_FEED_DURATION_SECONDS              | 43200   | PENDING |
| PET_FOOD_COST                          | 10      | PENDING |
| PET_STEAL_BLOCK_CHANCE                 | 0.25    | PENDING |
| PET_RESTAURANT_BONUS                   | 0.10    | PENDING |
| PET_YIELD_BONUS                        | 0.10    | PENDING |
| PET_XP_BONUS                           | 0.15    | PENDING |
| STARTER_COINS                          | 500     | PENDING |
| SUNDAY_MARKET_FEE                      | 10000   | PENDING |
| SUNDAY_MARKET_STALL_SIZE               | 5       | PENDING |
| LOTTERY_MIN_ENTRY                      | 100     | PENDING |
| LOTTERY_DIMINISHING_RETURNS_THRESHOLD  | 10000   | PENDING |
| NOTIFICATION_BATCH_WINDOW_SECONDS      | 1800    | PENDING |
| crop_lettuce                           | {...}   | PENDING |
| crop_tomato                            | {...}   | PENDING |
| crop_cucumber                          | {...}   | PENDING |
| crop_onion                             | {...}   | PENDING |
| crop_wheat                             | {...}   | PENDING |
| crop_potato                            | {...}   | PENDING |
| crop_jalapeno                          | {...}   | PENDING |
| crop_sesame                            | {...}   | PENDING |
| crop_strawberry                        | {...}   | PENDING |
| crop_blueberry                         | {...}   | PENDING |
| crop_herb                              | {...}   | PENDING |

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
