import { calculateAnimalHappiness, getAnimalConfig } from "./animals.ts";
import { setSupabaseAdminForTesting } from "./supabase.ts";

type TableName = "game_config";

interface GameConfigRow {
  key: string;
  value: string;
}

interface MockDatabase {
  game_config: GameConfigRow[];
  queryLog: Array<{ table: string; method: "maybeSingle"; keys: string[] }>;
}

const ANIMAL_CONFIG_FIXTURES: Record<string, Record<string, unknown>> = {
  animal_cow: {
    animalType: "cow",
    displayName: "Cow",
    feedIntervalSeconds: 28800,
    feedCostCoins: 5,
    feedItemId: "animal_hay",
    unlockLevel: 1,
    products: [
      {
        itemId: "animal_beef",
        produceTimerSeconds: 28800,
        yieldMin: 2,
        yieldMax: 3,
        dropChance: 1.0,
      },
      {
        itemId: "animal_milk",
        produceTimerSeconds: 18000,
        yieldMin: 2,
        yieldMax: 3,
        dropChance: 1.0,
      },
    ],
  },
  animal_chicken: {
    animalType: "chicken",
    displayName: "Chicken",
    feedIntervalSeconds: 28800,
    feedCostCoins: 3,
    feedItemId: "animal_grain",
    unlockLevel: 3,
    products: [
      {
        itemId: "animal_egg",
        produceTimerSeconds: 10800,
        yieldMin: 2,
        yieldMax: 4,
        dropChance: 1.0,
      },
      {
        itemId: "animal_feather",
        produceTimerSeconds: 10800,
        yieldMin: 1,
        yieldMax: 1,
        dropChance: 0.15,
      },
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
 * Builds a mock game_config database with animal fixture rows.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(): MockDatabase {
  return {
    game_config: Object.entries(ANIMAL_CONFIG_FIXTURES).map(([key, value]) => ({
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

Deno.test("T3.1.1 cow config has expected feed values and products", async () => {
  installMockSupabase();
  const config = await getAnimalConfig("cow");

  assertEquals(config.feedIntervalSeconds, 28800, "feed interval");
  assertEquals(config.feedCostCoins, 5, "feed cost");
  assertEquals(config.products.length, 2, "product count");
});

Deno.test("T3.1.2 chicken feather has expected drop chance", async () => {
  installMockSupabase();
  const config = await getAnimalConfig("chicken");
  const feather = config.products.find((product) =>
    product.itemId === "animal_feather"
  );

  assertEquals(feather?.dropChance, 0.15, "feather drop chance");
});

Deno.test("T3.1.3 V2 animal throws ANIMAL_NOT_FOUND", async () => {
  installMockSupabase();

  await assertRejectsWithMessage(
    () => getAnimalConfig("pig"),
    "ANIMAL_NOT_FOUND:pig",
  );
});

Deno.test("T3.1.4 HAPPY when fed 7h ago", () => {
  assertEquals(
    calculateAnimalHappiness(100000 - 25200, 100000, 28800),
    "HAPPY",
    "happiness",
  );
});

Deno.test("T3.1.5 HAPPY at feed interval boundary", () => {
  assertEquals(
    calculateAnimalHappiness(100000 - 28800, 100000, 28800),
    "HAPPY",
    "happiness",
  );
});

Deno.test("T3.1.6 SAD when fed 9h ago", () => {
  assertEquals(
    calculateAnimalHappiness(100000 - 32400, 100000, 28800),
    "SAD",
    "happiness",
  );
});

Deno.test("T3.1.7 SAD at 2x feed interval boundary", () => {
  assertEquals(
    calculateAnimalHappiness(100000 - 57600, 100000, 28800),
    "SAD",
    "happiness",
  );
});

Deno.test("T3.1.8 NEGLECTED after 17h", () => {
  assertEquals(
    calculateAnimalHappiness(100000 - 61200, 100000, 28800),
    "NEGLECTED",
    "happiness",
  );
});

Deno.test("T3.1.9 HAPPY when just fed", () => {
  assertEquals(
    calculateAnimalHappiness(100000, 100000, 28800),
    "HAPPY",
    "happiness",
  );
});

Deno.test("T3.1.10 calculateAnimalHappiness is pure and makes zero Supabase calls", () => {
  const database = installMockSupabase();

  for (let index = 0; index < 100; index += 1) {
    calculateAnimalHappiness(100000 - index, 100000, 28800);
  }

  assertEquals(database.queryLog.length, 0, "query count");
});
