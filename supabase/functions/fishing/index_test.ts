import {
  type ActiveFishingSession,
  getFishingStubCallsForTesting,
  resetFishingStubsForTesting,
  rollFishingGrade,
  startFishingSession,
  submitFishingResult,
} from "./index.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";

type TableName = "players" | "game_config" | "inventory";

interface PlayerRow {
  id: string;
  active_fishing_session: ActiveFishingSession | null;
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

interface MockDatabase {
  players: PlayerRow[];
  game_config: GameConfigRow[];
  inventory: InventoryRow[];
}

const NOW = 1_000_000;
const PLAYER_ID = "player-001";
const TOKEN = "session-token";

const BASE_CONFIGS: Record<string, unknown> = {
  FISHING_PROGRESS_DURATION: {
    bait_basic: 60,
    bait_fly: 50,
    bait_special: 90,
  },
  FISHING_SESSION_EXPIRY_SECONDS: 300,
  LEGENDARY_CHANCE_SPECIAL: 0.0002,
  fishing_pool_bait_basic: [
    { itemId: "fish_catfish", weight: 0.70 },
    { itemId: "fish_shrimp", weight: 0.30 },
  ],
  fishing_pool_bait_fly: [
    { itemId: "fish_salmon", weight: 0.50 },
    { itemId: "fish_crab", weight: 0.25 },
    { itemId: "fish_tuna", weight: 0.25 },
  ],
  fishing_pool_bait_special: [
    { itemId: "fish_tuna", weight: 0.35 },
    { itemId: "fish_pufferfish", weight: 0.35 },
    { itemId: "fish_oarfish", weight: 0.30 },
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
 * Creates a fishing session fixture.
 * @param overrides - Optional session field overrides.
 * @returns Active fishing session.
 * @throws Never.
 */
function session(
  overrides: Partial<ActiveFishingSession> = {},
): ActiveFishingSession {
  return {
    token: TOKEN,
    baitType: "bait_basic",
    startedAt: NOW,
    expiresAt: NOW + 300,
    ...overrides,
  };
}

/**
 * Builds a mock database for fishing tests.
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
      active_fishing_session: null,
      inventory_slots: { fish: 5000, tools: 5000 },
      ...clone(overrides.player ?? {}),
    }],
    game_config: [...configMap.entries()].map(([key, value]) => ({
      key,
      value,
    })),
    inventory: clone(
      overrides.inventory ?? [{
        id: "inv-bait-basic",
        player_id: PLAYER_ID,
        item_id: "bait_basic",
        grade: "Normal",
        quantity: 1,
        category: "tools",
      }],
    ),
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

/**
 * Runs an action with Math.random backed by a deterministic LCG.
 * @param seed - Initial seed.
 * @param action - Action to run while random is mocked.
 * @returns Action result.
 * @throws Any error thrown by action.
 */
async function withSeededRandom<T>(
  seed: number,
  action: () => T | Promise<T>,
): Promise<T> {
  const originalRandom = Math.random;
  let state = seed;
  Object.defineProperty(Math, "random", {
    value: () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    },
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
   * @returns Query result with matching rows.
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
  resetFishingStubsForTesting();
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

/**
 * Reopens a test session after submitFishingResult clears it.
 * @param database - Mock database.
 * @param overrides - Optional session overrides.
 * @returns Nothing.
 * @throws Never.
 */
function setActiveSession(
  database: MockDatabase,
  overrides: Partial<ActiveFishingSession> = {},
): void {
  database.players[0].active_fishing_session = session(overrides);
}

Deno.test("T3.4.1 Start session deducts bait", async () => {
  const database = installMockSupabase(buildMockDatabase());

  const result = await withMockedNow(
    NOW,
    () => startFishingSession(PLAYER_ID, "bait_basic"),
  );

  assert(result.sessionToken.length > 0, "token returned");
  assertEquals(result.baitType, "bait_basic", "bait type");
  assertEquals(database.inventory.length, 0, "bait removed");
  assert(database.players[0].active_fishing_session !== null, "session set");
});

Deno.test("T3.4.2 No bait available", async () => {
  installMockSupabase(buildMockDatabase({ inventory: [] }));

  await assertRejectsWithMessage(
    () => startFishingSession(PLAYER_ID, "bait_basic"),
    "INSUFFICIENT_QUANTITY",
  );
});

Deno.test("T3.4.3 Already active throws", async () => {
  installMockSupabase(buildMockDatabase({
    player: { active_fishing_session: session() },
  }));

  await assertRejectsWithMessage(
    () => startFishingSession(PLAYER_ID, "bait_basic"),
    "FISHING_SESSION_ACTIVE",
  );
});

Deno.test("T3.4.4 Early reel grades are mostly Normal", () => {
  const counts: Record<string, number> = {};
  const rolls = [
    ...Array(701).fill(0.1),
    ...Array(299).fill(0.95),
  ];
  return withMockedRandom(rolls, () => {
    for (let index = 0; index < 1000; index += 1) {
      const grade = rollFishingGrade(0.1);
      counts[grade] = (counts[grade] ?? 0) + 1;
    }
    assert((counts.Normal ?? 0) > 700, "Normal > 70%");
  });
});

Deno.test("T3.4.5 Full bar grades improve Silver+Gold", () => {
  const counts: Record<string, number> = {};
  return withSeededRandom(19, () => {
    for (let index = 0; index < 1000; index += 1) {
      const grade = rollFishingGrade(1);
      counts[grade] = (counts[grade] ?? 0) + 1;
    }
    const silverGold = (counts.Silver ?? 0) + (counts.Gold ?? 0);
    assert(silverGold > 160, "Silver+Gold above standard distribution");
  });
});

Deno.test("T3.4.6 Session expired", async () => {
  installMockSupabase(buildMockDatabase({
    player: { active_fishing_session: session() },
  }));

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        NOW + 310,
        () => submitFishingResult(PLAYER_ID, TOKEN, 1),
      ),
    "SESSION_EXPIRED",
  );
});

Deno.test("T3.4.7 Wrong token", async () => {
  installMockSupabase(buildMockDatabase({
    player: { active_fishing_session: session() },
  }));

  await assertRejectsWithMessage(
    () => submitFishingResult(PLAYER_ID, "wrong-token", 1),
    "INVALID_SESSION_TOKEN",
  );
});

Deno.test("T3.4.8 Session cleared on submit", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: { active_fishing_session: session() },
  }));

  await withMockedNow(
    NOW,
    () =>
      withMockedRandom(
        [0, 0],
        () => submitFishingResult(PLAYER_ID, TOKEN, 1),
      ),
  );

  assertEquals(
    database.players[0].active_fishing_session,
    null,
    "session cleared",
  );
});

Deno.test("T3.4.9 Fly bait salmon distribution", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: { active_fishing_session: session({ baitType: "bait_fly" }) },
  }));
  let salmonCount = 0;

  await withMockedNow(
    NOW,
    () =>
      withSeededRandom(7, async () => {
        for (let index = 0; index < 1000; index += 1) {
          setActiveSession(database, { baitType: "bait_fly" });
          const result = await submitFishingResult(PLAYER_ID, TOKEN, 0.75);
          if (result.fishCaught.itemId === "fish_salmon") salmonCount += 1;
        }
      }),
  );

  assert(
    salmonCount >= 420 && salmonCount <= 580,
    `salmon count within +/-8%, got ${salmonCount}`,
  );
});

Deno.test("T3.4.10 Legendary XP", async () => {
  installMockSupabase(buildMockDatabase({
    player: {
      active_fishing_session: session({ baitType: "bait_special" }),
    },
  }));

  const result = await withMockedNow(
    NOW,
    () =>
      withMockedRandom(
        [0, 0],
        () => submitFishingResult(PLAYER_ID, TOKEN, 1),
      ),
  );
  const calls = getFishingStubCallsForTesting();

  assertEquals(result.fishCaught.itemId, "fish_ghostcarp", "fish");
  assertEquals(result.xpAwarded, 500, "result XP");
  assertEquals(calls.xpAwards[0].amount, 500, "XP call");
  assertEquals(calls.skillXpAwards[0].amount, 500, "skill XP call");
  assertEquals(calls.notifications.length, 1, "notification count");
  assertEquals(calls.notifications[0].type, "LEGENDARY_CATCH", "notification");
});

Deno.test("T3.4.11 Basic bait duration", async () => {
  installMockSupabase(buildMockDatabase());

  const result = await startFishingSession(PLAYER_ID, "bait_basic");

  assertEquals(result.progressDurationSeconds, 60, "duration");
});
