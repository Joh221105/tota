# CODEBASE_STATE.md — Town & Table
# Paste this file at the TOP of every Cursor prompt, before the task block.
# Update the relevant rows after each task completes.
# Do not add narrative. Keep entries terse.

---

## CURRENT TASK
<!-- Update this before starting each session -->
Task: [1.2] — [Auth: loginOrCreate, getPlayerProfile, TownAndTableAuth.swift]
Status: COMPLETE

Deliverables:
- [x] supabase/migrations/004_add_neighbour_score.sql — ALTER TABLE players ADD COLUMN neighbour_score INTEGER NOT NULL DEFAULT 50
- [x] supabase/functions/login-or-create/index.ts — loginOrCreate(deviceId, platform): LoginResult
- [x] supabase/functions/get-player-profile/index.ts — getPlayerProfile(playerId): PublicPlayerProfile
- [x] TownAndTableAuth.swift — loginOnLaunch(), Keychain session storage
- [x] Test file (T1.2.1–T1.2.13) with mocked Supabase + mocked auth.admin

Done When:
- T1.2.1–T1.2.13 all pass
- getPlayerProfile NEVER selects coins, inventory, or timestamps
- neighbour_score column exists in migration and is read in getPlayerProfile
- Error strings match exactly (INVALID_DEVICE_ID, INVALID_PLATFORM, PLAYER_NOT_FOUND:id)

RESOLVED SPEC_AMBIGUITY from prompt:
- neighbour_score column not defined → ADD to players table: neighbour_score INTEGER NOT NULL DEFAULT 50
  getPlayerProfile must SELECT neighbour_score and return it (NOT hardcode 0)

KEY IMPLEMENTATION NOTES:
- Auth email pattern: `${deviceId}@device.local`, password: deviceId
- PUBLIC_COLUMNS must NOT include coins, inventory_slots, farm_plots, created_at, updated_at
- PUBLIC_COLUMNS = 'id, display_name, level, michelin_stars, neighbour_score, equipped_pet, restaurant, thief_stats'
- calculateNeighbourScoreTier: >=80 PILLAR, >=40 REGULAR, >=15 FOX, else OUTLAW
- loginOrCreate calls initialiseNewPlayer (from lib or import) for new players

---

## PREVIOUS TASK (1.1 — COMPLETE)
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
| 002_rpc_debit_coins.sql     | PENDING | debit_coins() Postgres function       |
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
| 1.3  | debitCoins                 | supabase/functions/lib/economy.ts              | PENDING | Calls debit_coins() RPC. ONLY coins decrement path. |
| 1.4  | creditCoins                | supabase/functions/lib/economy.ts              | PENDING | Calls credit_coins() RPC. ONLY coins increment path. |
| 1.5  | getBalance                 | supabase/functions/lib/economy.ts              | PENDING | READ-ONLY. SELECT coins FROM players.           |
| 1.5  | validateCanAfford          | supabase/functions/lib/economy.ts              | PENDING | READ-ONLY. Returns {canAfford, balance, required}. |
| 1.6  | addItemToInventory         | supabase/functions/lib/inventory.ts            | PENDING | UPSERT on inventory table. Enforces slot limits. |
| 1.6  | removeItemFromInventory    | supabase/functions/lib/inventory.ts            | PENDING | Deletes row if quantity hits 0.                 |
| 1.6  | getInventory               | supabase/functions/lib/inventory.ts            | PENDING | Returns all or one category.                    |
| 1.7  | expandInventory            | supabase/functions/expand-inventory/index.ts   | PENDING | Consumes material, updates inventory_slots JSONB. |
| 2.1  | getCropConfig              | supabase/functions/lib/crops.ts                | PENDING | Reads game_config table. Throws CROP_NOT_FOUND. |
| 2.1  | getAllCropConfigs           | supabase/functions/lib/crops.ts                | PENDING | Batch fetch all 11 Phase 1 crops.               |
| 2.2  | plantCrop                  | supabase/functions/plant-crop/index.ts         | PENDING | Writes to farm_plots JSONB array.               |
| 2.3  | calculatePlotState         | supabase/functions/lib/farm.ts                 | PENDING | PURE FUNCTION. Zero DB calls. Pass consts in.   |
| 2.4  | getFarmState               | supabase/functions/get-farm-state/index.ts     | PENDING | Max 2 DB queries. Returns EnrichedPlot[].       |
| 2.5  | waterPlot                  | supabase/functions/water-plot/index.ts         | PENDING | Moves plantedAt backwards. Contains STUBs (7.1).|

---

## HELPER MODULES
<!-- Shared libs used by multiple Edge Functions -->

| File                              | Status  | Exports                                          |
|-----------------------------------|---------|--------------------------------------------------|
| supabase/functions/lib/config.ts  | COMPLETE | getConfig(key), getConfigs(keys[])               |
| supabase/functions/lib/economy.ts | PENDING | debitCoins, creditCoins, getBalance, validateCanAfford |
| supabase/functions/lib/inventory.ts | PENDING | addItemToInventory, removeItemFromInventory, getInventory, getCategory |
| supabase/functions/lib/crops.ts   | PENDING | getCropConfig, getAllCropConfigs, parseCropConfig |
| supabase/functions/lib/farm.ts    | PENDING | calculatePlotState, PlotConstants, FarmPlot, PlotStateResult |
| supabase/functions/lib/supabase.ts | COMPLETE | supabaseAdmin (service_role client)              |

---

## SWIFT CLIENT FILES
<!-- Status: COMPLETE | STUBBED | PENDING -->

| File                        | Status  | Notes                                            |
|-----------------------------|---------|--------------------------------------------------|
| TownAndTableAuth.swift      | COMPLETE | loginOnLaunch(). deviceId = identifierForVendor. Stores sessionToken in Keychain. |
| FarmViewModel.swift         | PENDING | loadFarm(playerId:). Calls get-farm-state.       |

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
| PLOT_NOT_FOUND:{plotId}                   | plantCrop, waterPlot       |
| PLOT_OCCUPIED:{plotId}                    | plantCrop                  |
| CROP_NOT_UNLOCKED:{cropId}                | plantCrop                  |
| PLOT_NOT_GROWING:{state}                  | waterPlot                  |
| MAX_WATERINGS_REACHED                     | waterPlot                  |
| NOT_FRIENDS                               | waterPlot                  |
| HELP_ACTIONS_EXHAUSTED                    | waterPlot                  |

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
| —    | —         | —          |

---

## ACTIVE STUBS
<!-- Functions deployed but not yet fully implemented. Replace by listed task. -->

| Stub Function           | Lives In          | Replace In | Behaviour Until Replaced       |
|-------------------------|-------------------|------------|--------------------------------|
| isMutualFriend          | water-plot        | Task 7.1   | Always returns true            |
| incrementDailyHelpActions | water-plot      | Task 7.1   | Always succeeds                |
| awardXP                 | water-plot        | Task 10.1  | Logs but does not write        |
| sendNotification        | water-plot        | Task 12.1  | Logs but does not send         |

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
