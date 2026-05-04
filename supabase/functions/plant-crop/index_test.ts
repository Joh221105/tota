import { type FarmPlot, plantCrop } from "./index.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";

type TableName = "players" | "game_config" | "coin_transactions";

interface PlayerRow {
  id: string;
  level: number;
  coins: number;
  farm_plots: FarmPlot[];
}

interface GameConfigRow {
  key: string;
  value: string;
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
  coin_transactions: CoinTransactionRow[];
  rpcCalls: Array<{ functionName: string; params: Record<string, unknown> }>;
}

interface MockQueryResult {
  data: Record<string, unknown> | Array<Record<string, unknown>> | null;
  error: { message: string } | null;
}

const CROP_CONFIG_FIXTURES: Record<string, Record<string, unknown>> = {
  crop_tomato: {
    growTimeSeconds: 7200,
    seedCostCoins: 10,
    isPerpetual: false,
    unlockLevel: 1,
    baseYieldMin: 5,
    baseYieldMax: 8,
  },
  crop_jalapeno: {
    growTimeSeconds: 28800,
    seedCostCoins: 35,
    isPerpetual: false,
    unlockLevel: 8,
    baseYieldMin: 3,
    baseYieldMax: 5,
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
  crop_wheat: {
    growTimeSeconds: 14400,
    seedCostCoins: 15,
    isPerpetual: false,
    unlockLevel: 1,
    baseYieldMin: 6,
    baseYieldMax: 10,
  },
  crop_lettuce: {
    growTimeSeconds: 3600,
    seedCostCoins: 5,
    isPerpetual: false,
    unlockLevel: 1,
    baseYieldMin: 1,
    baseYieldMax: 1,
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
 * Builds a mock plant-crop database.
 * @param values - Optional player row overrides.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(values: Partial<PlayerRow> = {}): MockDatabase {
  return {
    players: [{
      id: "player-001",
      level: 5,
      coins: 100,
      farm_plots: [emptyPlot("plot_1"), emptyPlot("plot_2")],
      ...clone(values),
    }],
    game_config: [
      { key: "STEAL_POOL_PERCENT", value: "0.40" },
      ...Object.entries(CROP_CONFIG_FIXTURES).map(([key, value]) => ({
        key,
        value: JSON.stringify(value),
      })),
    ],
    coin_transactions: [],
    rpcCalls: [],
  };
}

/**
 * Runs an action with Math.random mocked to a fixed value.
 * @param value - Fixed random value to return.
 * @param action - Action to run while mocked.
 * @returns Action result.
 * @throws Any error thrown by action.
 */
async function withMockedRandom<T>(
  value: number,
  action: () => Promise<T>,
): Promise<T> {
  const originalRandom = Math.random;
  Object.defineProperty(Math, "random", {
    value: () => value,
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
  ): Promise<
    { data: Record<string, unknown> | null; error: { message: string } | null }
  > {
    this.database.rpcCalls.push({ functionName, params: clone(params) });
    if (functionName !== "debit_coins") {
      return {
        data: null,
        error: { message: `RPC_NOT_FOUND:${functionName}` },
      };
    }

    const playerId = String(params.p_player_id);
    const amount = Number(params.p_amount);
    const player = this.database.players.find((row) => row.id === playerId);
    if (!player) {
      return { data: null, error: { message: `PLAYER_NOT_FOUND:${playerId}` } };
    }
    if (player.coins < amount) {
      return {
        data: null,
        error: { message: `INSUFFICIENT_FUNDS:${player.coins}:${amount}` },
      };
    }

    const balanceBefore = player.coins;
    const balanceAfter = balanceBefore - amount;
    const transaction = {
      id: `txn-${
        String(this.database.coin_transactions.length + 1).padStart(3, "0")
      }`,
      player_id: playerId,
      direction: "DEBIT" as const,
      amount,
      transaction_type: String(params.p_transaction_type),
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      idempotency_key: String(params.p_idempotency_key),
      metadata: clone(params.p_metadata as Record<string, unknown>),
    };

    player.coins = balanceAfter;
    this.database.coin_transactions.push(transaction);
    return {
      data: {
        success: true,
        transactionId: transaction.id,
        balanceBefore,
        balanceAfter,
        idempotencyKey: transaction.idempotency_key,
      },
      error: null,
    };
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
   * Resolves a maybeSingle query.
   * @returns Query result with zero or one row.
   * @throws Never.
   */
  maybeSingle(): Promise<MockQueryResult> {
    const rows = this.matchingRows();
    return Promise.resolve({
      data: rows.length > 0 ? this.projectRow(rows[0]) : null,
      error: null,
    });
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
 * @param values - Optional player row overrides.
 * @returns Mock database backing the client.
 * @throws Never.
 */
function installMockSupabase(values: Partial<PlayerRow> = {}): MockDatabase {
  const database = buildMockDatabase(values);
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

Deno.test("T2.2.1 normal plant", async () => {
  const database = installMockSupabase({ level: 5, coins: 100 });

  const result = await plantCrop("player-001", "plot_1", "crop_tomato");

  assertEquals(result.success, true, "success");
  assertEquals(result.plot.state, "PLANTED", "plot state");
  assertEquals(result.coinsDeducted, 10, "coins deducted result");
  assertEquals(database.players[0].coins, 90, "balance after");
  assert(result.plot.yield >= 5 && result.plot.yield <= 8, "yield range");
});

Deno.test("T2.2.2 yield range", async () => {
  const randomValues = Array.from({ length: 1000 }, (_, idx) => idx / 1000);
  for (const randomValue of randomValues) {
    const database = installMockSupabase({ level: 5, coins: 100 });
    const result = await withMockedRandom(
      randomValue,
      () => plantCrop("player-001", "plot_1", "crop_tomato"),
    );

    assert(
      result.plot.yield >= 5 && result.plot.yield <= 8,
      `yield in range for ${randomValue}`,
    );
    assertEquals(database.players[0].coins, 90, "balance after");
  }
});

Deno.test("T2.2.3 steal pool yield=8", async () => {
  installMockSupabase({ level: 5, coins: 100 });

  const result = await withMockedRandom(
    0.999,
    () => plantCrop("player-001", "plot_1", "crop_tomato"),
  );

  assertEquals(result.plot.yield, 8, "yield");
  assertEquals(result.plot.stealPool, 3, "steal pool");
  assertEquals(result.plot.stealPoolRemaining, 3, "steal pool remaining");
});

Deno.test("T2.2.4 steal pool yield=10", async () => {
  installMockSupabase({ level: 5, coins: 100 });

  const result = await withMockedRandom(
    0.999,
    () => plantCrop("player-001", "plot_1", "crop_wheat"),
  );

  assertEquals(result.plot.yield, 10, "yield");
  assertEquals(result.plot.stealPool, 4, "steal pool");
});

Deno.test("T2.2.5 steal pool minimum 1", async () => {
  installMockSupabase({ level: 5, coins: 100 });

  const result = await withMockedRandom(
    0,
    () => plantCrop("player-001", "plot_1", "crop_lettuce"),
  );

  assertEquals(result.plot.yield, 1, "yield");
  assertEquals(result.plot.stealPool, 1, "steal pool");
  assertEquals(result.plot.stealPoolRemaining, 1, "steal pool remaining");
});

Deno.test("T2.2.6 plot occupied", async () => {
  const occupied = emptyPlot("plot_1");
  occupied.cropId = "crop_tomato";
  occupied.state = "PLANTED";
  const database = installMockSupabase({ farm_plots: [occupied] });
  const beforePlot = clone(database.players[0].farm_plots[0]);

  await assertRejectsWithMessage(
    () => plantCrop("player-001", "plot_1", "crop_tomato"),
    "PLOT_OCCUPIED:plot_1",
  );

  assertEquals(database.players[0].coins, 100, "balance unchanged");
  assertEquals(database.players[0].farm_plots[0], beforePlot, "plot unchanged");
  assertEquals(database.rpcCalls.length, 0, "no debit rpc");
});

Deno.test("T2.2.7 insufficient coins", async () => {
  const database = installMockSupabase({ coins: 5 });
  const beforePlot = clone(database.players[0].farm_plots[0]);

  await assertRejectsWithMessage(
    () => plantCrop("player-001", "plot_1", "crop_tomato"),
    "INSUFFICIENT_FUNDS",
  );

  assertEquals(database.players[0].coins, 5, "balance unchanged");
  assertEquals(database.players[0].farm_plots[0], beforePlot, "plot unchanged");
  assertEquals(database.rpcCalls.length, 0, "no debit rpc");
});

Deno.test("T2.2.8 crop not unlocked", async () => {
  const database = installMockSupabase({ level: 2, coins: 100 });

  await assertRejectsWithMessage(
    () => plantCrop("player-001", "plot_1", "crop_jalapeno"),
    "CROP_NOT_UNLOCKED:crop_jalapeno",
  );

  assertEquals(database.players[0].coins, 100, "balance unchanged");
  assertEquals(database.rpcCalls.length, 0, "no debit rpc");
});

Deno.test("T2.2.9 plantedAt is server time", async () => {
  installMockSupabase({ level: 5, coins: 100 });
  const before = Math.floor(Date.now() / 1000);

  const result = await plantCrop("player-001", "plot_1", "crop_tomato");

  const after = Math.floor(Date.now() / 1000);
  assert(result.plot.plantedAt >= before - 2, "plantedAt after lower bound");
  assert(result.plot.plantedAt <= after + 2, "plantedAt before upper bound");
});

Deno.test("T2.2.10 all booleans false", async () => {
  installMockSupabase({ level: 5, coins: 100 });

  const result = await plantCrop("player-001", "plot_1", "crop_tomato");

  assertEquals(result.plot.hasBugs, false, "hasBugs");
  assertEquals(result.plot.hasWeeds, false, "hasWeeds");
  assertEquals(result.plot.fertilised, false, "fertilised");
  assertEquals(
    result.plot.isPerpetualRegrowing,
    false,
    "isPerpetualRegrowing",
  );
  assertEquals(result.plot.needsWater, false, "needsWater");
});

Deno.test("T2.2.11 perpetual crop plant", async () => {
  installMockSupabase({ level: 6, coins: 100 });

  const result = await plantCrop("player-001", "plot_1", "crop_strawberry");

  assertEquals(result.plot.isPerpetualRegrowing, false, "regrowing");
  assertEquals(result.plot.needsWater, false, "needs water");
  assertEquals(result.plot.state, "PLANTED", "plot state");
});

Deno.test("T2.2.12 invalid crop ID", async () => {
  const database = installMockSupabase({ level: 5, coins: 100 });

  await assertRejectsWithMessage(
    () => plantCrop("player-001", "plot_1", "crop_unicorn"),
    "CROP_NOT_FOUND:crop_unicorn",
  );

  assertEquals(database.players[0].coins, 100, "balance unchanged");
  assertEquals(database.rpcCalls.length, 0, "no debit rpc");
});
