import type { FarmPlot } from "../lib/farm.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";
import {
  applyFertiliser,
  blockMutualFriendForTesting,
  getApplyFertiliserStubCallsForTesting,
  resetApplyFertiliserStubsForTesting,
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
  crop_tomato: {
    growTimeSeconds: 3_600,
    seedCostCoins: 10,
    isPerpetual: false,
    unlockLevel: 1,
    baseYieldMin: 5,
    baseYieldMax: 8,
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
 * Builds a planted tomato farm plot for tests.
 * @param values - Optional farm plot overrides.
 * @returns Planted farm plot.
 * @throws Never.
 */
function plantedPlot(values: Partial<FarmPlot> = {}): FarmPlot {
  return {
    ...emptyPlot("plot_1"),
    cropId: "crop_tomato",
    state: "PLANTED",
    plantedAt: NOW - 1_800,
    yield: 10,
    stealPool: 4,
    stealPoolRemaining: 4,
    ...values,
  };
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
 * Builds a mock apply-fertiliser database.
 * @param plots - Owner farm plots.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(plots: FarmPlot[]): MockDatabase {
  return {
    players: [
      {
        id: "owner-001",
        farm_plots: clone(plots),
        inventory_slots: inventorySlots(),
      },
      {
        id: "friend-001",
        farm_plots: [],
        inventory_slots: inventorySlots(),
      },
      {
        id: "third-001",
        farm_plots: [],
        inventory_slots: inventorySlots(),
      },
    ],
    game_config: [
      { key: "FERTILISER_BRONZE_BOOST", value: "0.02" },
      { key: "FERTILISER_SILVER_BOOST", value: "0.01" },
      { key: "FRIEND_FERTILISER_BRONZE_BOOST", value: "0.02" },
      { key: "FRIEND_FERTILISER_SILVER_BOOST", value: "0.01" },
      { key: "MAX_FERTILISER_BRONZE_BOOST", value: "0.04" },
      { key: "MAX_FERTILISER_SILVER_BOOST", value: "0.02" },
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
   * Records selected columns and select options.
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
   * Executes the currently configured query or mutation.
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
 * @param plots - Owner farm plots.
 * @returns Mock database backing the client.
 * @throws Never.
 */
function installMockSupabase(plots: FarmPlot[]): MockDatabase {
  const database = buildMockDatabase(plots);
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  resetApplyFertiliserStubsForTesting();
  return database;
}

Deno.test("T2.6.1 Self-fertilise GROWING", async () => {
  const database = installMockSupabase([plantedPlot()]);

  const result = await withMockedNow(
    NOW,
    () => applyFertiliser("owner-001", "owner-001", "plot_1"),
  );

  assertEquals(result, {
    success: true,
    newBronzeBoost: 0.02,
    newSilverBoost: 0.01,
    isFriendApplication: false,
    xpAwarded: 0,
  }, "result");
  assertEquals(database.players[0].farm_plots[0].fertilised, true, "flag");
  assertEquals(
    database.players[0].farm_plots[0].fertiliserBronzeBoost,
    0.02,
    "bronze boost",
  );
  assertEquals(
    database.players[0].farm_plots[0].fertiliserSilverBoost,
    0.01,
    "silver boost",
  );
  assertEquals(
    getApplyFertiliserStubCallsForTesting().xpAwards,
    [],
    "xp awards",
  );
});

Deno.test("T2.6.2 Friend fertilises after owner", async () => {
  const database = installMockSupabase([plantedPlot()]);

  await withMockedNow(
    NOW,
    () => applyFertiliser("owner-001", "owner-001", "plot_1"),
  );
  const result = await withMockedNow(
    NOW,
    () => applyFertiliser("friend-001", "owner-001", "plot_1"),
  );

  assertEquals(result.newBronzeBoost, 0.04, "bronze boost result");
  assertEquals(result.newSilverBoost, 0.02, "silver boost result");
  assertEquals(result.xpAwarded, 25, "xp awarded result");
  assertEquals(
    database.players[0].farm_plots[0].fertiliserBronzeBoost,
    0.04,
    "bronze boost stored",
  );
  assertEquals(
    database.players[0].farm_plots[0].fertiliserSilverBoost,
    0.02,
    "silver boost stored",
  );
  assertEquals(getApplyFertiliserStubCallsForTesting().xpAwards, [{
    playerId: "friend-001",
    amount: 25,
    source: "FERTILISE_CROP",
  }], "xp awards");
  assertEquals(database.inventory, [{
    id: "inv-001",
    player_id: "friend-001",
    item_id: "guest_buff_token",
    grade: "Normal",
    quantity: 1,
    category: "tools",
  }], "inventory");
});

Deno.test("T2.6.3 Third hits cap", async () => {
  const database = installMockSupabase([
    plantedPlot({
      fertilised: true,
      fertiliserBronzeBoost: 0.04,
      fertiliserSilverBoost: 0.02,
    }),
  ]);
  const before = clone(database.players[0].farm_plots[0]);

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        NOW,
        () => applyFertiliser("third-001", "owner-001", "plot_1"),
      ),
    "FERTILISER_AT_MAX:plot_1",
  );

  assertEquals(database.players[0].farm_plots[0], before, "plot unchanged");
});

Deno.test("T2.6.4 Cannot fertilise RIPE", async () => {
  installMockSupabase([plantedPlot({ plantedAt: NOW - 3_600 })]);

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        NOW,
        () => applyFertiliser("owner-001", "owner-001", "plot_1"),
      ),
    "PLOT_NOT_GROWING:RIPE",
  );
});

Deno.test("T2.6.5 Cannot fertilise EMPTY", async () => {
  installMockSupabase([emptyPlot("plot_1")]);

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        NOW,
        () => applyFertiliser("owner-001", "owner-001", "plot_1"),
      ),
    "PLOT_NOT_GROWING:EMPTY",
  );
});

Deno.test("T2.6.6 Non-mutual friend blocked", async () => {
  installMockSupabase([plantedPlot()]);
  blockMutualFriendForTesting("friend-001", "owner-001");

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        NOW,
        () => applyFertiliser("friend-001", "owner-001", "plot_1"),
      ),
    "NOT_FRIENDS",
  );
});

Deno.test("T2.6.7 guest_buff_token in tools", async () => {
  const database = installMockSupabase([plantedPlot()]);

  await withMockedNow(
    NOW,
    () => applyFertiliser("friend-001", "owner-001", "plot_1"),
  );

  assertEquals(database.inventory[0].item_id, "guest_buff_token", "item id");
  assertEquals(database.inventory[0].grade, "Normal", "grade");
  assertEquals(database.inventory[0].quantity, 1, "quantity");
  assertEquals(database.inventory[0].category, "tools", "category");
});

Deno.test("T2.6.8 Self: no help action", async () => {
  installMockSupabase([plantedPlot()]);

  await withMockedNow(
    NOW,
    () => applyFertiliser("owner-001", "owner-001", "plot_1"),
  );

  assertEquals(
    getApplyFertiliserStubCallsForTesting().helpActions,
    [],
    "help actions",
  );
});
