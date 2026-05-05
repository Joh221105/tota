import type { FarmPlot } from "../_lib/farm.ts";
import { setSupabaseAdminForTesting } from "../_lib/supabase.ts";
import {
  getFarmPestStubCallsForTesting,
  plantPestBySabotage,
  removePest,
  resetFarmPestStubsForTesting,
  spawnPestCheck,
  waterForRegrow,
} from "./index.ts";

type TableName = "players" | "game_config" | "coin_transactions" | "inventory";

interface PlayerRow {
  id: string;
  farm_plots: FarmPlot[];
  sabotage_log: Array<
    { targetId: string; pestType: string; timestamp: number }
  >;
  neighbour_score: number;
  coins: number;
  inventory_slots: Record<string, number>;
}

interface GameConfigRow {
  key: string;
  value: string;
}

interface CoinTransactionRow {
  id: string;
  player_id: string;
  balance_before: number;
  balance_after: number;
  idempotency_key: string;
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
  coin_transactions: CoinTransactionRow[];
  inventory: InventoryRow[];
}

interface MockQueryResult {
  data: Record<string, unknown> | Array<Record<string, unknown>> | null;
  error: { message: string } | null;
  count?: number | null;
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
 * Runs an action with Math.random mocked to a value sequence.
 * @param values - Random values to return in order.
 * @param action - Action to run while Math.random is mocked.
 * @returns Action result.
 * @throws Any error thrown by action.
 */
async function withMockedRandom<T>(
  values: number[],
  action: () => Promise<T>,
): Promise<T> {
  const originalRandom = Math.random;
  let idx = 0;
  Object.defineProperty(Math, "random", {
    value: () => values[Math.min(idx++, values.length - 1)],
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
 * Builds a growing tomato farm plot for tests.
 * @param values - Optional farm plot overrides.
 * @returns Planted farm plot.
 * @throws Never.
 */
function growingPlot(values: Partial<FarmPlot> = {}): FarmPlot {
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
 * Builds a harvested perpetual crop plot that needs water.
 * @param values - Optional farm plot overrides.
 * @returns Perpetual plot needing water.
 * @throws Never.
 */
function needsWaterPlot(values: Partial<FarmPlot> = {}): FarmPlot {
  return growingPlot({
    cropId: "crop_strawberry",
    plantedAt: NOW - 10_000,
    needsWater: true,
    yield: 12,
    stealPool: 4,
    stealPoolRemaining: 0,
    ...values,
  });
}

/**
 * Builds a mock database.
 * @param ownerPlots - Owner farm plots.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(ownerPlots: FarmPlot[]): MockDatabase {
  return {
    players: [
      {
        id: "owner-001",
        farm_plots: clone(ownerPlots),
        sabotage_log: [],
        neighbour_score: 50,
        coins: 500,
        inventory_slots: {
          crops: 20,
          fish: 10,
          animal_produce: 10,
          processed: 15,
          cooked_dishes: 10,
          tools: 10,
        },
      },
      {
        id: "friend-001",
        farm_plots: [],
        sabotage_log: [],
        neighbour_score: 50,
        coins: 500,
        inventory_slots: {
          crops: 20,
          fish: 10,
          animal_produce: 10,
          processed: 15,
          cooked_dishes: 10,
          tools: 10,
        },
      },
    ],
    game_config: [
      { key: "STEAL_WINDOW_SECONDS", value: "60" },
      { key: "OFFLINE_CAP_SECONDS", value: "57600" },
      { key: "WITHER_TIME_MULTIPLIER", value: "2.0" },
      { key: "MAX_WATERINGS_PER_CYCLE", value: "3" },
      { key: "PEST_SPAWN_CHANCE", value: "0.10" },
      { key: "SABOTAGE_COST", value: "15" },
      { key: "SABOTAGE_COOLDOWN", value: "43200" },
      { key: "SCORE_SABOTAGE_PENALTY", value: "-5" },
      { key: "STEAL_POOL_PERCENT", value: "0.40" },
      ...Object.entries(CROP_CONFIG_FIXTURES).map(([key, value]) => ({
        key,
        value: JSON.stringify(value),
      })),
    ],
    coin_transactions: [],
    inventory: [],
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

  /**
   * Executes mock RPC functions.
   * @param functionName - RPC function name.
   * @param params - RPC params.
   * @returns Mock RPC result.
   * @throws Never.
   */
  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }> {
    if (functionName !== "debit_coins") {
      return Promise.resolve({ data: null, error: { message: "unknown rpc" } });
    }

    const player = this.database.players.find((row) =>
      row.id === params.p_player_id
    );
    if (!player) {
      return Promise.resolve({
        data: null,
        error: { message: "PLAYER_NOT_FOUND:" + params.p_player_id },
      });
    }

    const amount = Number(params.p_amount);
    if (player.coins < amount) {
      return Promise.resolve({
        data: null,
        error: { message: `INSUFFICIENT_FUNDS:${player.coins}:${amount}` },
      });
    }

    const balanceBefore = player.coins;
    player.coins -= amount;
    const transaction = {
      id: "tx-" + (this.database.coin_transactions.length + 1),
      player_id: player.id,
      balance_before: balanceBefore,
      balance_after: player.coins,
      idempotency_key: String(params.p_idempotency_key),
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

class MockQueryBuilder implements PromiseLike<MockQueryResult> {
  private readonly database: MockDatabase;
  private readonly table: TableName;
  private selectedColumns = "*";
  private selectOptions: { count?: "exact"; head?: boolean } | undefined;
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
   * Records selected columns.
   * @param columns - Column list.
   * @param options - Select options.
   * @returns Current query builder.
   * @throws Never.
   */
  select(
    columns: string,
    options?: { count?: "exact"; head?: boolean },
  ): MockQueryBuilder {
    this.selectedColumns = columns;
    this.selectOptions = options;
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
   * Resolves a single query.
   * @returns Query result with one row.
   * @throws Never.
   */
  single(): Promise<MockQueryResult> {
    const result = this.execute();
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    return Promise.resolve({
      data: rows[0] ?? null,
      error: result.error,
    });
  }

  /**
   * Resolves a maybe-single query.
   * @returns Query result with zero or one row.
   * @throws Never.
   */
  maybeSingle(): Promise<MockQueryResult> {
    return this.single();
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
   * Executes the configured query or mutation.
   * @returns Mock query result.
   * @throws Never.
   */
  private execute(): MockQueryResult {
    if (this.mutation?.type === "insert") return this.executeInsert();
    if (this.mutation?.type === "update") return this.executeUpdate();
    const rows = this.matchingRows();
    return {
      data: this.selectOptions?.head
        ? []
        : rows.map((row) => this.projectRow(row)),
      error: null,
      count: this.selectOptions?.count === "exact" ? rows.length : null,
    };
  }

  /**
   * Executes an insert mutation.
   * @returns Mock query result.
   * @throws Never.
   */
  private executeInsert(): MockQueryResult {
    const row = {
      id: "inv-" + (this.database.inventory.length + 1),
      ...clone(this.mutation?.values ?? {}),
    };
    this.tableRows().push(row);
    return {
      data: [this.projectRow(row)],
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
  resetFarmPestStubsForTesting();
  return database;
}

Deno.test("T2.9.1 Pest spawn rate", async () => {
  const plots = Array.from(
    { length: 1_000 },
    (_, idx) => growingPlot({ plotId: "plot_" + idx }),
  );
  installMockSupabase(plots);
  const randomValues = [];
  for (let idx = 0; idx < 1_000; idx += 1) {
    const shouldSpawn = idx < 100;
    randomValues.push(shouldSpawn ? 0.05 : 0.95);
    if (shouldSpawn) randomValues.push(0.25);
  }

  const spawnCount = await withMockedRandom(
    randomValues,
    () =>
      withMockedNow(NOW, async () => {
        let count = 0;
        for (let idx = 0; idx < 1_000; idx += 1) {
          const result = await spawnPestCheck("owner-001", "plot_" + idx);
          if (result.pestSpawned) count += 1;
        }
        return count;
      }),
  );

  assert(spawnCount >= 70 && spawnCount <= 130, "spawn rate within 10% +/- 3%");
});

Deno.test("T2.9.2 No pest on RIPE", async () => {
  installMockSupabase([growingPlot({ plantedAt: NOW - 3_600 })]);

  const result = await withMockedNow(
    NOW,
    () => spawnPestCheck("owner-001", "plot_1"),
  );

  assertEquals(result, {
    pestSpawned: false,
    reason: "PLOT_NOT_GROWING",
  }, "result");
});

Deno.test("T2.9.3 Rate limit enforced", async () => {
  installMockSupabase([growingPlot()]);

  await withMockedRandom(
    [0.95],
    () =>
      withMockedNow(
        NOW,
        () => spawnPestCheck("owner-001", "plot_1"),
      ),
  );
  const result = await withMockedNow(
    NOW + 60,
    () => spawnPestCheck("owner-001", "plot_1"),
  );

  assertEquals(result, {
    pestSpawned: false,
    reason: "RATE_LIMITED",
  }, "result");
});

Deno.test("T2.9.4 removePest clears both", async () => {
  const database = installMockSupabase([
    growingPlot({ hasBugs: true, hasWeeds: true }),
  ]);

  const result = await removePest("owner-001", "owner-001", "plot_1");

  assertEquals(result, {
    success: true,
    bugsCleared: true,
    weedsCleared: true,
  }, "result");
  assertEquals(database.players[0].farm_plots[0].hasBugs, false, "bugs");
  assertEquals(database.players[0].farm_plots[0].hasWeeds, false, "weeds");
});

Deno.test("T2.9.5 No pest to remove", async () => {
  installMockSupabase([growingPlot({ hasBugs: false, hasWeeds: false })]);

  await assertRejectsWithMessage(
    () => removePest("owner-001", "owner-001", "plot_1"),
    "NO_PEST_PRESENT:plot_1",
  );
});

Deno.test("T2.9.6 Friend remove awards XP", async () => {
  installMockSupabase([growingPlot({ hasBugs: true })]);

  await withMockedRandom(
    [0.75],
    () => removePest("friend-001", "owner-001", "plot_1"),
  );
  const calls = getFarmPestStubCallsForTesting();

  assertEquals(calls.xpAwards, [{
    playerId: "friend-001",
    amount: 20,
    source: "REMOVE_PEST",
  }], "xp awards");
  assertEquals(calls.notifications, [{
    playerId: "owner-001",
    type: "FRIEND_REMOVED_PEST",
    data: { plotId: "plot_1" },
  }], "notifications");
  assertEquals(calls.helpActions, ["friend-001"], "help actions");
});

Deno.test("T2.9.7 Sabotage costs 15g", async () => {
  const database = installMockSupabase([growingPlot()]);

  await withMockedNow(
    NOW,
    () => plantPestBySabotage("friend-001", "owner-001", "plot_1", "bugs"),
  );

  assertEquals(database.players[1].coins, 485, "coins");
  assertEquals(database.coin_transactions[0].balance_before, 500, "before");
  assertEquals(database.coin_transactions[0].balance_after, 485, "after");
});

Deno.test("T2.9.8 Sabotage 12h cooldown", async () => {
  const database = installMockSupabase([growingPlot()]);

  await withMockedNow(
    NOW,
    () => plantPestBySabotage("friend-001", "owner-001", "plot_1", "bugs"),
  );
  // SPEC_AMBIGUITY: Listed test expects cooldown on a second same-pest call, but the function spec checks pest presence before cooldown.
  database.players[0].farm_plots[0].hasBugs = false;

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        NOW + 60,
        () => plantPestBySabotage("friend-001", "owner-001", "plot_1", "bugs"),
      ),
    "COOLDOWN_ACTIVE:719min",
  );
});

Deno.test("T2.9.9 Different pest types have separate cooldowns", async () => {
  const database = installMockSupabase([growingPlot()]);

  await withMockedNow(
    NOW,
    () => plantPestBySabotage("friend-001", "owner-001", "plot_1", "bugs"),
  );
  const result = await withMockedNow(
    NOW + 60,
    () => plantPestBySabotage("friend-001", "owner-001", "plot_1", "weeds"),
  );

  assertEquals(result, {
    success: true,
    pestApplied: "weeds",
    saboteurScoreChange: -5,
  }, "result");
  assertEquals(database.players[1].sabotage_log.length, 2, "log length");
});

Deno.test("T2.9.10 Already present blocked", async () => {
  installMockSupabase([growingPlot({ hasBugs: true })]);

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        NOW,
        () => plantPestBySabotage("friend-001", "owner-001", "plot_1", "bugs"),
      ),
    "PEST_ALREADY_PRESENT:bugs",
  );
});

Deno.test("T2.9.11 Sabotage score penalty", async () => {
  const database = installMockSupabase([growingPlot()]);

  const result = await withMockedNow(
    NOW,
    () => plantPestBySabotage("friend-001", "owner-001", "plot_1", "bugs"),
  );

  assertEquals(result.saboteurScoreChange, -5, "score change");
  assertEquals(database.players[1].neighbour_score, 45, "score");
});

Deno.test("T2.9.12 waterForRegrow starts regrow", async () => {
  const database = installMockSupabase([needsWaterPlot()]);

  const result = await withMockedRandom(
    [0.5],
    () =>
      withMockedNow(
        NOW,
        () => waterForRegrow("owner-001", "plot_1"),
      ),
  );

  assertEquals(result.success, true, "success");
  assertEquals(result.newYield, 13, "new yield");
  assertEquals(result.newStealPool, 5, "new steal pool");
  assertEquals(result.regrowTimeSeconds, 3_600, "regrow time");
  assertEquals(
    database.players[0].farm_plots[0].isPerpetualRegrowing,
    true,
    "regrowing",
  );
  assertEquals(
    database.players[0].farm_plots[0].regrowStartedAt,
    NOW,
    "regrow started",
  );
  assertEquals(database.players[0].farm_plots[0].needsWater, false, "water");
});

Deno.test("T2.9.13 waterForRegrow wrong state", async () => {
  installMockSupabase([growingPlot()]);

  await assertRejectsWithMessage(
    () => waterForRegrow("owner-001", "plot_1"),
    "PLOT_NOT_NEEDS_WATER:plot_1",
  );
});

Deno.test("T2.9.14 Strawberry new yield range", async () => {
  installMockSupabase([needsWaterPlot()]);

  const result = await withMockedRandom(
    [0.999],
    () =>
      withMockedNow(
        NOW,
        () => waterForRegrow("owner-001", "plot_1"),
      ),
  );

  assert(result.newYield >= 10 && result.newYield <= 16, "yield range");
});
