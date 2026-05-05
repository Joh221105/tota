import {
  collectAnimalProduce,
  feedAnimal,
  getAnimalActionStubCallsForTesting,
  resetAnimalActionStubsForTesting,
} from "./index.ts";
import { type AnimalRecord } from "../_lib/animals.ts";
import { setSupabaseAdminForTesting } from "../_lib/supabase.ts";

type TableName = "players" | "game_config" | "inventory" | "coin_transactions";

interface PlayerRow {
  id: string;
  coins: number;
  animals: Record<string, AnimalRecord>;
  skills: { ranching?: { level?: number } };
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
  direction: "DEBIT";
  amount: number;
  transaction_type: string;
  balance_before: number;
  balance_after: number;
  idempotency_key: string;
  metadata: Record<string, unknown>;
}

interface MockDatabase {
  players: PlayerRow[];
  game_config: GameConfigRow[];
  inventory: InventoryRow[];
  coin_transactions: CoinTransactionRow[];
  rpcCalls: Array<{ functionName: string; params: Record<string, unknown> }>;
}

const NOW = 1_000_000;

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

const GRADE_CONFIGS: Record<string, string> = {
  GRADE_NORMAL_RATE: "0.58",
  GRADE_BRONZE_RATE: "0.25",
  GRADE_SILVER_RATE: "0.12",
  GRADE_GOLD_RATE: "0.04",
  GRADE_DIAMOND_RATE: "0.01",
  GRADE_LEGENDARY_RATE: "0.001",
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
 * Creates an animal record for tests.
 * @param overrides - Optional animal field overrides.
 * @returns Animal record.
 * @throws Never.
 */
function animal(overrides: Partial<AnimalRecord> = {}): AnimalRecord {
  return {
    animalId: "cow-1",
    animalType: "cow",
    lastFedTimestamp: NOW,
    lastCollectTimestamps: {},
    ...clone(overrides),
  };
}

/**
 * Builds a mock animal action database.
 * @param overrides - Optional player and config overrides.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(overrides: {
  owner?: Partial<PlayerRow>;
  feeder?: Partial<PlayerRow>;
  gameConfig?: Record<string, unknown>;
  inventory?: InventoryRow[];
} = {}): MockDatabase {
  const gameConfigMap = new Map<string, string>();
  gameConfigMap.set("OFFLINE_CAP_SECONDS", "57600");
  for (const [key, value] of Object.entries(GRADE_CONFIGS)) {
    gameConfigMap.set(key, value);
  }
  for (const [key, value] of Object.entries(ANIMAL_CONFIG_FIXTURES)) {
    gameConfigMap.set(key, JSON.stringify(value));
  }
  for (const [key, value] of Object.entries(overrides.gameConfig ?? {})) {
    gameConfigMap.set(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }
  const gameConfigRows: GameConfigRow[] = [...gameConfigMap.entries()].map((
    [key, value],
  ) => ({ key, value }));

  return {
    players: [
      {
        id: "owner-001",
        coins: 100,
        animals: { "cow-1": animal() },
        skills: { ranching: { level: 0 } },
        inventory_slots: { animal_produce: 200, tools: 200 },
        ...clone(overrides.owner ?? {}),
      },
      {
        id: "feeder-001",
        coins: 100,
        animals: {},
        skills: { ranching: { level: 0 } },
        inventory_slots: { animal_produce: 200, tools: 200 },
        ...clone(overrides.feeder ?? {}),
      },
    ],
    game_config: gameConfigRows,
    inventory: clone(overrides.inventory ?? []),
    coin_transactions: [],
    rpcCalls: [],
  };
}

/**
 * Runs an action with Date.now mocked to NOW.
 * @param action - Action to run while time is mocked.
 * @returns Action result.
 * @throws Any error thrown by action.
 */
async function withMockedNow<T>(action: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  Object.defineProperty(Date, "now", {
    value: () => NOW * 1000,
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
 * Runs an action with Math.random returning a sequence of values.
 * @param values - Sequence of random values to return.
 * @param action - Action to run while random is mocked.
 * @returns Action result.
 * @throws Any error thrown by action.
 */
async function withMockedRandom<T>(
  values: number[],
  action: () => Promise<T>,
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

  /**
   * Executes a mock Postgres RPC.
   * @param functionName - RPC function name.
   * @param params - RPC parameters.
   * @returns RPC result.
   * @throws Never.
   */
  async rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown> | null; error: null }> {
    this.database.rpcCalls.push({ functionName, params: clone(params) });
    const playerId = String(params.p_player_id);
    const amount = Number(params.p_amount);
    const player = this.database.players.find((row) => row.id === playerId);
    if (!player) {
      return {
        data: null,
        error: null,
      };
    }

    const balanceBefore = player.coins;
    player.coins -= amount;
    const row: CoinTransactionRow = {
      id: `tx-${this.database.coin_transactions.length + 1}`,
      player_id: playerId,
      direction: "DEBIT",
      amount,
      transaction_type: String(params.p_transaction_type),
      balance_before: balanceBefore,
      balance_after: player.coins,
      idempotency_key: String(params.p_idempotency_key),
      metadata: clone(
        (params.p_metadata ?? {}) as Record<string, unknown>,
      ),
    };
    this.database.coin_transactions.push(row);
    return {
      data: {
        success: true,
        transactionId: row.id,
        balanceBefore: row.balance_before,
        balanceAfter: row.balance_after,
        idempotencyKey: row.idempotency_key,
      },
      error: null,
    };
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
   * Adds a membership filter.
   * @param column - Column name.
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
    return Promise.resolve({
      data: rows.map((row) => this.projectRow(row)),
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
   * Records a delete operation.
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
    const row = this.applyMutationAndReturnFirst();
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
    void onrejected;
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
   * Applies an insert, update, or delete and returns the first affected row.
   * @returns First affected row.
   * @throws Never.
   */
  private applyMutationAndReturnFirst(): Record<string, unknown> | null {
    return this.applyMutationAndReturnRows()[0] ?? null;
  }

  /**
   * Applies an insert, update, or delete and returns affected or matching rows.
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
      for (const row of rows) {
        const index = tableRows.indexOf(row);
        if (index >= 0) tableRows.splice(index, 1);
      }
      return rows;
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
  resetAnimalActionStubsForTesting();
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

Deno.test("T3.2.1 Feed SAD cow owner updates timestamp and deducts 5g", async () => {
  const database = installMockSupabase(buildMockDatabase({
    owner: {
      animals: {
        "cow-1": animal({ lastFedTimestamp: NOW - 32400 }),
      },
    },
  }));

  const result = await withMockedNow(() =>
    feedAnimal("owner-001", "owner-001", "cow-1")
  );

  assertEquals(result, {
    success: true,
    newHappiness: "HAPPY",
    feederRewarded: false,
  }, "feed result");
  assertEquals(
    database.players[0].animals["cow-1"].lastFedTimestamp,
    NOW,
    "last fed",
  );
  assertEquals(database.players[0].coins, 95, "owner coins");
});

Deno.test("T3.2.2 Feed HAPPY still updates timestamp and deducts cost", async () => {
  const database = installMockSupabase(buildMockDatabase({
    owner: {
      animals: {
        "cow-1": animal({ lastFedTimestamp: NOW - 100 }),
      },
    },
  }));

  await withMockedNow(() => feedAnimal("owner-001", "owner-001", "cow-1"));

  assertEquals(
    database.players[0].animals["cow-1"].lastFedTimestamp,
    NOW,
    "last fed",
  );
  assertEquals(database.players[0].coins, 95, "owner coins");
});

Deno.test("T3.2.3 Friend feed uses owner hay before coins", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: [{
      id: "hay-1",
      player_id: "owner-001",
      item_id: "animal_hay",
      grade: "Normal",
      quantity: 1,
      category: "animal_produce",
    }],
  }));

  await withMockedRandom(
    [0.9],
    () => withMockedNow(() => feedAnimal("feeder-001", "owner-001", "cow-1")),
  );

  assertEquals(database.inventory.length, 0, "hay consumed");
  assertEquals(database.players[1].coins, 100, "feeder coins");
  assertEquals(database.coin_transactions.length, 0, "coin tx count");
});

Deno.test("T3.2.4 Friend no hay makes feeder pay", async () => {
  const database = installMockSupabase(buildMockDatabase());

  await withMockedRandom(
    [0.9],
    () => withMockedNow(() => feedAnimal("feeder-001", "owner-001", "cow-1")),
  );

  assertEquals(database.players[1].coins, 95, "feeder coins");
  assertEquals(database.coin_transactions[0].amount, 5, "debit amount");
  assertEquals(database.coin_transactions[0].player_id, "feeder-001", "payer");
});

Deno.test("T3.2.5 Friend feed awards feeder XP", async () => {
  installMockSupabase(buildMockDatabase());

  await withMockedRandom(
    [0.9],
    () => withMockedNow(() => feedAnimal("feeder-001", "owner-001", "cow-1")),
  );

  const calls = getAnimalActionStubCallsForTesting();
  assertEquals(calls.xpAwards, [{
    playerId: "feeder-001",
    amount: 15,
    source: "FEED_ANIMAL",
  }], "xp calls");
});

Deno.test("T3.2.6 HAPPY cow collect one cycle returns beef and XP", async () => {
  const database = installMockSupabase(buildMockDatabase({
    owner: {
      animals: {
        "cow-1": animal({
          lastFedTimestamp: NOW,
          lastCollectTimestamps: { animal_beef: NOW - 28800 },
        }),
      },
    },
  }));

  const result = await withMockedRandom(
    [0, 0.99],
    () =>
      withMockedNow(() =>
        collectAnimalProduce("owner-001", "cow-1", "animal_beef")
      ),
  );

  assertEquals(result.cycles, 1, "cycles");
  assertEquals(result.itemsCollected[0].itemId, "animal_beef", "item");
  assert(result.itemsCollected[0].quantity >= 2, "quantity minimum");
  assert(result.itemsCollected[0].quantity <= 3, "quantity maximum");
  assertEquals(result.xpAwarded, 15, "xp");
  assertEquals(
    database.players[0].animals["cow-1"].lastCollectTimestamps.animal_beef,
    NOW,
    "last collect",
  );
});

Deno.test("T3.2.7 SAD cow collect halves yield and only Normal or Bronze", async () => {
  installMockSupabase(buildMockDatabase({
    owner: {
      animals: {
        "cow-1": animal({
          lastFedTimestamp: NOW - 32400,
          lastCollectTimestamps: { animal_beef: NOW - 28800 },
        }),
      },
    },
  }));

  const result = await withMockedRandom(
    [0.99, 0.8],
    () =>
      withMockedNow(() =>
        collectAnimalProduce("owner-001", "cow-1", "animal_beef")
      ),
  );

  assertEquals(result.happiness, "SAD", "happiness");
  assertEquals(result.itemsCollected[0].quantity, 1, "sad quantity");
  assert(
    ["Normal", "Bronze"].includes(result.itemsCollected[0].grade),
    "sad grade",
  );
});

Deno.test("T3.2.8 NEGLECTED animal throws no produce error", async () => {
  installMockSupabase(buildMockDatabase({
    owner: {
      animals: {
        "cow-1": animal({
          lastFedTimestamp: NOW - 61200,
          lastCollectTimestamps: { animal_beef: NOW - 28800 },
        }),
      },
    },
  }));

  await withMockedNow(() =>
    assertRejectsWithMessage(
      () => collectAnimalProduce("owner-001", "cow-1", "animal_beef"),
      "NEGLECTED_NO_PRODUCE:cow-1",
    )
  );
});

Deno.test("T3.2.9 Collect too early throws remaining seconds", async () => {
  installMockSupabase(buildMockDatabase({
    owner: {
      animals: {
        "cow-1": animal({
          lastFedTimestamp: NOW,
          lastCollectTimestamps: { animal_beef: NOW - 10000 },
        }),
      },
    },
  }));

  await withMockedNow(() =>
    assertRejectsWithMessage(
      () => collectAnimalProduce("owner-001", "cow-1", "animal_beef"),
      "PRODUCE_NOT_READY:18800",
    )
  );
});

Deno.test("T3.2.10 Multi-cycle collect returns three yield entries", async () => {
  installMockSupabase(buildMockDatabase({
    owner: {
      animals: {
        "cow-1": animal({
          lastFedTimestamp: NOW,
          lastCollectTimestamps: { animal_beef: NOW - 86400 },
        }),
      },
    },
    gameConfig: { OFFLINE_CAP_SECONDS: "86400" },
  }));

  const result = await withMockedRandom(
    [0, 0.99],
    () =>
      withMockedNow(() =>
        collectAnimalProduce("owner-001", "cow-1", "animal_beef")
      ),
  );

  assertEquals(result.cycles, 3, "cycles");
  assertEquals(result.itemsCollected.length, 3, "entries");
});

Deno.test("T3.2.11 Offline cap limits 24h cow beef to two cycles", async () => {
  installMockSupabase(buildMockDatabase({
    owner: {
      animals: {
        "cow-1": animal({
          lastFedTimestamp: NOW,
          lastCollectTimestamps: { animal_beef: NOW - 86400 },
        }),
      },
    },
  }));

  const result = await withMockedRandom(
    [0, 0.99],
    () =>
      withMockedNow(() =>
        collectAnimalProduce("owner-001", "cow-1", "animal_beef")
      ),
  );

  assertEquals(result.cycles, 2, "cycles");
});

Deno.test("T3.2.12 Egg collection feather drop rate is near 15 percent", async () => {
  const chickenConfig = clone(ANIMAL_CONFIG_FIXTURES.animal_chicken);
  (chickenConfig.products as Array<Record<string, unknown>>)[0]
    .produceTimerSeconds = 1;
  (chickenConfig.products as Array<Record<string, unknown>>)[0].yieldMin = 1;
  (chickenConfig.products as Array<Record<string, unknown>>)[0].yieldMax = 1;
  const randomValues: number[] = [];
  for (let index = 0; index < 1000; index += 1) {
    randomValues.push(
      0,
      index % 2 === 0 ? 0.9 : 0.3,
      index < 150 ? 0.01 : 0.99,
    );
  }
  const database = installMockSupabase(buildMockDatabase({
    owner: {
      animals: {
        "chicken-1": animal({
          animalId: "chicken-1",
          animalType: "chicken",
          lastFedTimestamp: NOW,
          lastCollectTimestamps: { animal_egg: NOW - 1000 },
        }),
      },
    },
    gameConfig: {
      OFFLINE_CAP_SECONDS: "1000",
      animal_chicken: chickenConfig,
    },
  }));

  const result = await withMockedRandom(
    randomValues,
    () =>
      withMockedNow(() =>
        collectAnimalProduce("owner-001", "chicken-1", "animal_egg")
      ),
  );

  const dropRate = result.feathersDropped / result.cycles;
  assertEquals(result.cycles, 1000, "cycles");
  assert(dropRate >= 0.11 && dropRate <= 0.19, "drop rate tolerance");
  const featherStack = database.inventory.find((row) =>
    row.item_id === "animal_feather"
  );
  assertEquals(featherStack?.quantity, 150, "feather quantity");
});

Deno.test("T3.2.13 XP scales with cycles", async () => {
  installMockSupabase(buildMockDatabase({
    owner: {
      animals: {
        "cow-1": animal({
          lastFedTimestamp: NOW,
          lastCollectTimestamps: { animal_beef: NOW - 57600 },
        }),
      },
    },
  }));

  const result = await withMockedRandom(
    [0, 0.99],
    () =>
      withMockedNow(() =>
        collectAnimalProduce("owner-001", "cow-1", "animal_beef")
      ),
  );
  const calls = getAnimalActionStubCallsForTesting();

  assertEquals(result.xpAwarded, 30, "xp awarded");
  assertEquals(calls.xpAwards[0].amount, 30, "xp stub amount");
  assertEquals(calls.skillXpAwards[0], {
    playerId: "owner-001",
    skillTrack: "ranching",
    amount: 30,
  }, "skill xp stub");
});
