import {
  type EnrichedPlot,
  type FarmStateResponse,
  getFarmState,
} from "./index.ts";
import type { FarmPlot } from "../lib/farm.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";

type TableName = "players" | "game_config";

interface PlayerRow {
  id: string;
  level: number;
  farm_plots: FarmPlot[];
}

interface GameConfigRow {
  key: string;
  value: string;
}

interface MockDatabase {
  players: PlayerRow[];
  game_config: GameConfigRow[];
  queryCount: number;
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
  crop_wheat: {
    growTimeSeconds: 7_200,
    seedCostCoins: 15,
    isPerpetual: false,
    unlockLevel: 1,
    baseYieldMin: 6,
    baseYieldMax: 10,
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
 * Builds a planted farm plot for tests.
 * @param plotId - Plot ID to assign.
 * @param values - Optional farm plot overrides.
 * @returns Planted farm plot.
 * @throws Never.
 */
function plantedPlot(plotId: string, values: Partial<FarmPlot> = {}): FarmPlot {
  return {
    ...emptyPlot(plotId),
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
 * Builds a mock get-farm-state database.
 * @param plots - Farm plots for the single player row.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(plots: FarmPlot[]): MockDatabase {
  return {
    players: [{
      id: "player-001",
      level: 5,
      farm_plots: clone(plots),
    }],
    game_config: [
      { key: "STEAL_WINDOW_SECONDS", value: "60" },
      { key: "OFFLINE_CAP_SECONDS", value: "57600" },
      { key: "WITHER_TIME_MULTIPLIER", value: "2.0" },
      { key: "MAX_WATERINGS_PER_CYCLE", value: "3" },
      ...Object.entries(CROP_CONFIG_FIXTURES).map(([key, value]) => ({
        key,
        value: JSON.stringify(value),
      })),
    ],
    queryCount: 0,
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

class MockQueryBuilder {
  private readonly database: MockDatabase;
  private readonly table: TableName;
  private selectedColumns = "*";
  private filters: Array<{ column: string; value: string }> = [];

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
   * Resolves a single query.
   * @returns Query result with one row.
   * @throws Never.
   */
  single(): Promise<MockQueryResult> {
    this.database.queryCount += 1;
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
    this.database.queryCount += 1;
    const valueSet = new Set(values);
    return Promise.resolve({
      data: this.tableRows()
        .filter((row) => valueSet.has(String(row[column])))
        .map((row) => this.projectRow(row)),
      error: null,
    });
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
 * @param plots - Farm plots for the single player row.
 * @returns Mock database backing the client.
 * @throws Never.
 */
function installMockSupabase(plots: FarmPlot[]): MockDatabase {
  const database = buildMockDatabase(plots);
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

Deno.test("T2.4.1 New player - all empty", async () => {
  installMockSupabase(
    Array.from({ length: 6 }, (_, idx) => emptyPlot(`plot_${idx + 1}`)),
  );

  const result = await withMockedNow(
    NOW,
    () => getFarmState("player-001"),
  );

  assertEquals(result.plotsEmpty, 6, "plotsEmpty");
  assertEquals(result.plotsReady, 0, "plotsReady");
  assertEquals(result.plotsGrowing, 0, "plotsGrowing");
  assertEquals(result.totalPlots, 6, "totalPlots");
});

Deno.test("T2.4.2 Mixed state farm", async () => {
  installMockSupabase([
    plantedPlot("plot_1", { plantedAt: NOW - 1_000 }),
    plantedPlot("plot_2", { plantedAt: NOW - 2_000 }),
    plantedPlot("plot_3", { plantedAt: NOW - 3_000 }),
    plantedPlot("plot_4", { plantedAt: NOW - 3_600 }),
    plantedPlot("plot_5", { plantedAt: NOW - 3_630 }),
    emptyPlot("plot_6"),
  ]);

  const result = await withMockedNow(
    NOW,
    () => getFarmState("player-001"),
  );

  assertEquals(result.plotsGrowing, 3, "plotsGrowing");
  assertEquals(result.plotsReady, 2, "plotsReady");
  assertEquals(result.plotsEmpty, 1, "plotsEmpty");
});

Deno.test("T2.4.3 State merged", async () => {
  installMockSupabase([
    plantedPlot("plot_1", { plantedAt: NOW - 1_000 }),
  ]);

  const result = await withMockedNow(
    NOW,
    () => getFarmState("player-001"),
  );
  const plot = result.plots[0] as EnrichedPlot;

  assert("state" in plot, "has state");
  assert("timeRemainingSeconds" in plot, "has timeRemainingSeconds");
  assert("isStealable" in plot, "has isStealable");
  assert("yieldMultiplier" in plot, "has yieldMultiplier");
  assert("canWater" in plot, "has canWater");
});

Deno.test("T2.4.4 Server timestamp", async () => {
  installMockSupabase([emptyPlot("plot_1")]);

  const before = Math.floor(Date.now() / 1000);
  const result = await getFarmState("player-001");
  const after = Math.floor(Date.now() / 1000);

  assert(
    result.serverTimestamp >= before - 2 && result.serverTimestamp <= after + 2,
    "serverTimestamp within 2s",
  );
});

Deno.test("T2.4.5 12 plots", async () => {
  installMockSupabase(
    Array.from({ length: 12 }, (_, idx) => emptyPlot(`plot_${idx + 1}`)),
  );

  const result = await withMockedNow(
    NOW,
    () => getFarmState("player-001"),
  );

  assertEquals(result.totalPlots, 12, "totalPlots");
});

Deno.test("T2.4.6 plotsReady counts RIPE+STEALABLE", async () => {
  installMockSupabase([
    plantedPlot("plot_1", { plantedAt: NOW - 3_600 }),
    plantedPlot("plot_2", { plantedAt: NOW - 3_630 }),
    plantedPlot("plot_3", { plantedAt: NOW - 3_661 }),
  ]);

  const result = await withMockedNow(
    NOW,
    () => getFarmState("player-001"),
  );

  assertEquals(result.plotsReady, 3, "plotsReady");
});

Deno.test("T2.4.7 Query limit", async () => {
  const database = installMockSupabase([
    plantedPlot("plot_1", { plantedAt: NOW - 1_000 }),
    plantedPlot("plot_2", {
      cropId: "crop_wheat",
      plantedAt: NOW - 1_000,
    }),
    emptyPlot("plot_3"),
  ]);

  const result: FarmStateResponse = await withMockedNow(
    NOW,
    () => getFarmState("player-001"),
  );

  assertEquals(result.totalPlots, 3, "totalPlots");
  assert(database.queryCount <= 2, "maximum 2 Supabase queries");
});
