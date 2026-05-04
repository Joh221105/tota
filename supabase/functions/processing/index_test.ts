import {
  calculateSlotState,
  collectProcessingOutput,
  getProcessingStubCallsForTesting,
  type ProcessingSlot,
  resetProcessingStubsForTesting,
  rollOutputGrade,
  startProcessingJob,
} from "./index.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";

type TableName = "players" | "game_config" | "inventory" | "coin_transactions";

interface PlayerRow {
  id: string;
  level: number;
  coins: number;
  processing_slots: ProcessingSlot[];
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
  idempotency_key: string;
  balance_before: number;
  balance_after: number;
}

interface MockDatabase {
  players: PlayerRow[];
  game_config: GameConfigRow[];
  inventory: InventoryRow[];
  coin_transactions: CoinTransactionRow[];
}

const NOW = 1_000_000;
const PLAYER_ID = "player-001";

const BASE_CONFIGS: Record<string, unknown> = {
  recipe_cheese: {
    inputs: [{ itemId: "animal_milk", qty: 3 }],
    outputItemId: "processed_cheese",
    outputQty: 2,
    durationSeconds: 3600,
    unlockLevel: 2,
    recipeType: "processing",
  },
  recipe_onion_rings: {
    inputs: [{ itemId: "crop_onion", qty: 3 }],
    outputItemId: "processed_onion_rings",
    outputQty: 1,
    durationSeconds: 1500,
    unlockLevel: 9,
    recipeType: "processing",
  },
  recipe_recycle_boot: {
    inputs: [{ itemId: "junk_boot", qty: 3 }],
    outputItemId: "bait_basic",
    outputQty: 1,
    durationSeconds: 300,
    unlockLevel: 1,
    recipeType: "recycler",
  },
  recipe_recycle_crate: {
    inputs: [{ itemId: "junk_crate", qty: 1 }],
    outputItemId: "random_loot",
    outputQty: 1,
    durationSeconds: 600,
    unlockLevel: 1,
    recipeType: "recycler",
  },
  recipe_recycle_mixed: {
    inputs: [{ itemId: "any_junk", qty: 5 }],
    outputItemId: "random_bronze_crop",
    outputQty: 1,
    durationSeconds: 900,
    unlockLevel: 1,
    recipeType: "recycler",
  },
  CRATE_RANDOM_LOOT: [
    { type: "coins", amount: 100, weight: 0.30 },
    { type: "item", itemId: "bait_basic", qty: 2, weight: 0.25 },
    { type: "item", itemId: "random_normal_crop", qty: 3, weight: 0.25 },
    { type: "item", itemId: "expand_wooden_plank", qty: 1, weight: 0.15 },
    { type: "item", itemId: "timeskip_5min", qty: 1, weight: 0.05 },
  ],
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
 * Builds a processing slot fixture.
 * @param overrides - Optional slot overrides.
 * @returns Processing slot.
 * @throws Never.
 */
function slot(overrides: Partial<ProcessingSlot> = {}): ProcessingSlot {
  return {
    slotId: "slot-1",
    recipeId: null,
    state: "EMPTY",
    startedAt: null,
    inputGrades: [],
    ...overrides,
  };
}

/**
 * Routes test item IDs to inventory categories.
 * @param itemId - Item ID.
 * @returns Category.
 * @throws Never.
 */
function categoryFor(itemId: string): string {
  if (itemId.startsWith("crop_")) return "crops";
  if (itemId.startsWith("animal_")) return "animal_produce";
  if (itemId.startsWith("processed_")) return "processed";
  return "tools";
}

/**
 * Creates an inventory row fixture.
 * @param itemId - Item ID.
 * @param grade - Grade.
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
 * Builds a mock database for processing tests.
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
      level: 10,
      coins: 0,
      processing_slots: [slot()],
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
    coin_transactions: [],
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

  /**
   * Runs a mock Supabase RPC.
   * @param functionName - RPC name.
   * @param params - RPC parameters.
   * @returns RPC result.
   * @throws Never.
   */
  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown>; error: null }> {
    if (functionName !== "credit_coins") {
      return Promise.resolve({ data: {}, error: null });
    }
    const player = this.database.players.find((row) =>
      row.id === params.p_player_id
    )!;
    const amount = Number(params.p_amount);
    const before = player.coins;
    player.coins += amount;
    const tx = {
      id: `tx-${this.database.coin_transactions.length + 1}`,
      idempotency_key: String(params.p_idempotency_key),
      balance_before: before,
      balance_after: player.coins,
    };
    this.database.coin_transactions.push(tx);
    return Promise.resolve({
      data: {
        success: true,
        transactionId: tx.id,
        balanceBefore: before,
        balanceAfter: player.coins,
        idempotencyKey: tx.idempotency_key,
      },
      error: null,
    });
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
  resetProcessingStubsForTesting();
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

Deno.test("T4.1.1 Start Cheese", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: [inv("animal_milk", "Normal", 3)],
  }));

  const result = await withMockedNow(
    NOW,
    () =>
      startProcessingJob(PLAYER_ID, "slot-1", "recipe_cheese", {
        animal_milk: "Normal",
      }),
  );
  const calls = getProcessingStubCallsForTesting();

  assertEquals(database.inventory.length, 0, "milk removed");
  assertEquals(result.slot.state, "RUNNING", "slot running");
  assertEquals(result.estimatedCompletionAt, NOW + 3600, "completion");
  assertEquals(calls.xpAwards[0].amount, 20, "XP amount");
});

Deno.test("T4.1.2 Occupied slot", async () => {
  installMockSupabase(buildMockDatabase({
    player: { processing_slots: [slot({ state: "RUNNING" })] },
    inventory: [inv("animal_milk", "Normal", 3)],
  }));

  await assertRejectsWithMessage(
    () => startProcessingJob(PLAYER_ID, "slot-1", "recipe_cheese", {}),
    "SLOT_OCCUPIED:slot-1",
  );
});

Deno.test("T4.1.3 Missing ingredient pre-validation", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: [inv("animal_milk", "Normal", 2)],
  }));

  await assertRejectsWithMessage(
    () => startProcessingJob(PLAYER_ID, "slot-1", "recipe_cheese", {}),
    "INSUFFICIENT_INGREDIENTS:recipe_cheese:animal_milk",
  );
  assertEquals(database.inventory[0].quantity, 2, "nothing removed");
});

Deno.test("T4.1.4 Recipe not unlocked", async () => {
  installMockSupabase(buildMockDatabase({
    player: { level: 1 },
    inventory: [inv("crop_onion", "Normal", 3)],
  }));

  await assertRejectsWithMessage(
    () => startProcessingJob(PLAYER_ID, "slot-1", "recipe_onion_rings", {}),
    "RECIPE_NOT_UNLOCKED",
  );
});

Deno.test("T4.1.5 State: 30 of 60 min", () => {
  const result = calculateSlotState(
    slot({ state: "RUNNING", startedAt: NOW }),
    NOW + 1800,
    { durationSeconds: 3600 },
  );

  assertEquals(result, { state: "RUNNING", timeRemaining: 1800 }, "state");
});

Deno.test("T4.1.6 State: just complete", () => {
  const result = calculateSlotState(
    slot({ state: "RUNNING", startedAt: NOW }),
    NOW + 3601,
    { durationSeconds: 3600 },
  );

  assertEquals(result, { state: "COMPLETE", timeRemaining: 0 }, "state");
});

Deno.test("T4.1.7 Collect COMPLETE slot", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: {
      processing_slots: [slot({
        recipeId: "recipe_cheese",
        state: "COMPLETE",
        startedAt: null,
        inputGrades: ["Normal", "Normal", "Normal"],
      })],
    },
  }));

  const result = await withMockedNow(
    NOW,
    () =>
      withMockedRandom([0], () => collectProcessingOutput(PLAYER_ID, "slot-1")),
  );

  assertEquals(result.success, true, "success");
  assertEquals(database.inventory[0].item_id, "processed_cheese", "item");
  assertEquals(database.inventory[0].quantity, 2, "quantity");
  assertEquals(database.players[0].processing_slots[0].state, "EMPTY", "empty");
});

Deno.test("T4.1.8 Collect non-COMPLETE", async () => {
  installMockSupabase(buildMockDatabase({
    player: {
      processing_slots: [slot({
        recipeId: "recipe_cheese",
        state: "RUNNING",
        startedAt: NOW - 10,
      })],
    },
  }));

  await assertRejectsWithMessage(
    () =>
      withMockedNow(NOW, () => collectProcessingOutput(PLAYER_ID, "slot-1")),
    "JOB_NOT_COMPLETE:RUNNING",
  );
});

Deno.test("T4.1.9 Full inventory -> PAUSED", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: {
      inventory_slots: {
        crops: 5000,
        fish: 5000,
        animal_produce: 5000,
        processed: 0,
        cooked_dishes: 5000,
        tools: 5000,
      },
      processing_slots: [slot({
        recipeId: "recipe_cheese",
        state: "RUNNING",
        startedAt: NOW - 3601,
        inputGrades: ["Normal", "Normal", "Normal"],
      })],
    },
  }));

  const result = await withMockedNow(
    NOW,
    () => collectProcessingOutput(PLAYER_ID, "slot-1"),
  );

  assertEquals(result, {
    success: false,
    state: "PAUSED",
    reason: "INVENTORY_FULL",
  }, "paused");
  assertEquals(database.inventory.length, 0, "item not added");
  assertEquals(database.players[0].processing_slots[0].state, "PAUSED", "slot");
});

Deno.test("T4.1.10 PAUSED resumes", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: {
      processing_slots: [slot({
        recipeId: "recipe_cheese",
        state: "PAUSED",
        startedAt: NOW - 3601,
        inputGrades: ["Normal", "Normal", "Normal"],
      })],
    },
  }));

  const result = await withMockedNow(
    NOW,
    () =>
      withMockedRandom([0], () => collectProcessingOutput(PLAYER_ID, "slot-1")),
  );

  assertEquals(result.success, true, "success");
  assertEquals(database.inventory[0].item_id, "processed_cheese", "item");
  assertEquals(database.players[0].processing_slots[0].state, "EMPTY", "empty");
});

Deno.test("T4.1.11 All Diamond -> Diamond output", () => {
  const rolls = [
    ...Array(670).fill(0.50),
    ...Array(330).fill(0.99),
  ];
  return withMockedRandom(rolls, () => {
    let diamond = 0;
    for (let index = 0; index < 1000; index += 1) {
      if (rollOutputGrade(["Diamond", "Diamond", "Diamond"]) === "Diamond") {
        diamond += 1;
      }
    }
    assert(diamond >= 650 && diamond <= 700, `diamond count ${diamond}`);
  });
});

Deno.test("T4.1.12 Mixed grade -> weighted", () => {
  return withMockedRandom([0.25, 0.60, 0.90], () => {
    const outputs = [
      rollOutputGrade(["Gold", "Silver", "Normal"]),
      rollOutputGrade(["Gold", "Silver", "Normal"]),
      rollOutputGrade(["Gold", "Silver", "Normal"]),
    ];
    const allowed = new Set(["Bronze", "Silver", "Gold"]);
    assert(outputs.every((grade) => allowed.has(grade)), "weighted outputs");
  });
});

Deno.test("T4.1.13 Boot recycler", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: [inv("junk_boot", "Normal", 3)],
  }));

  await withMockedNow(NOW, async () => {
    await startProcessingJob(PLAYER_ID, "slot-1", "recipe_recycle_boot", {});
  });
  database.players[0].processing_slots[0].startedAt = NOW - 301;

  await withMockedNow(
    NOW,
    () => collectProcessingOutput(PLAYER_ID, "slot-1"),
  );

  assertEquals(database.inventory[0].item_id, "bait_basic", "bait");
  assertEquals(database.inventory[0].quantity, 1, "quantity");
});

Deno.test("T4.1.14 Crate loot distribution", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: [inv("junk_crate", "Normal", 100)],
  }));
  const rolls = [
    ...Array(30).fill([0.10]).flat(),
    ...Array(25).fill([0.40]).flat(),
    ...Array(25).fill([0.65, 0]).flat(),
    ...Array(15).fill([0.875]).flat(),
    ...Array(5).fill([0.975]).flat(),
  ];
  const counts: Record<string, number> = {};

  await withMockedNow(
    NOW,
    () =>
      withMockedRandom(rolls, async () => {
        for (let index = 0; index < 100; index += 1) {
          database.players[0].processing_slots = [slot({
            recipeId: "recipe_recycle_crate",
            state: "RUNNING",
            startedAt: NOW - 601,
            inputGrades: ["Normal"],
          })];
          const result = await collectProcessingOutput(PLAYER_ID, "slot-1");
          if (result.success) {
            const output = result.outputItem;
            const key = "type" in output
              ? "coins"
              : output.itemId.startsWith("crop_")
              ? "random_normal_crop"
              : output.itemId;
            counts[key] = (counts[key] ?? 0) + 1;
          }
        }
      }),
  );

  assertEquals(database.players[0].coins, 3000, "coins credited");
  assert(counts.coins >= 22 && counts.coins <= 38, "coins +/-8%");
  assert(counts.bait_basic >= 17 && counts.bait_basic <= 33, "bait +/-8%");
  assert(
    counts.random_normal_crop >= 17 && counts.random_normal_crop <= 33,
    "crop +/-8%",
  );
  assert(
    counts.expand_wooden_plank >= 7 && counts.expand_wooden_plank <= 23,
    "plank +/-8%",
  );
  assert(
    counts.timeskip_5min >= 0 && counts.timeskip_5min <= 13,
    "timeskip +/-8%",
  );
});

Deno.test("T4.1.15 Mixed junk recipe", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: [
      inv("junk_boot", "Normal", 2),
      inv("junk_net", "Normal", 2),
      inv("junk_crate", "Normal", 1),
    ],
  }));

  await withMockedNow(NOW, async () => {
    await startProcessingJob(PLAYER_ID, "slot-1", "recipe_recycle_mixed", {});
  });
  database.players[0].processing_slots[0].startedAt = NOW - 901;

  const result = await withMockedNow(
    NOW,
    () =>
      withMockedRandom(
        [0, 0],
        () => collectProcessingOutput(PLAYER_ID, "slot-1"),
      ),
  );

  assertEquals(result.success, true, "success");
  assert(database.inventory[0].item_id.startsWith("crop_"), "crop output");
  assertEquals(database.inventory[0].grade, "Bronze", "bronze grade");
});
