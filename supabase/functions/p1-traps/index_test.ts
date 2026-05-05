import {
  calculateTrapState,
  collectTrap,
  type FishingTrap,
  getTrapStubCallsForTesting,
  resetTrapStubsForTesting,
} from "./index.ts";
import { setSupabaseAdminForTesting } from "../_lib/supabase.ts";

type TableName = "players" | "game_config" | "inventory";

interface PlayerRow {
  id: string;
  fishing_traps: FishingTrap[];
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

const TRAP_CONFIG_FIXTURES: Record<string, Record<string, unknown>> = {
  trap_wooden_trap: {
    fillSeconds: 10800,
    unlockLevel: 1,
    loot: [
      { itemId: "fish_shrimp", weight: 0.60 },
      { itemId: "fish_catfish", weight: 0.30 },
      { itemId: "fish_crab", weight: 0.10 },
    ],
  },
  trap_wire_trap: {
    fillSeconds: 14400,
    unlockLevel: 8,
    loot: [
      { itemId: "fish_shrimp", weight: 0.40 },
      { itemId: "fish_crab", weight: 0.40 },
      { itemId: "fish_clam", weight: 0.20 },
    ],
  },
  trap_deep_trap: {
    fillSeconds: 21600,
    unlockLevel: 14,
    loot: [
      { itemId: "fish_crab", weight: 0.35 },
      { itemId: "fish_salmon", weight: 0.35 },
      { itemId: "fish_pufferfish", weight: 0.30 },
    ],
  },
};

const BASE_CONFIGS: Record<string, string> = {
  TRAP_WORN_CHANCE: "0.10",
  TRAP_JUNK_CHANCE: "0.05",
  TRAP_GRADE_NORMAL: "0.65",
  TRAP_GRADE_BRONZE: "0.25",
  TRAP_GRADE_SILVER: "0.08",
  TRAP_GRADE_GOLD: "0.02",
  TRAP_GRADE_DIAMOND: "0.001",
  TRAP_WORN_NORMAL: "0.85",
  TRAP_WORN_BRONZE: "0.12",
  TRAP_WORN_SILVER: "0.03",
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
 * Creates a test fishing trap.
 * @param overrides - Optional trap field overrides.
 * @returns Fishing trap record.
 * @throws Never.
 */
function trap(overrides: Partial<FishingTrap> = {}): FishingTrap {
  return {
    trapId: "trap-1",
    trapType: "wooden_trap",
    lastCollectTimestamp: NOW - 10800,
    isWorn: false,
    ...clone(overrides),
  };
}

/**
 * Builds a mock traps database.
 * @param overrides - Optional player and config overrides.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(overrides: {
  player?: Partial<PlayerRow>;
  gameConfig?: Record<string, unknown>;
} = {}): MockDatabase {
  const gameConfigMap = new Map<string, string>();
  for (const [key, value] of Object.entries(BASE_CONFIGS)) {
    gameConfigMap.set(key, value);
  }
  for (const [key, value] of Object.entries(TRAP_CONFIG_FIXTURES)) {
    gameConfigMap.set(key, JSON.stringify(value));
  }
  for (const [key, value] of Object.entries(overrides.gameConfig ?? {})) {
    gameConfigMap.set(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }

  return {
    players: [{
      id: "player-001",
      fishing_traps: [trap()],
      inventory_slots: { fish: 5000, tools: 5000 },
      ...clone(overrides.player ?? {}),
    }],
    game_config: [...gameConfigMap.entries()].map(([key, value]) => ({
      key,
      value,
    })),
    inventory: [],
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
 * Runs an action with Math.random returning a fixed sequence.
 * @param values - Sequence of random values.
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

/**
 * Runs an action with Math.random backed by a deterministic LCG.
 * @param seed - Initial seed.
 * @param action - Action to run while random is mocked.
 * @returns Action result.
 * @throws Any error thrown by action.
 */
async function withSeededRandom<T>(
  seed: number,
  action: () => Promise<T>,
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
   * Applies an insert or update and returns affected or matching rows.
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
  resetTrapStubsForTesting();
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

/**
 * Marks the first test trap as ready before another collect call.
 * @param database - Mock database.
 * @param isWorn - Worn flag to set.
 * @returns Nothing.
 * @throws Never.
 */
function resetReadyTrap(database: MockDatabase, isWorn = false): void {
  database.players[0].fishing_traps[0].lastCollectTimestamp = NOW - 14400;
  database.players[0].fishing_traps[0].isWorn = isWorn;
}

Deno.test("T3.3.1 READY after 4h on 3h trap", () => {
  const result = calculateTrapState(
    trap({ lastCollectTimestamp: NOW - 14400 }),
    NOW,
    { fillSeconds: 10800 },
  );

  assertEquals(result.state, "READY", "state");
  assertEquals(result.timeRemainingSeconds, 0, "remaining");
});

Deno.test("T3.3.2 FILLING after 2h on 3h trap", () => {
  const result = calculateTrapState(
    trap({ lastCollectTimestamp: NOW - 7200 }),
    NOW,
    { fillSeconds: 10800 },
  );

  assertEquals(result.state, "FILLING", "state");
  assertEquals(result.timeRemainingSeconds, 3600, "remaining");
});

Deno.test("T3.3.3 Wire trap distribution follows weights", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: {
      fishing_traps: [
        trap({
          trapType: "wire_trap",
          lastCollectTimestamp: NOW - 14400,
        }),
      ],
    },
    gameConfig: {
      TRAP_JUNK_CHANCE: "0",
      TRAP_WORN_CHANCE: "0",
    },
  }));
  const counts: Record<string, number> = {
    fish_shrimp: 0,
    fish_crab: 0,
    fish_clam: 0,
  };

  await withSeededRandom(12345, async () => {
    for (let index = 0; index < 1000; index += 1) {
      resetReadyTrap(database);
      const result = await withMockedNow(() =>
        collectTrap("player-001", "trap-1")
      );
      counts[result.lootCollected.itemId] += 1;
    }
  });

  assert(counts.fish_shrimp >= 350 && counts.fish_shrimp <= 450, "shrimp rate");
  assert(counts.fish_crab >= 350 && counts.fish_crab <= 450, "crab rate");
  assert(counts.fish_clam >= 160 && counts.fish_clam <= 240, "clam rate");
});

Deno.test("T3.3.4 WORN trap degrades grade distribution", async () => {
  const database = installMockSupabase(buildMockDatabase({
    gameConfig: {
      TRAP_JUNK_CHANCE: "0",
      TRAP_WORN_CHANCE: "0",
    },
  }));
  let normalGrades = 0;

  await withSeededRandom(67890, async () => {
    for (let index = 0; index < 100; index += 1) {
      resetReadyTrap(database, true);
      const result = await withMockedNow(() =>
        collectTrap("player-001", "trap-1")
      );
      if (result.lootCollected.grade === "Normal") normalGrades += 1;
    }
  });

  assert(normalGrades >= 80, "normal grade count");
});

Deno.test("T3.3.5 WORN clears after collect when re-roll does not wear", async () => {
  const database = installMockSupabase(buildMockDatabase({
    player: {
      fishing_traps: [trap({ isWorn: true })],
    },
  }));

  const result = await withMockedRandom(
    [0.9, 0, 0, 0.9],
    () => withMockedNow(() => collectTrap("player-001", "trap-1")),
  );

  assertEquals(result.wasWorn, true, "was worn");
  assertEquals(result.isNowWorn, false, "is now worn");
  assertEquals(
    database.players[0].fishing_traps[0].isWorn,
    false,
    "stored worn",
  );
});

Deno.test("T3.3.6 WORN spawn rate is near 10 percent", async () => {
  const database = installMockSupabase(buildMockDatabase({
    gameConfig: {
      TRAP_JUNK_CHANCE: "0",
    },
  }));
  let wornCount = 0;

  await withSeededRandom(13579, async () => {
    for (let index = 0; index < 1000; index += 1) {
      resetReadyTrap(database);
      const result = await withMockedNow(() =>
        collectTrap("player-001", "trap-1")
      );
      if (result.isNowWorn) wornCount += 1;
    }
  });

  assert(wornCount >= 70 && wornCount <= 130, "worn spawn count");
});

Deno.test("T3.3.7 Junk spawn rate is near 5 percent", async () => {
  const database = installMockSupabase(buildMockDatabase({
    gameConfig: {
      TRAP_WORN_CHANCE: "0",
    },
  }));
  let junkCount = 0;

  await withSeededRandom(24680, async () => {
    for (let index = 0; index < 1000; index += 1) {
      resetReadyTrap(database);
      const result = await withMockedNow(() =>
        collectTrap("player-001", "trap-1")
      );
      if (result.lootCollected.itemId.startsWith("junk_")) junkCount += 1;
    }
  });

  assert(junkCount >= 30 && junkCount <= 70, "junk count");
});

Deno.test("T3.3.8 Collect FILLING throws TRAP_NOT_READY", async () => {
  installMockSupabase(buildMockDatabase({
    player: {
      fishing_traps: [
        trap({ lastCollectTimestamp: NOW - 7200 }),
      ],
    },
  }));

  await withMockedNow(() =>
    assertRejectsWithMessage(
      () => collectTrap("player-001", "trap-1"),
      "TRAP_NOT_READY:3600",
    )
  );
});

Deno.test("T3.3.9 Timer resets after collect", async () => {
  const database = installMockSupabase(buildMockDatabase());

  await withMockedRandom(
    [0.9, 0, 0, 0.9],
    () => withMockedNow(() => collectTrap("player-001", "trap-1")),
  );

  assertEquals(
    database.players[0].fishing_traps[0].lastCollectTimestamp,
    NOW,
    "last collect",
  );
});

Deno.test("T3.3.10 Collect awards XP and fishing skill XP", async () => {
  installMockSupabase(buildMockDatabase());

  const result = await withMockedRandom(
    [0.9, 0, 0, 0.9],
    () => withMockedNow(() => collectTrap("player-001", "trap-1")),
  );
  const calls = getTrapStubCallsForTesting();

  assertEquals(result.xpAwarded, 15, "xp result");
  assertEquals(calls.xpAwards, [{
    playerId: "player-001",
    amount: 15,
    source: "COLLECT_TRAP",
  }], "xp calls");
  assertEquals(calls.skillXpAwards, [{
    playerId: "player-001",
    skillTrack: "fishing",
    amount: 10,
  }], "skill xp calls");
});
