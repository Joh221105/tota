import {
  collectCookingOutput,
  type CookingSlot,
  getCookingStubCallsForTesting,
  resetCookingStubsForTesting,
  startCookingJob,
} from "./index.ts";
import { setSupabaseAdminForTesting } from "../_lib/supabase.ts";
import { getConfig } from "../_lib/config.ts";

type TableName = "players" | "game_config" | "inventory";

interface PlayerRow {
  id: string;
  level: number;
  cooking_slots: CookingSlot[];
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

interface MockDatabase {
  players: PlayerRow[];
  game_config: GameConfigRow[];
  inventory: InventoryRow[];
}

const NOW = 1_000_000;
const PLAYER_ID = "player-001";
const COOKING_RECIPE_IDS = [
  "recipe_classic_burger",
  "recipe_cheeseburger",
  "recipe_egg_burger",
  "recipe_bacon_burger",
  "recipe_fish_fillet",
  "recipe_spicy_burger",
  "recipe_shrimp_burger",
  "recipe_crab_burger",
  "recipe_tuna_melt",
  "recipe_fries_dish",
  "recipe_onion_rings_dish",
  "recipe_strawberry_milkshake",
];

const BASE_CONFIGS: Record<string, unknown> = {
  recipe_classic_burger: {
    inputs: [
      { itemId: "processed_bun", qty: 1 },
      { itemId: "animal_beef", qty: 1 },
      { itemId: "crop_lettuce", qty: 1 },
    ],
    outputItemId: "dish_classic_burger",
    outputQty: 1,
    durationSeconds: 600,
    goldValue: 80,
    tier: 1,
    unlockLevel: 1,
    recipeType: "cooking",
  },
  recipe_cheeseburger: {
    inputs: [
      { itemId: "processed_bun", qty: 1 },
      { itemId: "animal_beef", qty: 1 },
      { itemId: "processed_cheese", qty: 1 },
      { itemId: "crop_lettuce", qty: 1 },
    ],
    outputItemId: "dish_cheeseburger",
    outputQty: 1,
    durationSeconds: 720,
    goldValue: 120,
    tier: 1,
    unlockLevel: 2,
    recipeType: "cooking",
  },
  recipe_egg_burger: {
    inputs: [
      { itemId: "processed_bun", qty: 1 },
      { itemId: "animal_beef", qty: 1 },
      { itemId: "animal_egg", qty: 1 },
      { itemId: "crop_tomato", qty: 1 },
    ],
    outputItemId: "dish_egg_burger",
    outputQty: 1,
    durationSeconds: 720,
    goldValue: 100,
    tier: 1,
    unlockLevel: 3,
    recipeType: "cooking",
  },
  recipe_bacon_burger: {
    inputs: [
      { itemId: "processed_bun", qty: 1 },
      { itemId: "animal_beef", qty: 1 },
      { itemId: "processed_bacon", qty: 1 },
      { itemId: "processed_cheese", qty: 1 },
      { itemId: "processed_pickles", qty: 1 },
    ],
    outputItemId: "dish_bacon_burger",
    outputQty: 1,
    durationSeconds: 1080,
    goldValue: 160,
    tier: 2,
    unlockLevel: 6,
    recipeType: "cooking",
  },
  recipe_fish_fillet: {
    inputs: [
      { itemId: "processed_bun", qty: 1 },
      { itemId: "fish_catfish", qty: 1 },
      { itemId: "crop_lettuce", qty: 1 },
      { itemId: "processed_mayo", qty: 1 },
    ],
    outputItemId: "dish_fish_fillet",
    outputQty: 1,
    durationSeconds: 900,
    goldValue: 140,
    tier: 2,
    unlockLevel: 7,
    recipeType: "cooking",
  },
  recipe_spicy_burger: {
    inputs: [
      { itemId: "processed_bun", qty: 1 },
      { itemId: "animal_beef", qty: 1 },
      { itemId: "crop_jalapeno", qty: 1 },
      { itemId: "processed_cheese", qty: 1 },
      { itemId: "crop_tomato", qty: 1 },
    ],
    outputItemId: "dish_spicy_burger",
    outputQty: 1,
    durationSeconds: 1200,
    goldValue: 170,
    tier: 2,
    unlockLevel: 9,
    recipeType: "cooking",
  },
  recipe_shrimp_burger: {
    inputs: [
      { itemId: "processed_bun", qty: 1 },
      { itemId: "fish_shrimp", qty: 1 },
      { itemId: "crop_lettuce", qty: 1 },
      { itemId: "processed_mayo", qty: 1 },
    ],
    outputItemId: "dish_shrimp_burger",
    outputQty: 1,
    durationSeconds: 1080,
    goldValue: 155,
    tier: 2,
    unlockLevel: 10,
    recipeType: "cooking",
  },
  recipe_crab_burger: {
    inputs: [
      { itemId: "processed_bun", qty: 1 },
      { itemId: "fish_crab", qty: 1 },
      { itemId: "crop_lettuce", qty: 1 },
      { itemId: "crop_tomato", qty: 1 },
      { itemId: "processed_mayo", qty: 1 },
    ],
    outputItemId: "dish_crab_burger",
    outputQty: 1,
    durationSeconds: 1500,
    goldValue: 220,
    tier: 3,
    unlockLevel: 13,
    recipeType: "cooking",
  },
  recipe_tuna_melt: {
    inputs: [
      { itemId: "processed_bun", qty: 1 },
      { itemId: "fish_tuna", qty: 1 },
      { itemId: "processed_cheese", qty: 1 },
      { itemId: "processed_onion_rings", qty: 1 },
      { itemId: "processed_ketchup", qty: 1 },
    ],
    outputItemId: "dish_tuna_melt",
    outputQty: 1,
    durationSeconds: 1680,
    goldValue: 240,
    tier: 3,
    unlockLevel: 15,
    recipeType: "cooking",
  },
  recipe_fries_dish: {
    inputs: [{ itemId: "processed_fries", qty: 1 }],
    outputItemId: "dish_fries",
    outputQty: 1,
    durationSeconds: 300,
    goldValue: 50,
    tier: "side",
    unlockLevel: 4,
    recipeType: "cooking",
  },
  recipe_onion_rings_dish: {
    inputs: [{ itemId: "processed_onion_rings", qty: 1 }],
    outputItemId: "dish_onion_rings",
    outputQty: 1,
    durationSeconds: 300,
    goldValue: 60,
    tier: "side",
    unlockLevel: 9,
    recipeType: "cooking",
  },
  recipe_strawberry_milkshake: {
    inputs: [
      { itemId: "animal_milk", qty: 1 },
      { itemId: "crop_strawberry", qty: 1 },
    ],
    outputItemId: "dish_strawberry_milkshake",
    outputQty: 1,
    durationSeconds: 600,
    goldValue: 90,
    tier: "side",
    unlockLevel: 11,
    recipeType: "cooking",
  },
  COOKING_XP_BY_TIER: { 1: 25, 2: 40, 3: 60, side: 15 },
};

/**
 * Asserts that a condition is true.
 * @param condition - Condition to verify.
 * @param message - Failure message.
 * @returns Nothing.
 * @throws Error when the condition is false.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

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
 * Builds a cooking slot fixture.
 * @param overrides - Optional slot overrides.
 * @returns Cooking slot.
 * @throws Never.
 */
function slot(overrides: Partial<CookingSlot> = {}): CookingSlot {
  return {
    slotId: "c1",
    recipeId: null,
    state: "EMPTY",
    startedAt: null,
    inputGrades: [],
    ...overrides,
  };
}

/**
 * Routes item IDs to inventory categories for the mock.
 * @param itemId - Item ID.
 * @returns Inventory category.
 * @throws Never.
 */
function categoryFor(itemId: string): string {
  if (itemId.startsWith("crop_")) return "crops";
  if (itemId.startsWith("fish_")) return "fish";
  if (itemId.startsWith("animal_")) return "animal_produce";
  if (itemId.startsWith("processed_")) return "processed";
  if (itemId.startsWith("dish_")) return "cooked_dishes";
  return "tools";
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
    category: categoryFor(itemId),
  };
}

/**
 * Creates one row for each item required by a recipe.
 * @param recipeId - Recipe config key.
 * @param grade - Grade for all ingredients.
 * @returns Inventory rows.
 * @throws Never.
 */
function inventoryForRecipe(
  recipeId: string,
  grade = "Normal",
): InventoryRow[] {
  const recipe = BASE_CONFIGS[recipeId] as {
    inputs: Array<{ itemId: string; qty: number }>;
  };
  return recipe.inputs.map((input) => inv(input.itemId, grade, input.qty));
}

/**
 * Builds a mock database for cooking tests.
 * @param overrides - Optional player, inventory, and config overrides.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(overrides: {
  player?: Partial<PlayerRow>;
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
      level: 50,
      cooking_slots: [
        slot({ slotId: "c1" }),
        slot({ slotId: "c2" }),
        slot({ slotId: "c3" }),
        slot({ slotId: "c4" }),
      ],
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

/**
 * Runs an action with Math.random returning a fixed sequence.
 * @param values - Sequence of random values.
 * @param action - Action to run while random is mocked.
 * @returns Action result.
 * @throws Any error thrown by action.
 */
async function withMockedRandom<T>(
  values: number[],
  action: () => T | Promise<T>,
): Promise<T> {
  const originalRandom = Math.random;
  let index = 0;
  Object.defineProperty(Math, "random", {
    value: () => values[Math.min(index++, values.length - 1)] ?? 0,
    configurable: true,
  });
  try {
    return await action();
  } finally {
    Object.defineProperty(Math, "random", {
      value: originalRandom,
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
}

class MockQueryBuilder {
  private readonly database: MockDatabase;
  private readonly table: TableName;
  private selectedColumns = "*";
  private filters: Array<{ column: string; value: unknown }> = [];
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
   * Returns rows matching all equality filters.
   * @returns Matching rows.
   * @throws Never.
   */
  private matchingRows(): Array<Record<string, unknown>> {
    return this.tableRows().filter((row) =>
      this.filters.every((filter) =>
        String(row[filter.column]) === String(filter.value)
      )
    );
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
  resetCookingStubsForTesting();
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

Deno.test("T4.2.1 Start Classic Burger", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: inventoryForRecipe("recipe_classic_burger"),
  }));

  const result = await withMockedNow(
    NOW,
    () => startCookingJob(PLAYER_ID, "c1", "recipe_classic_burger", {}),
  );

  assertEquals(result.slot.state, "RUNNING", "slot running");
  assertEquals(result.estimatedCompletionAt, NOW + 600, "completion");
  assertEquals(database.inventory.length, 0, "ingredients removed");
});

Deno.test("T4.2.2 Collect Cheeseburger", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: {
      cooking_slots: [slot({
        slotId: "c1",
        recipeId: "recipe_cheeseburger",
        state: "COMPLETE",
        inputGrades: ["Normal", "Normal", "Normal", "Normal"],
      })],
    },
  }));

  const result = await withMockedRandom(
    [0],
    () => collectCookingOutput(PLAYER_ID, "c1"),
  );

  assertEquals(result.success, true, "success");
  assertEquals(database.inventory[0].item_id, "dish_cheeseburger", "dish");
  assertEquals(database.inventory[0].category, "cooked_dishes", "category");
  assertEquals(database.players[0].cooking_slots[0].state, "EMPTY", "empty");
});

Deno.test("T4.2.3 Grade inheritance", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: {
      cooking_slots: [slot({
        slotId: "c1",
        recipeId: "recipe_classic_burger",
        state: "COMPLETE",
        inputGrades: ["Gold", "Gold", "Normal"],
      })],
    },
  }));

  await withMockedRandom([0.90], () => collectCookingOutput(PLAYER_ID, "c1"));

  assertEquals(database.inventory[0].grade, "Gold", "grade skews Silver/Gold");
});

Deno.test("T4.2.4 Slot c3 locked at 24", async () => {
  installMockSupabase(buildMockDatabase({
    player: { level: 24 },
    inventory: inventoryForRecipe("recipe_classic_burger"),
  }));

  await assertRejectsWithMessage(
    () => startCookingJob(PLAYER_ID, "c3", "recipe_classic_burger", {}),
    "SLOT_NOT_UNLOCKED:c3",
  );
});

Deno.test("T4.2.5 Slot c3 unlocked at 25", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: { level: 25 },
    inventory: inventoryForRecipe("recipe_classic_burger"),
  }));

  await startCookingJob(PLAYER_ID, "c3", "recipe_classic_burger", {});

  assertEquals(database.players[0].cooking_slots[2].state, "RUNNING", "c3");
});

Deno.test("T4.2.6 Slot c4 at Level 40", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: { level: 40 },
    inventory: inventoryForRecipe("recipe_classic_burger"),
  }));

  await startCookingJob(PLAYER_ID, "c4", "recipe_classic_burger", {});

  assertEquals(database.players[0].cooking_slots[3].state, "RUNNING", "c4");
});

Deno.test("T4.2.7 Cooking paused on full", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: {
      inventory_slots: {
        crops: 5000,
        fish: 5000,
        animal_produce: 5000,
        processed: 5000,
        cooked_dishes: 0,
        tools: 5000,
      },
      cooking_slots: [slot({
        slotId: "c1",
        recipeId: "recipe_cheeseburger",
        state: "COMPLETE",
        inputGrades: ["Normal", "Normal", "Normal", "Normal"],
      })],
    },
  }));

  const result = await collectCookingOutput(PLAYER_ID, "c1");

  assertEquals(result, {
    success: false,
    state: "PAUSED",
    reason: "INVENTORY_FULL",
  }, "paused");
  assertEquals(database.players[0].cooking_slots[0].state, "PAUSED", "slot");
  assertEquals(database.inventory.length, 0, "dish not added");
});

Deno.test("T4.2.8 Tier-2 XP", async () => {
  installMockSupabase(buildMockDatabase({
    inventory: inventoryForRecipe("recipe_bacon_burger"),
  }));

  await startCookingJob(PLAYER_ID, "c1", "recipe_bacon_burger", {});
  const calls = getCookingStubCallsForTesting();

  assertEquals(calls.xpAwards[0].amount, 40, "XP amount");
  assertEquals(calls.xpAwards[0].source, "START_COOKING_JOB", "XP source");
  assertEquals(calls.skillXpAwards[0].skillTrack, "cooking", "skill");
  assertEquals(calls.skillXpAwards[0].amount, 40, "skill XP amount");
});

Deno.test("T4.2.9 Pre-validation", async () => {
  const inventory = inventoryForRecipe("recipe_bacon_burger");
  const database = installMockSupabase(buildMockDatabase({
    inventory: inventory.filter((row) => row.item_id !== "processed_pickles"),
  }));

  await assertRejectsWithMessage(
    () => startCookingJob(PLAYER_ID, "c1", "recipe_bacon_burger", {}),
    "INSUFFICIENT_INGREDIENTS:recipe_bacon_burger:processed_pickles",
  );
  assertEquals(database.inventory.length, 4, "none removed");
});

Deno.test("T4.2.10 All 12 recipes accessible", async () => {
  installMockSupabase(buildMockDatabase());

  for (const recipeId of COOKING_RECIPE_IDS) {
    await getConfig(recipeId);
  }

  assertEquals(COOKING_RECIPE_IDS.length, 12, "recipe count");
});
