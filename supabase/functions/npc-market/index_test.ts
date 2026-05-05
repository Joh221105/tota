import {
  buyFromNPCMarket,
  determineNPCRotation,
  type PlayerRotationStock,
} from "./index.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";

type TableName = "players" | "game_config" | "inventory" | "coin_transactions";

interface PlayerRow {
  id: string;
  coins: number;
  inventory_slots: Record<string, number>;
  npc_rotation_stock: PlayerRotationStock | null;
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

const PLAYER_ID = "player-001";
const PLAYER_B_ID = "player-002";
const TODAY_SECONDS = Date.UTC(2026, 4, 4, 12, 0, 0) / 1000;
const TOMORROW_SECONDS = Date.UTC(2026, 4, 5, 12, 0, 0) / 1000;
const BASE_CONFIGS: Record<string, unknown> = {
  NPC_ALWAYS_AVAILABLE: {
    bait_basic: 5,
    animal_grain: 3,
  },
  NPC_ROTATION_POOL: [
    "crop_tomato",
    "crop_lettuce",
    "crop_wheat",
    "crop_onion",
    "crop_strawberry",
    "crop_jalapeno",
    "crop_potato",
  ],
  crop_tomato: { baseValue: 10 },
  crop_lettuce: { baseValue: 5 },
  crop_wheat: { baseValue: 4 },
  crop_onion: { baseValue: 8 },
  crop_strawberry: { baseValue: 12 },
  crop_jalapeno: { baseValue: 14 },
  crop_potato: { baseValue: 6 },
};

/**
 * Asserts a condition.
 * @param condition - Condition to verify.
 * @param message - Failure message.
 * @returns Nothing.
 * @throws Error when the condition is false.
 */
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * Asserts JSON equality.
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
 * Asserts an async action rejects with an expected message.
 * @param action - Action expected to reject.
 * @param expectedMessage - Expected error message.
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
 * Clones a JSON-compatible value.
 * @param value - Value to clone.
 * @returns Cloned value.
 * @throws Never.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Builds a mock database.
 * @param overrides - Optional row overrides.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(overrides: {
  players?: Partial<PlayerRow>[];
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

  const basePlayer = (id: string): PlayerRow => ({
    id,
    coins: 1_000,
    inventory_slots: {
      crops: 5000,
      fish: 5000,
      animal_produce: 5000,
      processed: 5000,
      cooked_dishes: 5000,
      tools: 5000,
    },
    npc_rotation_stock: null,
  });

  return {
    players: (overrides.players ?? [{ id: PLAYER_ID }]).map((player) => ({
      ...basePlayer(String(player.id ?? PLAYER_ID)),
      ...clone(player),
    })),
    game_config: [...configMap.entries()].map(([key, value]) => ({
      key,
      value,
    })),
    inventory: clone(overrides.inventory ?? []),
    coin_transactions: [],
  };
}

/**
 * Runs an action with Date.now mocked.
 * @param now - Unix seconds to return.
 * @param action - Action to run.
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
 * Installs a mock Supabase client.
 * @param database - Database to install.
 * @returns Installed database.
 * @throws Never.
 */
function installMockSupabase(database: MockDatabase): MockDatabase {
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
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
   * Starts a mock table query.
   * @param table - Table name.
   * @returns Query builder.
   * @throws Never.
   */
  from(table: string): MockQueryBuilder {
    return new MockQueryBuilder(this.database, table as TableName);
  }

  /**
   * Runs a mock Supabase RPC.
   * @param functionName - RPC name.
   * @param params - RPC params.
   * @returns RPC result.
   * @throws Never.
   */
  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<
    { data: Record<string, unknown> | null; error: { message: string } | null }
  > {
    if (functionName !== "debit_coins") {
      return Promise.resolve({ data: null, error: { message: "UNKNOWN_RPC" } });
    }
    const player = this.database.players.find((row) =>
      row.id === params.p_player_id
    );
    if (!player) {
      return Promise.resolve({
        data: null,
        error: { message: "PLAYER_NOT_FOUND:" + String(params.p_player_id) },
      });
    }
    const amount = Number(params.p_amount);
    if (player.coins < amount) {
      return Promise.resolve({
        data: null,
        error: { message: `INSUFFICIENT_FUNDS:${player.coins}:${amount}` },
      });
    }

    const before = player.coins;
    player.coins -= amount;
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
  private updateValues: Record<string, unknown> | null = null;
  private insertValues: Record<string, unknown> | null = null;
  private countRequested = false;

  /**
   * Creates a query builder.
   * @param database - In-memory database.
   * @param table - Table name.
   * @returns Query builder.
   * @throws Never.
   */
  constructor(database: MockDatabase, table: TableName) {
    this.database = database;
    this.table = table;
  }

  /**
   * Records selected columns.
   * @param columns - Column list.
   * @param options - Optional count options.
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
   * Records an equality filter.
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
   * Records an update mutation.
   * @param values - Update values.
   * @returns Current query builder.
   * @throws Never.
   */
  update(values: Record<string, unknown>): MockQueryBuilder {
    this.updateValues = values;
    return this;
  }

  /**
   * Records an insert mutation.
   * @param values - Insert values.
   * @returns Current query builder.
   * @throws Never.
   */
  insert(values: Record<string, unknown>): MockQueryBuilder {
    this.insertValues = values;
    return this;
  }

  /**
   * Resolves a nullable single row query.
   * @returns Query result.
   * @throws Never.
   */
  maybeSingle(): Promise<
    { data: Record<string, unknown> | null; error: null }
  > {
    const rows = this.matchingRows();
    return Promise.resolve({
      data: rows[0] ? this.projectRow(rows[0]) : null,
      error: null,
    });
  }

  /**
   * Resolves a single row query or mutation.
   * @returns Query result.
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
   * Resolves awaited query builders.
   * @param onfulfilled - Fulfillment callback.
   * @param onrejected - Rejection callback.
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
   * Applies pending mutation and returns affected rows.
   * @returns Affected rows.
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
    }
    return rows;
  }

  /**
   * Returns rows matching all filters.
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
   * Returns table rows.
   * @returns Table rows.
   * @throws Never.
   */
  private tableRows(): Array<Record<string, unknown>> {
    return this.database[this.table] as unknown as Array<
      Record<string, unknown>
    >;
  }

  /**
   * Projects selected columns from a row.
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

Deno.test("T8.1.1 Buy bait (always-available)", async () => {
  const database = installMockSupabase(buildMockDatabase());

  const result = await buyFromNPCMarket(PLAYER_ID, "bait_basic", null, 5);

  assertEquals(result.totalCost, 25, "total cost");
  assertEquals(database.players[0].coins, 975, "coins deducted");
  assertEquals(database.inventory[0].item_id, "bait_basic", "bait added");
  assertEquals(database.inventory[0].grade, "Normal", "grade");
  assertEquals(database.inventory[0].quantity, 5, "quantity");
  assertEquals(database.inventory[0].category, "tools", "category");
});

Deno.test("T8.1.2 Buy grain in bulk", async () => {
  const database = installMockSupabase(buildMockDatabase());

  await buyFromNPCMarket(PLAYER_ID, "animal_grain", null, 50);

  assertEquals(database.players[0].coins, 850, "coins deducted");
  assertEquals(database.inventory[0].quantity, 50, "grain added");
});

Deno.test("T8.1.3 Non-market item", async () => {
  installMockSupabase(buildMockDatabase());

  await assertRejectsWithMessage(
    () =>
      withMockedNow(TODAY_SECONDS, () =>
        buyFromNPCMarket(
          PLAYER_ID,
          "fish_catfish",
          null,
          1,
        )),
    "ITEM_NOT_IN_NPC_MARKET:fish_catfish",
  );
});

Deno.test("T8.1.4 Rotation deterministic", async () => {
  installMockSupabase(buildMockDatabase());

  const first = await determineNPCRotation("2026-05-04");
  for (let i = 0; i < 10; i++) {
    assertEquals(
      await determineNPCRotation("2026-05-04"),
      first,
      "same rotation",
    );
  }
});

Deno.test("T8.1.5 Buy rotation item", async () => {
  const database = installMockSupabase(buildMockDatabase());
  const slot = (await determineNPCRotation("2026-05-04"))[0];

  await withMockedNow(
    TODAY_SECONDS,
    () => buyFromNPCMarket(PLAYER_ID, slot.itemId, slot.grade, 3),
  );

  const stock = database.players[0].npc_rotation_stock!;
  assertEquals(
    stock.slots.find((entry) => entry.slotId === slot.slotId)?.remaining,
    2,
    "remaining stock",
  );
});

Deno.test("T8.1.6 Rotation stock at 0", async () => {
  const database = installMockSupabase(buildMockDatabase());
  const slot = (await determineNPCRotation("2026-05-04"))[0];

  await withMockedNow(
    TODAY_SECONDS,
    () => buyFromNPCMarket(PLAYER_ID, slot.itemId, slot.grade, 5),
  );
  assertEquals(
    database.players[0].npc_rotation_stock!.slots[0].remaining,
    0,
    "sold out",
  );
  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        TODAY_SECONDS,
        () => buyFromNPCMarket(PLAYER_ID, slot.itemId, slot.grade, 1),
      ),
    "ROTATION_ITEM_SOLD_OUT:" + slot.itemId,
  );
});

Deno.test("T8.1.7 Player B unaffected", async () => {
  const database = installMockSupabase(buildMockDatabase({
    players: [{ id: PLAYER_ID }, { id: PLAYER_B_ID }],
  }));
  const slot = (await determineNPCRotation("2026-05-04"))[0];

  await withMockedNow(
    TODAY_SECONDS,
    () => buyFromNPCMarket(PLAYER_ID, slot.itemId, slot.grade, 5),
  );
  await withMockedNow(
    TODAY_SECONDS,
    () => buyFromNPCMarket(PLAYER_B_ID, slot.itemId, slot.grade, 1),
  );

  assertEquals(
    database.players[0].npc_rotation_stock!.slots[0].remaining,
    0,
    "A empty",
  );
  assertEquals(
    database.players[1].npc_rotation_stock!.slots[0].remaining,
    4,
    "B had stock",
  );
});

Deno.test("T8.1.8 Rotation stock resets daily", async () => {
  const database = installMockSupabase(buildMockDatabase());
  const todaySlot = (await determineNPCRotation("2026-05-04"))[0];

  await withMockedNow(
    TODAY_SECONDS,
    () => buyFromNPCMarket(PLAYER_ID, todaySlot.itemId, todaySlot.grade, 5),
  );
  assertEquals(
    database.players[0].npc_rotation_stock!.slots[0].remaining,
    0,
    "today empty",
  );

  const tomorrowSlot = (await determineNPCRotation("2026-05-05"))[0];
  await withMockedNow(
    TOMORROW_SECONDS,
    () =>
      buyFromNPCMarket(
        PLAYER_ID,
        tomorrowSlot.itemId,
        tomorrowSlot.grade,
        1,
      ),
  );

  assertEquals(
    database.players[0].npc_rotation_stock!.date,
    "2026-05-05",
    "date reset",
  );
  assertEquals(
    database.players[0].npc_rotation_stock!.slots[0].remaining,
    4,
    "restored stock",
  );
});

Deno.test("T8.1.9 Insufficient coins", async () => {
  installMockSupabase(buildMockDatabase({
    players: [{ id: PLAYER_ID, coins: 10 }],
  }));

  await assertRejectsWithMessage(
    () => buyFromNPCMarket(PLAYER_ID, "bait_basic", null, 3),
    "INSUFFICIENT_FUNDS:10:15",
  );
});

Deno.test("T8.1.10 Rotation has 5 slots", async () => {
  installMockSupabase(buildMockDatabase());

  const rotation = await determineNPCRotation("2026-05-04");

  assertEquals(rotation.length, 5, "slot count");
  assert(
    new Set(rotation.map((slot) => slot.itemId)).size === 5,
    "unique items",
  );
});
