import type { FarmPlot } from "../_lib/farm.ts";
import { setSupabaseAdminForTesting } from "../_lib/supabase.ts";
import {
  getWaterPlotStubCallsForTesting,
  resetWaterPlotStubsForTesting,
  waterPlot,
} from "./index.ts";

type TableName = "players" | "game_config";

interface PlayerRow {
  id: string;
  farm_plots: FarmPlot[];
}

interface GameConfigRow {
  key: string;
  value: string;
}

interface MockDatabase {
  players: PlayerRow[];
  game_config: GameConfigRow[];
}

interface MockQueryResult {
  data: Record<string, unknown> | Array<Record<string, unknown>> | null;
  error: { message: string } | null;
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
    plantedAt: NOW,
    yield: 10,
    stealPool: 4,
    stealPoolRemaining: 4,
    ...values,
  };
}

/**
 * Builds a mock water-plot database.
 * @param plots - Owner farm plots.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(plots: FarmPlot[]): MockDatabase {
  return {
    players: [
      { id: "owner-001", farm_plots: clone(plots) },
      { id: "friend-001", farm_plots: [] },
    ],
    game_config: [
      { key: "STEAL_WINDOW_SECONDS", value: "60" },
      { key: "OFFLINE_CAP_SECONDS", value: "57600" },
      { key: "WITHER_TIME_MULTIPLIER", value: "2.0" },
      { key: "MAX_WATERINGS_PER_CYCLE", value: "3" },
      { key: "WATER_REDUCTION_PERCENT", value: "0.15" },
      ...Object.entries(CROP_CONFIG_FIXTURES).map(([key, value]) => ({
        key,
        value: JSON.stringify(value),
      })),
    ],
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
  private filters: Array<{ column: string; value: string }> = [];
  private mutation: { type: "update"; values: Record<string, unknown> } | null =
    null;

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
   * @returns Current query builder.
   * @throws Never.
   */
  select(columns: string): MockQueryBuilder {
    this.selectedColumns = columns;
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
   * Resolves a single query.
   * @returns Query result with one row.
   * @throws Never.
   */
  single(): Promise<MockQueryResult> {
    const rows = this.matchingRows();
    return Promise.resolve({
      data: rows.length > 0 ? this.projectRow(rows[0]) : null,
      error: null,
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
    if (this.mutation) return this.executeUpdate();
    return {
      data: this.matchingRows().map((row) => this.projectRow(row)),
      error: null,
    };
  }

  /**
   * Executes an update mutation.
   * @returns Mock query result.
   * @throws Never.
   */
  private executeUpdate(): MockQueryResult {
    const rows = this.matchingRows();
    for (const row of rows) {
      Object.assign(row, clone(this.mutation?.values ?? {}));
    }
    return {
      data: rows.map((row) => this.projectRow(row)),
      error: null,
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
  resetWaterPlotStubsForTesting();
  return database;
}

Deno.test("T2.5.1 First watering", async () => {
  const database = installMockSupabase([
    plantedPlot({ plantedAt: NOW - 1_800 }),
  ]);

  const result = await withMockedNow(
    NOW,
    () => waterPlot("owner-001", "owner-001", "plot_1"),
  );

  assertEquals(result.timeReductionSeconds, 270, "reduction");
  assertEquals(result.newTimeRemainingSeconds, 1_530, "new time remaining");
  assertEquals(result.newWateringsCount, 1, "waterings");
  assertEquals(
    database.players[0].farm_plots[0].plantedAt,
    NOW - 2_070,
    "plantedAt",
  );
});

Deno.test("T2.5.2 Second watering", async () => {
  installMockSupabase([plantedPlot({ plantedAt: NOW - 1_800 })]);

  await withMockedNow(
    NOW,
    () => waterPlot("owner-001", "owner-001", "plot_1"),
  );
  const result = await withMockedNow(
    NOW,
    () => waterPlot("owner-001", "owner-001", "plot_1"),
  );

  assertEquals(result.timeReductionSeconds, 229, "reduction");
  assertEquals(result.newTimeRemainingSeconds, 1_301, "new time remaining");
  assertEquals(result.newWateringsCount, 2, "waterings");
});

Deno.test("T2.5.3 Third watering succeeds", async () => {
  installMockSupabase([
    plantedPlot({ plantedAt: NOW - 1_800, waterings: 2 }),
  ]);

  const result = await withMockedNow(
    NOW,
    () => waterPlot("owner-001", "owner-001", "plot_1"),
  );

  assertEquals(result.success, true, "success");
  assertEquals(result.newWateringsCount, 3, "waterings");
});

Deno.test("T2.5.4 Fourth watering blocked", async () => {
  const database = installMockSupabase([
    plantedPlot({ plantedAt: NOW - 1_800, waterings: 3 }),
  ]);
  const before = clone(database.players[0].farm_plots[0]);

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        NOW,
        () => waterPlot("owner-001", "owner-001", "plot_1"),
      ),
    "MAX_WATERINGS_REACHED",
  );

  assertEquals(database.players[0].farm_plots[0], before, "plot unchanged");
});

Deno.test("T2.5.5 Cannot water RIPE", async () => {
  installMockSupabase([
    plantedPlot({ plantedAt: NOW - 3_600 }),
  ]);

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        NOW,
        () => waterPlot("owner-001", "owner-001", "plot_1"),
      ),
    "PLOT_NOT_GROWING:RIPE",
  );
});

Deno.test("T2.5.6 Cannot water STEALABLE", async () => {
  installMockSupabase([
    plantedPlot({ plantedAt: NOW - 3_661 }),
  ]);

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        NOW,
        () => waterPlot("owner-001", "owner-001", "plot_1"),
      ),
    "PLOT_NOT_GROWING:STEALABLE",
  );
});

Deno.test("T2.5.7 Cannot water EMPTY", async () => {
  installMockSupabase([emptyPlot("plot_1")]);

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        NOW,
        () => waterPlot("owner-001", "owner-001", "plot_1"),
      ),
    "PLOT_NOT_GROWING:EMPTY",
  );
});

Deno.test("T2.5.8 Friend watering awards XP", async () => {
  installMockSupabase([
    plantedPlot({ plantedAt: NOW - 1_800 }),
  ]);

  await withMockedNow(
    NOW,
    () => waterPlot("friend-001", "owner-001", "plot_1"),
  );
  const calls = getWaterPlotStubCallsForTesting();

  assertEquals(calls.xpAwards, [{
    playerId: "friend-001",
    amount: 15,
    reason: "WATER_CROP",
  }], "xp awards");
});

Deno.test("T2.5.9 Self-watering no XP", async () => {
  installMockSupabase([
    plantedPlot({ plantedAt: NOW - 1_800 }),
  ]);

  await withMockedNow(
    NOW,
    () => waterPlot("owner-001", "owner-001", "plot_1"),
  );
  const calls = getWaterPlotStubCallsForTesting();

  assertEquals(calls.xpAwards, [], "xp awards");
  assertEquals(calls.helpActions, [], "help actions");
});

Deno.test("T2.5.10 plantedAt floor guard", async () => {
  const database = installMockSupabase([
    plantedPlot({ plantedAt: NOW - 3_570 }),
  ]);

  const result = await withMockedNow(
    NOW,
    () => waterPlot("owner-001", "owner-001", "plot_1"),
  );

  assertEquals(result.timeReductionSeconds, 4, "reduction");
  assertEquals(result.newTimeRemainingSeconds, 26, "new time remaining");
  assert(
    database.players[0].farm_plots[0].plantedAt > NOW - 3_600,
    "still growing",
  );
});

Deno.test("T2.5.11 Perpetual regrow watering", async () => {
  const database = installMockSupabase([
    plantedPlot({
      cropId: "crop_strawberry",
      plantedAt: NOW - 10_000,
      regrowStartedAt: NOW - 1_800,
      isPerpetualRegrowing: true,
    }),
  ]);
  const originalPlantedAt = database.players[0].farm_plots[0].plantedAt;

  const result = await withMockedNow(
    NOW,
    () => waterPlot("owner-001", "owner-001", "plot_1"),
  );

  assertEquals(result.timeReductionSeconds, 270, "reduction");
  assertEquals(result.newTimeRemainingSeconds, 1_530, "new time remaining");
  assertEquals(
    database.players[0].farm_plots[0].regrowStartedAt,
    NOW - 2_070,
    "regrowStartedAt",
  );
  assertEquals(
    database.players[0].farm_plots[0].plantedAt,
    originalPlantedAt,
    "plantedAt unchanged",
  );
});

Deno.test("T2.5.12 Notification sent", async () => {
  installMockSupabase([
    plantedPlot({ plantedAt: NOW - 1_800 }),
  ]);

  await withMockedNow(
    NOW,
    () => waterPlot("friend-001", "owner-001", "plot_1"),
  );
  const calls = getWaterPlotStubCallsForTesting();

  assertEquals(calls.notifications, [{
    playerId: "owner-001",
    type: "FRIEND_WATERED_CROP",
    metadata: { plotId: "plot_1" },
  }], "notifications");
});
