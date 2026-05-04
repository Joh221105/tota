import type { FarmPlot } from "../lib/farm.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";
import {
  getHarvestPlotStubCallsForTesting,
  harvestPlot,
  resetHarvestPlotStubsForTesting,
  setRollGradeForTesting,
} from "./index.ts";

type InventoryCategory =
  | "crops"
  | "fish"
  | "animal_produce"
  | "processed"
  | "cooked_dishes"
  | "tools";

type TableName = "players" | "game_config" | "inventory";

interface PlayerRow {
  id: string;
  farm_plots: FarmPlot[];
  skills: {
    farming: {
      level: number;
    };
  };
  inventory_slots: Record<InventoryCategory, number>;
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
  category: InventoryCategory;
}

interface MockDatabase {
  players: PlayerRow[];
  game_config: GameConfigRow[];
  inventory: InventoryRow[];
  nextInventoryId: number;
}

interface MockQueryResult {
  data: Record<string, unknown> | Array<Record<string, unknown>> | null;
  error: { message: string } | null;
  count: number | null;
}

const NOW = 1_700_000_000;

const CROP_CONFIG_FIXTURES: Record<string, Record<string, unknown>> = {
  crop_lettuce: {
    growTimeSeconds: 1_800,
    seedCostCoins: 5,
    isPerpetual: false,
    unlockLevel: 1,
    baseYieldMin: 3,
    baseYieldMax: 5,
  },
  crop_tomato: {
    growTimeSeconds: 7_200,
    seedCostCoins: 10,
    isPerpetual: false,
    unlockLevel: 1,
    baseYieldMin: 5,
    baseYieldMax: 8,
  },
  crop_jalapeno: {
    growTimeSeconds: 28_800,
    seedCostCoins: 200,
    isPerpetual: false,
    unlockLevel: 9,
    baseYieldMin: 12,
    baseYieldMax: 18,
  },
  crop_strawberry: {
    growTimeSeconds: 7_200,
    regrowTimeSeconds: 3_600,
    seedCostCoins: 60,
    isPerpetual: true,
    unlockLevel: 6,
    baseYieldMin: 10,
    baseYieldMax: 16,
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
 * Asserts that an async function rejects with an exact error message.
 * @param action - Async action expected to reject.
 * @param expectedMessage - Expected exact error message.
 * @returns Nothing.
 * @throws Error when no error is thrown or the message differs.
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
 * Runs an action with Date.now mocked to a fixed timestamp.
 * @param timestampSeconds - Fixed Unix timestamp in seconds.
 * @param action - Action to run while Date.now is mocked.
 * @returns Action result.
 * @throws Any error thrown by action.
 */
async function withMockedNow<T>(
  timestampSeconds: number,
  action: () => Promise<T>,
): Promise<T> {
  const originalNow = Date.now;
  Object.defineProperty(Date, "now", {
    value: () => timestampSeconds * 1000,
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
 * Builds inventory slots with optional overrides.
 * @param slots - Optional slot overrides.
 * @returns Inventory slot map.
 * @throws Never.
 */
function inventorySlots(
  slots: Partial<Record<InventoryCategory, number>> = {},
): Record<InventoryCategory, number> {
  return {
    crops: 20,
    fish: 10,
    animal_produce: 10,
    processed: 15,
    cooked_dishes: 10,
    tools: 10,
    ...slots,
  };
}

/**
 * Builds an empty farm plot for tests.
 * @param plotId - Plot ID to assign.
 * @returns Empty farm plot.
 * @throws Never.
 */
function emptyPlot(plotId: string): FarmPlot {
  return {
    plotId,
    cropId: null,
    state: "EMPTY",
    plantedAt: 0,
    regrowStartedAt: null,
    yield: 0,
    stealPool: 0,
    stealPoolRemaining: 0,
    waterings: 0,
    hasBugs: false,
    hasWeeds: false,
    fertilised: false,
    fertiliserBronzeBoost: 0,
    fertiliserSilverBoost: 0,
    isPerpetualRegrowing: false,
    needsWater: false,
    lastPestCheck: 0,
  };
}

/**
 * Builds a ready annual crop plot for tests.
 * @param values - Optional farm plot overrides.
 * @returns Ready farm plot.
 * @throws Never.
 */
function readyPlot(values: Partial<FarmPlot> = {}): FarmPlot {
  return {
    ...emptyPlot("plot_1"),
    cropId: "crop_tomato",
    state: "PLANTED",
    plantedAt: NOW - 7_200,
    yield: 7,
    stealPool: 3,
    stealPoolRemaining: 3,
    ...values,
  };
}

/**
 * Builds a mock harvest database.
 * @param plots - Player farm plots.
 * @param slotOverrides - Optional inventory slot overrides.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(
  plots: FarmPlot[],
  slotOverrides: Partial<Record<InventoryCategory, number>> = {},
): MockDatabase {
  return {
    players: [{
      id: "player-001",
      farm_plots: clone(plots),
      skills: { farming: { level: 4 } },
      inventory_slots: inventorySlots(slotOverrides),
    }],
    game_config: [
      { key: "WITHER_YIELD_MULTIPLIER", value: "0.5" },
      { key: "BUG_YIELD_PENALTY", value: "0.5" },
      { key: "STEAL_WINDOW_SECONDS", value: "60" },
      { key: "OFFLINE_CAP_SECONDS", value: "57600" },
      { key: "WITHER_TIME_MULTIPLIER", value: "2.0" },
      { key: "MAX_WATERINGS_PER_CYCLE", value: "3" },
      ...Object.entries(CROP_CONFIG_FIXTURES).map(([key, value]) => ({
        key,
        value: JSON.stringify(value),
      })),
    ],
    inventory: [],
    nextInventoryId: 1,
  };
}

/**
 * Adds an inventory row to the mock database.
 * @param database - Mock database to mutate.
 * @param values - Inventory row values.
 * @returns Created inventory row.
 * @throws Never.
 */
function addInventoryRow(
  database: MockDatabase,
  values: Omit<InventoryRow, "id" | "player_id"> & { player_id?: string },
): InventoryRow {
  const row = {
    id: `inv-${String(database.nextInventoryId++).padStart(3, "0")}`,
    player_id: values.player_id ?? "player-001",
    item_id: values.item_id,
    grade: values.grade,
    quantity: values.quantity,
    category: values.category,
  };
  database.inventory.push(row);
  return row;
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

class MockQueryBuilder implements PromiseLike<MockQueryResult> {
  private readonly database: MockDatabase;
  private readonly table: TableName;
  private selectedColumns = "*";
  private head = false;
  private wantsCount = false;
  private filters: Array<{ column: string; value: string }> = [];
  private mutation:
    | { type: "update"; values: Record<string, unknown> }
    | { type: "insert"; values: Record<string, unknown> }
    | null = null;

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
   * Records selected columns and options.
   * @param columns - Column list.
   * @param options - Optional count and head options.
   * @returns Current query builder.
   * @throws Never.
   */
  select(
    columns: string,
    options: { count?: "exact"; head?: boolean } = {},
  ): MockQueryBuilder {
    this.selectedColumns = columns;
    this.head = options.head === true;
    this.wantsCount = options.count === "exact";
    return this;
  }

  /**
   * Adds an equality filter.
   * @param column - Column name.
   * @param value - Expected value.
   * @returns Current query builder.
   * @throws Never.
   */
  eq(column: string, value: string): MockQueryBuilder {
    this.filters.push({ column, value });
    return this;
  }

  /**
   * Records an update mutation.
   * @param values - Values to update.
   * @returns Current query builder.
   * @throws Never.
   */
  update(values: Record<string, unknown>): MockQueryBuilder {
    this.mutation = { type: "update", values };
    return this;
  }

  /**
   * Records an insert mutation.
   * @param values - Values to insert.
   * @returns Current query builder.
   * @throws Never.
   */
  insert(values: Record<string, unknown>): MockQueryBuilder {
    this.mutation = { type: "insert", values };
    return this;
  }

  /**
   * Resolves a maybeSingle query.
   * @returns Query result with zero or one row.
   * @throws Never.
   */
  maybeSingle(): Promise<MockQueryResult> {
    const rows = this.matchingRows();
    return Promise.resolve({
      data: rows.length > 0 ? this.projectRow(rows[0]) : null,
      error: null,
      count: null,
    });
  }

  /**
   * Resolves a single query or mutation.
   * @returns Query result with one row.
   * @throws Never.
   */
  single(): Promise<MockQueryResult> {
    const result = this.execute();
    const row = Array.isArray(result.data)
      ? result.data[0] ?? null
      : result.data;
    return Promise.resolve({
      data: row,
      error: result.error,
      count: result.count,
    });
  }

  /**
   * Resolves an IN query.
   * @param column - Column to match.
   * @param values - Accepted values.
   * @returns Query result with matching rows.
   * @throws Never.
   */
  in(column: string, values: string[]): Promise<MockQueryResult> {
    const valueSet = new Set(values);
    return Promise.resolve({
      data: this.tableRows()
        .filter((row) => valueSet.has(String(row[column])))
        .map((row) => this.projectRow(row)),
      error: null,
      count: null,
    });
  }

  /**
   * Makes the query builder awaitable.
   * @param onfulfilled - Fulfilled callback.
   * @param onrejected - Rejected callback.
   * @returns Promise-like query result.
   * @throws Never.
   */
  then<TResult1 = MockQueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: MockQueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  /**
   * Executes the configured query or mutation.
   * @returns Mock query result.
   * @throws Never.
   */
  private execute(): MockQueryResult {
    if (this.mutation?.type === "insert") return this.executeInsert();
    if (this.mutation?.type === "update") return this.executeUpdate();

    const rows = this.matchingRows();
    return {
      data: this.head ? null : rows.map((row) => this.projectRow(row)),
      error: null,
      count: this.wantsCount ? rows.length : null,
    };
  }

  /**
   * Executes an insert mutation.
   * @returns Mock query result.
   * @throws Never.
   */
  private executeInsert(): MockQueryResult {
    const values =
      (this.mutation as { type: "insert"; values: Record<string, unknown> })
        .values;
    const row = {
      id: `inv-${String(this.database.nextInventoryId++).padStart(3, "0")}`,
      player_id: String(values.player_id),
      item_id: String(values.item_id),
      grade: String(values.grade),
      quantity: Number(values.quantity),
      category: values.category as InventoryCategory,
    };
    this.database.inventory.push(row);
    return { data: [this.projectRow(row)], error: null, count: null };
  }

  /**
   * Executes an update mutation.
   * @returns Mock query result.
   * @throws Never.
   */
  private executeUpdate(): MockQueryResult {
    const values =
      (this.mutation as { type: "update"; values: Record<string, unknown> })
        .values;
    const rows = this.matchingRows();
    for (const row of rows) {
      Object.assign(row, clone(values));
    }
    return {
      data: rows.map((row) => this.projectRow(row)),
      error: null,
      count: null,
    };
  }

  /**
   * Returns rows matching all equality filters.
   * @returns Matching rows.
   * @throws Never.
   */
  private matchingRows(): Array<Record<string, unknown>> {
    return this.tableRows().filter((row) =>
      this.filters.every((filter) =>
        String(row[filter.column]) === filter.value
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
 * @param plots - Player farm plots.
 * @param slotOverrides - Optional inventory slot overrides.
 * @returns Mock database backing the client.
 * @throws Never.
 */
function installMockSupabase(
  plots: FarmPlot[],
  slotOverrides: Partial<Record<InventoryCategory, number>> = {},
): MockDatabase {
  const database = buildMockDatabase(plots, slotOverrides);
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  resetHarvestPlotStubsForTesting();
  return database;
}

Deno.test("T2.7.1 Clean harvest, no steal", async () => {
  const database = installMockSupabase([readyPlot()]);

  const result = await withMockedNow(
    NOW,
    () => harvestPlot("player-001", "plot_1"),
  );

  assertEquals(result.itemsHarvested, [{
    itemId: "crop_tomato",
    grade: "Normal",
    quantity: 7,
  }], "items harvested");
  assertEquals(result.plotTransition, "EMPTY", "transition");
  assertEquals(database.players[0].farm_plots[0].cropId, null, "crop cleared");
});

Deno.test("T2.7.2 Partial steal taken", async () => {
  const database = installMockSupabase([
    readyPlot({ plantedAt: NOW - 7_261, stealPoolRemaining: 1 }),
  ]);

  await withMockedNow(NOW, () => harvestPlot("player-001", "plot_1"));

  assertEquals(database.inventory[0].quantity, 5, "quantity");
});

Deno.test("T2.7.3 Full pool stolen", async () => {
  const database = installMockSupabase([
    readyPlot({ plantedAt: NOW - 7_261, stealPoolRemaining: 0 }),
  ]);

  await withMockedNow(NOW, () => harvestPlot("player-001", "plot_1"));

  assertEquals(database.inventory[0].quantity, 4, "quantity");
});

Deno.test("T2.7.4 Withered penalty", async () => {
  const database = installMockSupabase([
    readyPlot({
      yield: 8,
      stealPool: 0,
      stealPoolRemaining: 0,
      plantedAt: NOW - 14_400,
    }),
  ]);

  const result = await withMockedNow(
    NOW,
    () => harvestPlot("player-001", "plot_1"),
  );

  assertEquals(database.inventory[0].quantity, 4, "quantity");
  assertEquals(
    result.yieldPenalties,
    { withered: true, bugs: false },
    "penalty",
  );
});

Deno.test("T2.7.5 Bug penalty", async () => {
  const database = installMockSupabase([
    readyPlot({
      yield: 8,
      stealPool: 0,
      stealPoolRemaining: 0,
      hasBugs: true,
    }),
  ]);

  const result = await withMockedNow(
    NOW,
    () => harvestPlot("player-001", "plot_1"),
  );

  assertEquals(database.inventory[0].quantity, 4, "quantity");
  assertEquals(
    result.yieldPenalties,
    { withered: false, bugs: true },
    "penalty",
  );
});

Deno.test("T2.7.6 Both penalties", async () => {
  const database = installMockSupabase([
    readyPlot({
      yield: 8,
      stealPool: 0,
      stealPoolRemaining: 0,
      plantedAt: NOW - 14_400,
      hasBugs: true,
    }),
  ]);

  await withMockedNow(NOW, () => harvestPlot("player-001", "plot_1"));

  assertEquals(database.inventory[0].quantity, 2, "quantity");
});

Deno.test("T2.7.7 Minimum 1", async () => {
  const database = installMockSupabase([
    readyPlot({
      yield: 1,
      stealPool: 0,
      stealPoolRemaining: 0,
      plantedAt: NOW - 14_400,
      hasBugs: true,
    }),
  ]);

  await withMockedNow(NOW, () => harvestPlot("player-001", "plot_1"));

  assertEquals(database.inventory[0].quantity, 1, "quantity");
});

Deno.test("T2.7.8 Harvest GROWING", async () => {
  installMockSupabase([readyPlot({ plantedAt: NOW - 100 })]);

  await assertRejectsWithMessage(
    () => withMockedNow(NOW, () => harvestPlot("player-001", "plot_1")),
    "PLOT_NOT_READY",
  );
});

Deno.test("T2.7.9 Harvest EMPTY", async () => {
  installMockSupabase([emptyPlot("plot_1")]);

  await assertRejectsWithMessage(
    () => withMockedNow(NOW, () => harvestPlot("player-001", "plot_1")),
    "PLOT_EMPTY",
  );
});

Deno.test("T2.7.10 Annual resets", async () => {
  const database = installMockSupabase([
    readyPlot({ cropId: "crop_lettuce", plantedAt: NOW - 1_800 }),
  ]);

  await withMockedNow(NOW, () => harvestPlot("player-001", "plot_1"));

  assertEquals(database.players[0].farm_plots[0].cropId, null, "crop id");
  assertEquals(database.players[0].farm_plots[0].state, "EMPTY", "state");
});

Deno.test("T2.7.11 Perpetual transitions", async () => {
  const database = installMockSupabase([
    readyPlot({
      cropId: "crop_strawberry",
      plantedAt: NOW - 7_200,
      yield: 10,
      stealPool: 4,
      stealPoolRemaining: 4,
    }),
  ]);

  const result = await withMockedNow(
    NOW,
    () => harvestPlot("player-001", "plot_1"),
  );

  assertEquals(result.plotTransition, "NEEDS_WATER", "transition");
  assertEquals(
    database.players[0].farm_plots[0].cropId,
    "crop_strawberry",
    "crop kept",
  );
  assertEquals(
    database.players[0].farm_plots[0].needsWater,
    true,
    "needs water",
  );
});

Deno.test("T2.7.12 Tier-1 XP", async () => {
  installMockSupabase([readyPlot()]);

  const result = await withMockedNow(
    NOW,
    () => harvestPlot("player-001", "plot_1"),
  );
  const calls = getHarvestPlotStubCallsForTesting();

  assertEquals(result.xpAwarded, 10, "xp awarded");
  assertEquals(calls.xpAwards, [{
    playerId: "player-001",
    amount: 10,
    source: "HARVEST_CROP",
  }], "xp calls");
  assertEquals(calls.skillXpAwards, [{
    playerId: "player-001",
    skillTrack: "farming",
    amount: 10,
  }], "skill xp calls");
});

Deno.test("T2.7.13 Tier-3 XP", async () => {
  installMockSupabase([
    readyPlot({ cropId: "crop_jalapeno", plantedAt: NOW - 28_800 }),
  ]);

  const result = await withMockedNow(
    NOW,
    () => harvestPlot("player-001", "plot_1"),
  );
  const calls = getHarvestPlotStubCallsForTesting();

  assertEquals(result.xpAwarded, 30, "xp awarded");
  assertEquals(calls.xpAwards[0].amount, 30, "xp call");
  assertEquals(calls.skillXpAwards[0].amount, 30, "skill xp call");
});

Deno.test("T2.7.14 Inventory full partial", async () => {
  const database = installMockSupabase([readyPlot()], { crops: 1 });
  addInventoryRow(database, {
    item_id: "crop_tomato",
    grade: "Normal",
    quantity: 1,
    category: "crops",
  });
  let rollIndex = 0;
  setRollGradeForTesting(() => {
    rollIndex += 1;
    return rollIndex <= 4 ? "Normal" : "Bronze";
  });

  const result = await withMockedNow(
    NOW,
    () => harvestPlot("player-001", "plot_1"),
  );

  assertEquals(result.itemsHarvested, [{
    itemId: "crop_tomato",
    grade: "Normal",
    quantity: 4,
  }], "items harvested");
  assertEquals(result.itemsFailedDueToFullInventory, [{
    itemId: "crop_tomato",
    grade: "Bronze",
    quantity: 3,
  }], "items failed");
  assertEquals(database.inventory[0].quantity, 5, "normal stack quantity");
});
