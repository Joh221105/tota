import { CROP_IDS, getAllCropConfigs, getCropConfig } from "./crops.ts";
import { setSupabaseAdminForTesting } from "./supabase.ts";

type TableName = "game_config";

interface GameConfigRow {
  key: string;
  value: string;
}

interface MockDatabase {
  game_config: GameConfigRow[];
  queryLog: Array<
    { table: string; method: "maybeSingle" | "in"; keys: string[] }
  >;
}

const CROP_CONFIG_FIXTURES: Record<string, Record<string, unknown>> = {
  crop_lettuce: {
    growTimeSeconds: 3600,
    seedCostCoins: 5,
    isPerpetual: false,
    unlockLevel: 1,
    baseYieldMin: 6,
    baseYieldMax: 10,
  },
  crop_tomato: {
    growTimeSeconds: 7200,
    seedCostCoins: 10,
    isPerpetual: false,
    unlockLevel: 1,
    baseYieldMin: 5,
    baseYieldMax: 8,
  },
  crop_cucumber: {
    growTimeSeconds: 7200,
    seedCostCoins: 10,
    isPerpetual: false,
    unlockLevel: 3,
    baseYieldMin: 5,
    baseYieldMax: 8,
  },
  crop_onion: {
    growTimeSeconds: 14400,
    seedCostCoins: 15,
    isPerpetual: false,
    unlockLevel: 2,
    baseYieldMin: 5,
    baseYieldMax: 9,
  },
  crop_wheat: {
    growTimeSeconds: 14400,
    seedCostCoins: 15,
    isPerpetual: false,
    unlockLevel: 1,
    baseYieldMin: 6,
    baseYieldMax: 10,
  },
  crop_potato: {
    growTimeSeconds: 21600,
    seedCostCoins: 20,
    isPerpetual: false,
    unlockLevel: 4,
    baseYieldMin: 4,
    baseYieldMax: 7,
  },
  crop_jalapeno: {
    growTimeSeconds: 28800,
    seedCostCoins: 35,
    isPerpetual: false,
    unlockLevel: 8,
    baseYieldMin: 3,
    baseYieldMax: 5,
  },
  crop_sesame: {
    growTimeSeconds: 43200,
    seedCostCoins: 45,
    isPerpetual: false,
    unlockLevel: 12,
    baseYieldMin: 3,
    baseYieldMax: 4,
  },
  crop_strawberry: {
    growTimeSeconds: 14400,
    regrowTimeSeconds: 7200,
    seedCostCoins: 60,
    isPerpetual: true,
    unlockLevel: 6,
    baseYieldMin: 10,
    baseYieldMax: 16,
  },
  crop_blueberry: {
    growTimeSeconds: 14400,
    regrowTimeSeconds: 7200,
    seedCostCoins: 60,
    isPerpetual: true,
    unlockLevel: 10,
    baseYieldMin: 8,
    baseYieldMax: 12,
  },
  crop_herb: {
    growTimeSeconds: 10800,
    regrowTimeSeconds: 5400,
    seedCostCoins: 40,
    isPerpetual: true,
    unlockLevel: 8,
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
 * Builds a mock game_config database with crop fixture rows.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(): MockDatabase {
  return {
    game_config: Object.entries(CROP_CONFIG_FIXTURES).map(([key, value]) => ({
      key,
      value: JSON.stringify(value),
    })),
    queryLog: [],
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
   * Resolves a filtered single-row query.
   * @returns Query result with zero or one row.
   * @throws Never.
   */
  maybeSingle(): Promise<
    { data: Record<string, unknown> | null; error: null }
  > {
    const rows = this.matchingRows();
    this.database.queryLog.push({
      table: this.table,
      method: "maybeSingle",
      keys: rows.map((row) => String(row.key)),
    });
    return Promise.resolve({
      data: rows.length > 0 ? this.projectRow(rows[0]) : null,
      error: null,
    });
  }

  /**
   * Resolves a filtered multi-row query.
   * @param column - Column name for membership matching.
   * @param values - Accepted values.
   * @returns Query result with all matching rows.
   * @throws Never.
   */
  in(
    column: string,
    values: string[],
  ): Promise<{ data: Record<string, unknown>[]; error: null }> {
    const rows = this.tableRows().filter((row) =>
      values.includes(String(row[column]))
    );
    this.database.queryLog.push({
      table: this.table,
      method: "in",
      keys: clone(values),
    });
    return Promise.resolve({
      data: rows.map((row) => this.projectRow(row)),
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
 * @returns Mock database backing the client.
 * @throws Never.
 */
function installMockSupabase(): MockDatabase {
  const database = buildMockDatabase();
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

Deno.test("T2.1.1 wheat config has expected core values", async () => {
  installMockSupabase();
  const config = await getCropConfig("crop_wheat");

  assertEquals(config.growTimeSeconds, 14400, "grow time");
  assertEquals(config.seedCostCoins, 15, "seed cost");
  assertEquals(config.isPerpetual, false, "is perpetual");
  assertEquals(config.unlockLevel, 1, "unlock level");
});

Deno.test("T2.1.2 strawberry config has regrow and perpetual values", async () => {
  installMockSupabase();
  const config = await getCropConfig("crop_strawberry");

  assertEquals(config.regrowTimeSeconds, 7200, "regrow time");
  assertEquals(config.isPerpetual, true, "is perpetual");
  assertEquals(config.unlockLevel, 6, "unlock level");
});

Deno.test("T2.1.3 all crops are available in all seasons", async () => {
  installMockSupabase();
  const configs = await getAllCropConfigs();

  assert(
    configs.every((config) => config.seasonAvailability === "all_seasons"),
    "all crop configs should have all_seasons availability",
  );
});

Deno.test("T2.1.4 all crop config returns exactly 11 items in one query", async () => {
  const database = installMockSupabase();
  const configs = await getAllCropConfigs();

  assertEquals(configs.length, 11, "crop count");
  assertEquals(database.queryLog.length, 1, "query count");
  assertEquals(database.queryLog[0].method, "in", "batch method");
  assertEquals(database.queryLog[0].keys, [...CROP_IDS], "queried crop keys");
});

Deno.test("T2.1.5 invalid crop throws CROP_NOT_FOUND with crop id", async () => {
  installMockSupabase();

  await assertRejectsWithMessage(
    () => getCropConfig("crop_invalid"),
    "CROP_NOT_FOUND:crop_invalid",
  );
});

Deno.test("T2.1.6 jalapeno config has expected grow time and unlock level", async () => {
  installMockSupabase();
  const config = await getCropConfig("crop_jalapeno");

  assertEquals(config.growTimeSeconds, 28800, "grow time");
  assertEquals(config.unlockLevel, 8, "unlock level");
});

Deno.test("T2.1.7 sesame config is slowest and unlocks at level 12", async () => {
  installMockSupabase();
  const config = await getCropConfig("crop_sesame");

  assertEquals(config.growTimeSeconds, 43200, "grow time");
  assertEquals(config.unlockLevel, 12, "unlock level");
});

Deno.test("T2.1.8 annual tomato crop has null regrow time", async () => {
  installMockSupabase();
  const config = await getCropConfig("crop_tomato");

  assertEquals(config.regrowTimeSeconds, null, "regrow time");
});

Deno.test("T2.1.9 wheat numeric fields are returned as numbers", async () => {
  installMockSupabase();
  const config = await getCropConfig("crop_wheat");

  assertEquals(typeof config.growTimeSeconds, "number", "grow time type");
});
