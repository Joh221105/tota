import {
  calculateStaffBonuses,
  calculateTimeMultiplier,
  collectRestaurantEarnings,
  getFavouredDish,
  getRestaurantState,
  getRestaurantStubCallsForTesting,
  hireStaff,
  listDishOnMenu,
  type MenuListing,
  resetRestaurantStubsForTesting,
  type RestaurantJson,
  type RestaurantStaffMember,
  unlistDishFromMenu,
  upgradeStaff,
} from "./index.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";

type TableName = "players" | "game_config" | "inventory" | "coin_transactions";

interface PlayerRow {
  id: string;
  coins: number;
  restaurant: RestaurantJson;
  inventory_slots: Record<string, number>;
}

interface GameConfigRow {
  key: string;
  value: string;
}

interface InventoryRow {
  id: string;
  player_id: string;
  item_id: string;
  grade: string;
  quantity: number;
  category: string;
}

interface CoinTransactionRow {
  id: string;
  player_id: string;
  amount: number;
  transaction_type: string;
  idempotency_key: string;
  metadata: Record<string, unknown>;
  balance_before: number;
  balance_after: number;
}

interface MockDatabase {
  players: PlayerRow[];
  game_config: GameConfigRow[];
  inventory: InventoryRow[];
  coin_transactions: CoinTransactionRow[];
}

const NOW = 1_000_000;
const PLAYER_ID = "player-001";
const BASE_CONFIGS: Record<string, unknown> = {
  OFFLINE_CAP_SECONDS: 57_600,
  RESTAURANT_MULTIPLIER_MAX: 1.5,
  RESTAURANT_MULTIPLIER_BUILDUP_SECONDS: 14_400,
  RESTAURANT_TIER_SLOT_LIMITS: { 1: 3, 2: 5, 3: 8, 4: 12, 5: 16 },
  RESTAURANT_BASE_CUSTOMERS_RATE: {
    1: 0.0003,
    2: 0.0008,
    3: 0.0015,
    4: 0.0025,
    5: 0.004,
  },
  DISH_DEMAND_WEIGHT: {
    dish_classic_burger: 0.20,
    dish_cheeseburger: 0.18,
    dish_egg_burger: 0.10,
    dish_bacon_burger: 0.15,
    dish_fish_fillet: 0.10,
    dish_spicy_burger: 0.08,
    dish_shrimp_burger: 0.08,
    dish_crab_burger: 0.05,
    dish_tuna_melt: 0.05,
    dish_fries: 0.50,
    dish_onion_rings: 0.30,
    dish_onion_rings_dish: 0.30,
    dish_strawberry_milkshake: 0.20,
  },
  FAVOURED_DISH_BONUS: 1.30,
  recipe_classic_burger: { goldValue: 80 },
  recipe_cheeseburger: { goldValue: 120 },
  recipe_egg_burger: { goldValue: 100 },
  recipe_bacon_burger: { goldValue: 160 },
  recipe_fish_fillet: { goldValue: 140 },
  recipe_spicy_burger: { goldValue: 170 },
  recipe_shrimp_burger: { goldValue: 155 },
  recipe_crab_burger: { goldValue: 220 },
  recipe_tuna_melt: { goldValue: 240 },
  recipe_fries_dish: { goldValue: 50 },
  recipe_onion_rings_dish: { goldValue: 60 },
  recipe_strawberry_milkshake: { goldValue: 90 },
  staff_head_chef: {
    hireCost: 500,
    tiers: [
      { t: 1, bonus: "revenue+15%", revMult: 1.15 },
      { t: 2, bonus: "revenue+25%", revMult: 1.25, upgCost: 1500 },
      { t: 3, bonus: "revenue+40%", revMult: 1.40, upgCost: 4000 },
    ],
  },
  staff_maitre_d: {
    hireCost: 400,
    tiers: [
      { t: 1, custMult: 1.20 },
      { t: 2, custMult: 1.20, special: "vip_events", upgCost: 1200 },
    ],
  },
  staff_promoter: {
    hireCost: 300,
    tiers: [
      { t: 1, repDecayReduce: 0.50 },
      { t: 2, repGainMult: 2.0, upgCost: 900 },
    ],
  },
  staff_cleaner: {
    hireCost: 200,
    tiers: [
      { t: 1, preventsDecorDecay: true },
      { t: 2, passiveDecorGain: 1, upgCost: 600 },
    ],
  },
  staff_guard: {
    hireCost: 600,
    tiers: [
      { t: 1, stealReduc: 0.30, alerts: false },
      { t: 2, stealReduc: 0.50, alerts: true, upgCost: 2000 },
    ],
  },
};

/**
 * Asserts equality by JSON representation.
 * @param actual - Actual value.
 * @param expected - Expected value.
 * @param message - Failure message.
 * @returns Nothing.
 * @throws Error when values differ.
 */
function assertEquals(
  actual: unknown,
  expected: unknown,
  message: string,
): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

/**
 * Asserts a number falls inside an inclusive range.
 * @param actual - Actual numeric value.
 * @param min - Inclusive minimum.
 * @param max - Inclusive maximum.
 * @param message - Failure message.
 * @returns Nothing.
 * @throws Error when value is out of range.
 */
function assertBetween(
  actual: number,
  min: number,
  max: number,
  message: string,
): void {
  if (actual < min || actual > max) {
    throw new Error(`${message}: expected ${min}-${max}, got ${actual}`);
  }
}

/**
 * Asserts an async action rejects with an exact message.
 * @param action - Action expected to reject.
 * @param expectedMessage - Exact expected error message.
 * @returns Nothing.
 * @throws Error when the action does not reject as expected.
 */
async function assertRejectsWithMessage(
  action: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assertEquals(message, expectedMessage, "error message");
    return;
  }
  throw new Error(`Expected rejection with ${expectedMessage}`);
}

/**
 * Creates a deep copy of a JSON-compatible value.
 * @param value - Value to clone.
 * @returns Cloned value.
 * @throws Never.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Builds a menu listing fixture.
 * @param dishId - Dish item ID.
 * @param grade - Dish grade.
 * @param quantity - Listed quantity.
 * @returns Menu listing.
 * @throws Never.
 */
function listing(
  dishId: string,
  grade = "Normal",
  quantity = 1,
): MenuListing {
  return { dishId, grade, quantity, listedAt: NOW - 500 };
}

/**
 * Builds a restaurant fixture.
 * @param overrides - Optional restaurant overrides.
 * @returns Restaurant JSON state.
 * @throws Never.
 */
function restaurant(
  overrides: Partial<RestaurantJson> = {},
): RestaurantJson {
  return {
    tier: 1,
    listings: [],
    staff: [],
    lastCollectionTimestamp: NOW - 10_000,
    openedAt: NOW - 10_000,
    menuLastChangedAt: NOW - 10_000,
    reputation: 0,
    decorScore: 0,
    ...clone(overrides),
  };
}

/**
 * Creates an inventory row fixture.
 * @param itemId - Item ID.
 * @param grade - Item grade.
 * @param quantity - Quantity.
 * @returns Inventory row.
 * @throws Never.
 */
function inv(itemId: string, grade: string, quantity: number): InventoryRow {
  return {
    id: `inv-${itemId}-${grade}`,
    player_id: PLAYER_ID,
    item_id: itemId,
    grade,
    quantity,
    category: itemId.startsWith("dish_") ? "cooked_dishes" : "tools",
  };
}

/**
 * Builds a mock database for restaurant tests.
 * @param overrides - Optional player, inventory, and config overrides.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(overrides: {
  player?: Partial<PlayerRow>;
  restaurant?: Partial<RestaurantJson>;
  inventory?: InventoryRow[];
  gameConfig?: Record<string, unknown>;
} = {}): MockDatabase {
  const configMap = new Map<string, string>();
  for (const [key, value] of Object.entries(BASE_CONFIGS)) {
    configMap.set(key, JSON.stringify(value));
  }
  for (const [key, value] of Object.entries(overrides.gameConfig ?? {})) {
    configMap.set(key, JSON.stringify(value));
  }

  return {
    players: [{
      id: PLAYER_ID,
      coins: 0,
      restaurant: restaurant(overrides.restaurant),
      inventory_slots: {
        crops: 5000,
        fish: 5000,
        animal_produce: 5000,
        processed: 5000,
        cooked_dishes: 5000,
        tools: 5000,
      },
      ...clone(overrides.player ?? {}),
    }],
    game_config: [...configMap.entries()].map(([key, value]) => ({
      key,
      value,
    })),
    inventory: clone(overrides.inventory ?? []),
    coin_transactions: [],
  };
}

/**
 * Runs an action with Date.now mocked to a unix-second value.
 * @param now - Mock unix seconds.
 * @param action - Action to run while time is mocked.
 * @returns Action result.
 * @throws Any error thrown by action.
 */
async function withMockedNow<T>(
  now: number,
  action: () => Promise<T>,
): Promise<T> {
  const originalNow = Date.now;
  Object.defineProperty(Date, "now", {
    value: () => now * 1000,
    configurable: true,
  });
  try {
    return await action();
  } finally {
    Object.defineProperty(Date, "now", {
      value: originalNow,
      configurable: true,
    });
  }
}

class MockSupabaseClient {
  readonly database: MockDatabase;

  /**
   * Creates a mock Supabase client.
   * @param database - In-memory database.
   * @returns Mock Supabase client.
   * @throws Never.
   */
  constructor(database: MockDatabase) {
    this.database = database;
  }

  /**
   * Starts a query against a mock table.
   * @param table - Table name.
   * @returns Mock query builder.
   * @throws Never.
   */
  from(table: string): MockQueryBuilder {
    return new MockQueryBuilder(this.database, table as TableName);
  }

  /**
   * Handles mocked Supabase RPC calls.
   * @param functionName - RPC function name.
   * @param params - RPC parameters.
   * @returns Mock RPC result.
   * @throws Never.
   */
  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<{ data: unknown; error: null }> {
    if (functionName !== "credit_coins" && functionName !== "debit_coins") {
      return Promise.resolve({ data: null, error: null });
    }

    const player = this.database.players.find((row) =>
      row.id === params.p_player_id
    );
    if (!player) return Promise.resolve({ data: null, error: null });

    const amount = Number(params.p_amount);
    const balanceBefore = player.coins;
    player.coins += functionName === "credit_coins" ? amount : -amount;
    const transaction = {
      id: `tx-${this.database.coin_transactions.length + 1}`,
      player_id: String(params.p_player_id),
      amount,
      transaction_type: String(params.p_transaction_type),
      idempotency_key: String(params.p_idempotency_key),
      metadata: params.p_metadata as Record<string, unknown>,
      balance_before: balanceBefore,
      balance_after: player.coins,
    };
    this.database.coin_transactions.push(transaction);

    return Promise.resolve({
      data: {
        success: true,
        transactionId: transaction.id,
        balanceBefore,
        balanceAfter: player.coins,
        idempotencyKey: transaction.idempotency_key,
      },
      error: null,
    });
  }
}

class MockQueryBuilder {
  private readonly database: MockDatabase;
  private readonly table: TableName;
  private selectedColumns = "*";
  private filters: Array<{ column: string; value: unknown }> = [];
  private inFilter: { column: string; values: unknown[] } | null = null;
  private insertValues: Record<string, unknown> | null = null;
  private updateValues: Record<string, unknown> | null = null;
  private deleteRequested = false;
  private countRequested = false;

  /**
   * Creates a query builder.
   * @param database - In-memory database.
   * @param table - Table name.
   * @returns Mock query builder.
   * @throws Never.
   */
  constructor(database: MockDatabase, table: TableName) {
    this.database = database;
    this.table = table;
  }

  /**
   * Records selected columns.
   * @param columns - Column list.
   * @param options - Optional count/head options.
   * @returns Current query builder.
   * @throws Never.
   */
  select(
    columns: string,
    options?: { count?: "exact"; head?: boolean },
  ): MockQueryBuilder {
    this.selectedColumns = columns;
    this.countRequested = options?.count === "exact";
    return this;
  }

  /**
   * Adds an equality filter.
   * @param column - Column name.
   * @param value - Expected value.
   * @returns Current query builder.
   * @throws Never.
   */
  eq(column: string, value: unknown): MockQueryBuilder {
    this.filters.push({ column, value });
    return this;
  }

  /**
   * Adds an IN filter and resolves the query.
   * @param column - Column name.
   * @param values - Accepted values.
   * @returns Query result.
   * @throws Never.
   */
  in(
    column: string,
    values: unknown[],
  ): Promise<{ data: Record<string, unknown>[]; error: null }> {
    this.inFilter = { column, values };
    return Promise.resolve({
      data: this.matchingRows().map((row) => this.projectRow(row)),
      error: null,
    });
  }

  /**
   * Records insert values.
   * @param values - Values to insert.
   * @returns Current query builder.
   * @throws Never.
   */
  insert(values: Record<string, unknown>): MockQueryBuilder {
    this.insertValues = values;
    return this;
  }

  /**
   * Records update values.
   * @param values - Values to update.
   * @returns Current query builder.
   * @throws Never.
   */
  update(values: Record<string, unknown>): MockQueryBuilder {
    this.updateValues = values;
    return this;
  }

  /**
   * Records a delete mutation.
   * @returns Current query builder.
   * @throws Never.
   */
  delete(): MockQueryBuilder {
    this.deleteRequested = true;
    return this;
  }

  /**
   * Resolves a filtered single-row query with nullable data.
   * @returns Query result with zero or one row.
   * @throws Never.
   */
  maybeSingle(): Promise<
    { data: Record<string, unknown> | null; error: null }
  > {
    const rows = this.matchingRows();
    return Promise.resolve({
      data: rows.length > 0 ? this.projectRow(rows[0]) : null,
      error: null,
    });
  }

  /**
   * Resolves a filtered single-row query.
   * @returns Query result with one row when present.
   * @throws Never.
   */
  single(): Promise<{ data: Record<string, unknown> | null; error: null }> {
    const row = this.applyMutationAndReturnRows()[0] ?? null;
    return Promise.resolve({
      data: row ? this.projectRow(row) : null,
      error: null,
    });
  }

  /**
   * Resolves await on mutation and select queries.
   * @param onfulfilled - Promise fulfillment callback.
   * @param onrejected - Promise rejection callback.
   * @returns Promise-like query result.
   * @throws Never.
   */
  then<
    TResult1 = {
      data: Record<string, unknown>[] | null;
      error: null;
      count?: number | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: Record<string, unknown>[] | null;
          error: null;
          count?: number | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const rows = this.applyMutationAndReturnRows();
    const result = {
      data: this.countRequested
        ? null
        : rows.map((row) => this.projectRow(row)),
      error: null,
      count: this.countRequested ? rows.length : null,
    };
    return Promise.resolve(result).then(onfulfilled, onrejected) as PromiseLike<
      TResult1 | TResult2
    >;
  }

  /**
   * Applies an insert, update, delete, or read and returns affected rows.
   * @returns Affected or matching rows.
   * @throws Never.
   */
  private applyMutationAndReturnRows(): Array<Record<string, unknown>> {
    if (this.insertValues) {
      const values = { ...this.insertValues };
      if (this.table === "inventory") {
        values.id = values.id ?? `inv-${this.database.inventory.length + 1}`;
        this.database.inventory.push(values as unknown as InventoryRow);
      }
      return [values];
    }

    const rows = this.matchingRows();
    if (this.updateValues) {
      for (const row of rows) Object.assign(row, clone(this.updateValues));
      return rows;
    }
    if (this.deleteRequested) {
      const tableRows = this.tableRows();
      const deleted = [...rows];
      for (const row of rows) {
        const index = tableRows.indexOf(row);
        if (index !== -1) tableRows.splice(index, 1);
      }
      return deleted;
    }
    return rows;
  }

  /**
   * Returns rows matching all filters.
   * @returns Matching rows.
   * @throws Never.
   */
  private matchingRows(): Array<Record<string, unknown>> {
    return this.tableRows().filter((row) => {
      const equal = this.filters.every((filter) =>
        String(row[filter.column]) === String(filter.value)
      );
      const inMatch = !this.inFilter ||
        this.inFilter.values.map(String).includes(
          String(row[this.inFilter.column]),
        );
      return equal && inMatch;
    });
  }

  /**
   * Returns rows for the selected table.
   * @returns Table rows.
   * @throws Never.
   */
  private tableRows(): Array<Record<string, unknown>> {
    return this.database[this.table] as unknown as Array<
      Record<string, unknown>
    >;
  }

  /**
   * Projects a row to selected columns.
   * @param row - Source row.
   * @returns Projected row.
   * @throws Never.
   */
  private projectRow(row: Record<string, unknown>): Record<string, unknown> {
    if (this.selectedColumns === "*") return clone(row);
    const projected: Record<string, unknown> = {};
    for (const rawColumn of this.selectedColumns.split(",")) {
      const column = rawColumn.trim();
      projected[column] = clone(row[column]);
    }
    return projected;
  }
}

/**
 * Installs a mock Supabase client.
 * @param database - Mock database to install.
 * @returns Installed mock database.
 * @throws Never.
 */
function installMockSupabase(database: MockDatabase): MockDatabase {
  resetRestaurantStubsForTesting();
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

Deno.test("T5.1.1 List Gold Cheeseburgers", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: [inv("dish_cheeseburger", "Gold", 5)],
  }));

  const result = await withMockedNow(
    NOW,
    () => listDishOnMenu(PLAYER_ID, "dish_cheeseburger", "Gold", 5),
  );

  assertEquals(result.success, true, "success");
  assertEquals(database.inventory.length, 0, "dish stack removed");
  assertEquals(database.players[0].restaurant.listings, [
    { dishId: "dish_cheeseburger", grade: "Gold", quantity: 5, listedAt: NOW },
  ], "restaurant listing");
});

Deno.test("T5.1.2 Tier 1 slot limit", async () => {
  installMockSupabase(buildMockDatabase({
    restaurant: {
      listings: [
        listing("dish_classic_burger"),
        listing("dish_cheeseburger"),
        listing("dish_egg_burger"),
      ],
    },
    inventory: [inv("dish_bacon_burger", "Normal", 1)],
  }));

  await assertRejectsWithMessage(
    () => listDishOnMenu(PLAYER_ID, "dish_bacon_burger", "Normal", 1),
    "MENU_FULL:3",
  );
});

Deno.test("T5.1.3 Same dishId 2 grades = 1 slot", async () => {
  installMockSupabase(buildMockDatabase({
    restaurant: {
      listings: [
        listing("dish_cheeseburger", "Normal"),
        listing("dish_cheeseburger", "Gold"),
      ],
    },
  }));

  const state = await withMockedNow(
    NOW,
    () => getRestaurantState(PLAYER_ID),
  );

  assertEquals(state.menuSlotsUsed, 1, "one dish type");
});

Deno.test("T5.1.4 Listing resets multiplier", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: [inv("dish_cheeseburger", "Gold", 5)],
  }));

  await withMockedNow(
    NOW,
    () => listDishOnMenu(PLAYER_ID, "dish_cheeseburger", "Gold", 1),
  );

  assertEquals(
    database.players[0].restaurant.menuLastChangedAt,
    NOW,
    "menu changed at now",
  );
});

Deno.test("T5.1.5 Unlist returns to inventory", async () => {
  const database = installMockSupabase(buildMockDatabase({
    restaurant: {
      listings: [listing("dish_cheeseburger", "Gold", 5)],
    },
  }));

  const result = await withMockedNow(
    NOW,
    () => unlistDishFromMenu(PLAYER_ID, "dish_cheeseburger", "Gold"),
  );

  assertEquals(result.quantityReturned, 5, "returned quantity");
  assertEquals(database.players[0].restaurant.listings, [], "listing removed");
  assertEquals(database.inventory[0].item_id, "dish_cheeseburger", "dish");
  assertEquals(database.inventory[0].grade, "Gold", "grade");
  assertEquals(database.inventory[0].quantity, 5, "quantity");
});

Deno.test("T5.1.6 More than owned", async () => {
  installMockSupabase(buildMockDatabase({
    inventory: [inv("dish_cheeseburger", "Gold", 3)],
  }));

  await assertRejectsWithMessage(
    () => listDishOnMenu(PLAYER_ID, "dish_cheeseburger", "Gold", 5),
    "INSUFFICIENT_QUANTITY",
  );
});

Deno.test("T5.1.7 Multiplier 0h", () => {
  assertEquals(
    calculateTimeMultiplier(
      { openedAt: NOW, menuLastChangedAt: NOW },
      NOW,
      1.5,
      14_400,
    ),
    1,
    "0h multiplier",
  );
});

Deno.test("T5.1.8 Multiplier 2h", () => {
  assertEquals(
    calculateTimeMultiplier(
      { openedAt: NOW - 7200, menuLastChangedAt: NOW - 7200 },
      NOW,
      1.5,
      14_400,
    ),
    1.25,
    "2h multiplier",
  );
});

Deno.test("T5.1.9 Multiplier cap at 4h+", () => {
  assertEquals(
    calculateTimeMultiplier(
      { openedAt: NOW - 20_000, menuLastChangedAt: NOW - 20_000 },
      NOW,
      1.5,
      14_400,
    ),
    1.5,
    "capped multiplier",
  );
});

Deno.test("T5.1.10 Non-dish item", async () => {
  installMockSupabase(buildMockDatabase({
    inventory: [inv("crop_tomato", "Normal", 1)],
  }));

  await assertRejectsWithMessage(
    () => listDishOnMenu(PLAYER_ID, "crop_tomato", "Normal", 1),
    "INVALID_DISH_ID:crop_tomato",
  );
});

Deno.test("T5.2.1 getFavouredDish deterministic", () => {
  const first = getFavouredDish("2026-05-04");
  for (let i = 0; i < 100; i++) {
    assertEquals(getFavouredDish("2026-05-04"), first, "favoured dish stable");
  }
});

Deno.test("T5.2.2 Mid-game approximately 10,000g/day", async () => {
  const database = installMockSupabase(buildMockDatabase({
    restaurant: {
      tier: 2,
      decorScore: 10,
      staff: [{ role: "head_chef", tier: 1 }],
      openedAt: NOW - 8640,
      menuLastChangedAt: NOW - 8640,
      lastCollectionTimestamp: NOW - 86_400,
      listings: [
        listing("dish_cheeseburger", "Gold", 8),
        listing("dish_bacon_burger", "Gold", 6),
        listing("dish_spicy_burger", "Gold", 4),
        listing("dish_fries", "Gold", 10),
        listing("dish_classic_burger", "Silver", 5),
        listing("dish_fish_fillet", "Silver", 3),
      ],
    },
    gameConfig: { OFFLINE_CAP_SECONDS: 86_400 },
  }));

  const result = await withMockedNow(
    NOW,
    () => collectRestaurantEarnings(PLAYER_ID),
  );

  assertBetween(result.totalRevenue, 8000, 12_000, "mid-game revenue");
  assertEquals(database.players[0].coins, result.totalRevenue, "credited");
});

Deno.test("T5.2.3 Gold 2x Normal", async () => {
  const normal = await collectSingleDishRevenue("Normal");
  const gold = await collectSingleDishRevenue("Gold");

  assertEquals(gold, normal * 2, "gold multiplier");
});

Deno.test("T5.2.4 Diamond 3x Normal", async () => {
  const normal = await collectSingleDishRevenue("Normal");
  const diamond = await collectSingleDishRevenue("Diamond");

  assertEquals(diamond, normal * 3, "diamond multiplier");
});

Deno.test("T5.2.5 Favoured +30%", async () => {
  const baseline = await collectSingleDishRevenue("Normal", {
    dishId: "dish_fries",
    gameConfig: { FAVOURED_DISH_BONUS: 1 },
  });
  const favoured = await collectSingleDishRevenue("Normal", {
    dishId: "dish_fries",
    gameConfig: { FAVOURED_DISH_BONUS: 1.3 },
  });

  assertEquals(favoured, Math.floor(baseline * 1.3), "favoured multiplier");
});

Deno.test("T5.2.6 Head Chef +15%", async () => {
  const noChef = await collectSingleDishRevenue("Normal");
  const withChef = await collectSingleDishRevenue("Normal", {
    staff: [{ role: "head_chef", tier: 1 }],
  });

  assertEquals(withChef, Math.round(noChef * 1.15), "head chef multiplier");
});

Deno.test("T5.2.7 Collect twice in 60s", async () => {
  const database = installMockSupabase(buildMockDatabase({
    restaurant: {
      lastCollectionTimestamp: NOW - 60,
      openedAt: NOW,
      menuLastChangedAt: NOW,
      listings: [listing("dish_classic_burger", "Normal", 100)],
    },
    gameConfig: {
      RESTAURANT_BASE_CUSTOMERS_RATE: { 1: 0.0003 },
      DISH_DEMAND_WEIGHT: { dish_classic_burger: 1 },
      FAVOURED_DISH_BONUS: 1,
    },
  }));

  const first = await withMockedNow(
    NOW,
    () => collectRestaurantEarnings(PLAYER_ID),
  );
  const second = await withMockedNow(
    NOW,
    () => collectRestaurantEarnings(PLAYER_ID),
  );

  assertEquals(first.totalRevenue, 0, "first short collect");
  assertEquals(second.totalRevenue, 0, "second immediate collect");
  assertEquals(database.players[0].coins, 0, "no sub-coin credit");
});

Deno.test("T5.2.8 Offline cap 32h", async () => {
  const sixteenHours = await collectSingleDishRevenue("Normal", {
    elapsedSeconds: 57_600,
    quantity: 100_000,
  });
  const thirtyTwoHours = await collectSingleDishRevenue("Normal", {
    elapsedSeconds: 115_200,
    quantity: 100_000,
  });

  assertEquals(thirtyTwoHours, sixteenHours, "offline cap");
});

Deno.test("T5.2.9 Sold dishes removed", async () => {
  const database = installMockSupabase(buildMockDatabase({
    restaurant: {
      lastCollectionTimestamp: NOW - 10,
      openedAt: NOW,
      menuLastChangedAt: NOW,
      listings: [listing("dish_classic_burger", "Normal", 10)],
    },
    gameConfig: {
      RESTAURANT_BASE_CUSTOMERS_RATE: { 1: 1 },
      DISH_DEMAND_WEIGHT: { dish_classic_burger: 0.7 },
      FAVOURED_DISH_BONUS: 1,
    },
  }));

  await withMockedNow(NOW, () => collectRestaurantEarnings(PLAYER_ID));

  assertEquals(
    database.players[0].restaurant.listings[0].quantity,
    3,
    "remaining quantity",
  );
});

Deno.test("T5.2.10 XP once per day", async () => {
  installMockSupabase(buildMockDatabase({
    restaurant: {
      lastCollectionTimestamp: NOW - 10,
      openedAt: NOW,
      menuLastChangedAt: NOW,
      listings: [listing("dish_classic_burger", "Normal", 100)],
    },
    gameConfig: {
      RESTAURANT_BASE_CUSTOMERS_RATE: { 1: 1 },
      DISH_DEMAND_WEIGHT: { dish_classic_burger: 1 },
      FAVOURED_DISH_BONUS: 1,
    },
  }));

  await withMockedNow(NOW, () => collectRestaurantEarnings(PLAYER_ID));
  await withMockedNow(NOW + 60, () => collectRestaurantEarnings(PLAYER_ID));
  await withMockedNow(NOW + 120, () => collectRestaurantEarnings(PLAYER_ID));
  const calls = getRestaurantStubCallsForTesting();

  assertEquals(calls.xpAwards.length, 1, "XP once");
  assertEquals(calls.xpAwards[0].amount, 50, "XP amount");
  assertEquals(calls.skillXpAwards.length, 1, "skill XP once");
  assertEquals(calls.skillXpAwards[0].skillTrack, "commerce", "skill track");
});

Deno.test("T5.3.1 Hire Head Chef", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: { coins: 500 },
    restaurant: { staff: {} },
  }));

  const result = await withMockedNow(
    NOW,
    () => hireStaff(PLAYER_ID, "head_chef"),
  );

  assertEquals(result, {
    success: true,
    staffType: "head_chef",
    tier: 1,
    hireCost: 500,
  }, "hire result");
  assertEquals(database.players[0].coins, 0, "coins deducted");
  assertEquals(database.players[0].restaurant.staff, {
    head_chef: { staffType: "head_chef", tier: 1, hiredAt: NOW },
  }, "staff record");
  assertEquals(
    database.coin_transactions[0].transaction_type,
    "STAFF_HIRE",
    "transaction type",
  );
});

Deno.test("T5.3.2 Hire twice throws", async () => {
  installMockSupabase(buildMockDatabase({
    player: { coins: 500 },
    restaurant: {
      staff: { head_chef: { staffType: "head_chef", tier: 1 } },
    },
  }));

  await assertRejectsWithMessage(
    () => hireStaff(PLAYER_ID, "head_chef"),
    "STAFF_ALREADY_HIRED:head_chef",
  );
});

Deno.test("T5.3.3 Upgrade Head Chef t1 to t2", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: { coins: 1500 },
    restaurant: {
      staff: { head_chef: { staffType: "head_chef", tier: 1 } },
    },
  }));

  const result = await upgradeStaff(PLAYER_ID, "head_chef");

  assertEquals(result, {
    success: true,
    staffType: "head_chef",
    newTier: 2,
    upgradeCost: 1500,
  }, "upgrade result");
  assertEquals(database.players[0].coins, 0, "coins deducted");
  assertEquals(
    (database.players[0].restaurant.staff as Record<string, { tier: number }>)
      .head_chef.tier,
    2,
    "tier upgraded",
  );
  assertEquals(
    database.coin_transactions[0].transaction_type,
    "STAFF_UPGRADE",
    "transaction type",
  );
});

Deno.test("T5.3.4 Upgrade at max tier", async () => {
  installMockSupabase(buildMockDatabase({
    player: { coins: 4000 },
    restaurant: {
      staff: { head_chef: { staffType: "head_chef", tier: 3 } },
    },
  }));

  await assertRejectsWithMessage(
    () => upgradeStaff(PLAYER_ID, "head_chef"),
    "STAFF_AT_MAX_TIER:head_chef",
  );
});

Deno.test("T5.3.5 No staff neutral bonuses", () => {
  const result = calculateStaffBonuses({});

  assertEquals(result.headChefRevenueMult, 1, "head chef neutral");
  assertEquals(result.maitreDCustomerMult, 1, "maitre d neutral");
  assertEquals(result.guardStealReduction, 0, "guard neutral");
});

Deno.test("T5.3.6 Head Chef t1", () => {
  const result = calculateStaffBonuses({
    head_chef: { staffType: "head_chef", tier: 1 },
  });

  assertEquals(result.headChefRevenueMult, 1.15, "head chef t1");
});

Deno.test("T5.3.7 Head Chef t2", () => {
  const result = calculateStaffBonuses({
    head_chef: { staffType: "head_chef", tier: 2 },
  });

  assertEquals(result.headChefRevenueMult, 1.25, "head chef t2");
});

Deno.test("T5.3.8 Guard t1", () => {
  const result = calculateStaffBonuses({
    guard: { staffType: "guard", tier: 1 },
  });

  assertEquals(result.guardStealReduction, 0.30, "guard t1 reduction");
  assertEquals(result.guardAlertsOnSteal, false, "guard t1 alerts");
});

Deno.test("T5.3.9 Guard t2", () => {
  const result = calculateStaffBonuses({
    guard: { staffType: "guard", tier: 2 },
  });

  assertEquals(result.guardStealReduction, 0.50, "guard t2 reduction");
  assertEquals(result.guardAlertsOnSteal, true, "guard t2 alerts");
});

Deno.test("T5.3.10 Pure function", () => {
  let supabaseCalls = 0;
  setSupabaseAdminForTesting({
    from(_table: string): unknown {
      supabaseCalls += 1;
      return {};
    },
  });

  for (let i = 0; i < 100; i++) {
    calculateStaffBonuses({
      head_chef: { staffType: "head_chef", tier: 1 },
      guard: { staffType: "guard", tier: 2 },
    });
  }

  assertEquals(supabaseCalls, 0, "supabase calls");
});

/**
 * Collects revenue for one listing in a controlled setup.
 * @param grade - Listing grade.
 * @param options - Optional setup overrides.
 * @returns Total revenue from collection.
 * @throws Any error thrown by collection.
 */
async function collectSingleDishRevenue(
  grade: string,
  options: {
    dishId?: string;
    staff?: RestaurantStaffMember[];
    gameConfig?: Record<string, unknown>;
    elapsedSeconds?: number;
    quantity?: number;
  } = {},
): Promise<number> {
  const dishId = options.dishId ?? "dish_classic_burger";
  installMockSupabase(buildMockDatabase({
    restaurant: {
      lastCollectionTimestamp: NOW - (options.elapsedSeconds ?? 10),
      openedAt: NOW,
      menuLastChangedAt: NOW,
      staff: options.staff ?? [],
      listings: [listing(dishId, grade, options.quantity ?? 1000)],
    },
    gameConfig: {
      RESTAURANT_BASE_CUSTOMERS_RATE: { 1: 1 },
      DISH_DEMAND_WEIGHT: { [dishId]: 1 },
      FAVOURED_DISH_BONUS: 1,
      ...(options.gameConfig ?? {}),
    },
  }));

  const result = await withMockedNow(
    NOW,
    () => collectRestaurantEarnings(PLAYER_ID),
  );
  return result.totalRevenue;
}
