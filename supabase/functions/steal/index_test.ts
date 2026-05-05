import {
  attemptSteal,
  calculateNeighbourScoreTier,
  getDailyStrangerStealCount,
  getPublicThiefStats,
  getStealableItems,
  getStealStubCallsForTesting,
  resetStealStubsForTesting,
  setMutualFriendResultForTesting,
  setStealRandomIntForTesting,
  updateNeighbourScore,
  validateStealAttempt,
} from "./index.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";
import type { FarmPlot } from "../lib/farm.ts";

type TableName = "players" | "game_config" | "inventory" | "coin_transactions";

interface PlayerRow {
  id: string;
  level: number;
  coins: number;
  neighbourhood_id: string | null;
  stranger_steals_today: { count: number; resetDate: string };
  thief_stats: {
    totalAttemptsLifetime?: number;
    totalSuccessesLifetime?: number;
    nemesisPlayerId?: string | null;
    nemesisDisplayName?: string | null;
    timesStorenFrom?: number;
  };
  steal_log: Array<{ targetId: string; timestamp: number }>;
  neighbour_score: number;
  inventory_slots: Record<string, number>;
  farm_plots: FarmPlot[];
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
  coin_transactions: Array<Record<string, unknown>>;
  updateCalls: Array<{ table: string; values: Record<string, unknown> }>;
  rpcCalls: Array<{ functionName: string; params: Record<string, unknown> }>;
  raceEmptyOnFreshRead: boolean;
}

const THIEF_ID = "thief-001";
const TARGET_ID = "target-001";
const SHARED_NEIGHBOURHOOD_ID = "hood-001";

const BASE_CONFIGS: Record<string, unknown> = {
  NEW_PLAYER_PROTECTION_LEVEL: 5,
  STEAL_WINDOW_SECONDS: 60,
  OFFLINE_CAP_SECONDS: 57_600,
  WITHER_TIME_MULTIPLIER: 1000,
  MAX_WATERINGS_PER_CYCLE: 3,
  STRANGER_DAILY_STEAL_LIMIT: 3,
  STEAL_UNITS_MIN: 1,
  STEAL_UNITS_MAX: 2,
  NEIGHBOUR_SCORE_STRANGER_STEAL: -8,
  STEAL_COST_NORMAL: 15,
  STEAL_COST_BRONZE: 25,
  STEAL_COST_SILVER: 40,
  STEAL_COST_GOLD: 75,
  STEAL_COST_DIAMOND: 150,
  STEAL_COST_LEGENDARY: 300,
  crop_fast: {
    growTimeSeconds: 100,
    seedCostCoins: 5,
    isPerpetual: false,
    unlockLevel: 1,
    baseYieldMin: 2,
    baseYieldMax: 4,
  },
  crop_slow: {
    growTimeSeconds: 3_000_000_000,
    seedCostCoins: 5,
    isPerpetual: false,
    unlockLevel: 1,
    baseYieldMin: 2,
    baseYieldMax: 4,
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
 * Creates a deep copy of a JSON-compatible value.
 * @param value - Value to clone.
 * @returns Cloned value.
 * @throws Never.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Builds a farm plot fixture.
 * @param plotId - Plot identifier.
 * @param overrides - Optional plot overrides.
 * @returns Farm plot fixture.
 * @throws Never.
 */
function plot(plotId: string, overrides: Partial<FarmPlot> = {}): FarmPlot {
  return {
    plotId,
    cropId: "crop_fast",
    state: "PLANTED",
    plantedAt: 0,
    regrowStartedAt: null,
    yield: 4,
    stealPool: 2,
    stealPoolRemaining: 2,
    waterings: 0,
    hasBugs: false,
    hasWeeds: false,
    fertilised: false,
    fertiliserBronzeBoost: 0,
    fertiliserSilverBoost: 0,
    isPerpetualRegrowing: false,
    needsWater: false,
    lastPestCheck: 0,
    ...overrides,
  };
}

/**
 * Builds an empty farm plot fixture.
 * @param plotId - Plot identifier.
 * @returns Empty farm plot fixture.
 * @throws Never.
 */
function emptyPlot(plotId: string): FarmPlot {
  return plot(plotId, {
    cropId: null,
    state: "EMPTY",
    yield: 0,
    stealPool: 0,
    stealPoolRemaining: 0,
  });
}

/**
 * Creates a mock database with target player and config rows.
 * @param level - Target player level.
 * @param plots - Target farm plots.
 * @returns Mock database.
 * @throws Never.
 */
function createDb(
  level: number,
  plots: FarmPlot[],
  overrides: {
    thiefCoins?: number;
    thiefNeighbourhoodId?: string | null;
    targetNeighbourhoodId?: string | null;
    strangerStealsToday?: { count: number; resetDate: string };
    thiefStats?: PlayerRow["thief_stats"];
    targetStats?: PlayerRow["thief_stats"];
    stealLog?: Array<{ targetId: string; timestamp: number }>;
    neighbourScore?: number;
    raceEmptyOnFreshRead?: boolean;
  } = {},
): MockDatabase {
  const todayUTC = new Date().toISOString().slice(0, 10);
  return {
    players: [
      {
        id: THIEF_ID,
        level: 20,
        coins: overrides.thiefCoins ?? 100,
        neighbourhood_id: overrides.thiefNeighbourhoodId ??
          SHARED_NEIGHBOURHOOD_ID,
        stranger_steals_today: clone(
          overrides.strangerStealsToday ?? { count: 0, resetDate: todayUTC },
        ),
        thief_stats: clone(
          overrides.thiefStats ?? {
            totalAttemptsLifetime: 0,
            totalSuccessesLifetime: 0,
            nemesisPlayerId: null,
            nemesisDisplayName: null,
            timesStorenFrom: 0,
          },
        ),
        steal_log: clone(overrides.stealLog ?? []),
        neighbour_score: overrides.neighbourScore ?? 50,
        inventory_slots: {
          crops: 20,
          fish: 20,
          animal_produce: 20,
          processed: 20,
          cooked_dishes: 20,
          tools: 20,
        },
        farm_plots: [],
      },
      {
        id: TARGET_ID,
        level,
        coins: 100,
        neighbourhood_id: overrides.targetNeighbourhoodId ??
          SHARED_NEIGHBOURHOOD_ID,
        stranger_steals_today: { count: 0, resetDate: todayUTC },
        thief_stats: clone(overrides.targetStats ?? { timesStorenFrom: 0 }),
        steal_log: [],
        neighbour_score: 50,
        inventory_slots: {
          crops: 20,
          fish: 20,
          animal_produce: 20,
          processed: 20,
          cooked_dishes: 20,
          tools: 20,
        },
        farm_plots: clone(plots),
      },
    ],
    game_config: Object.entries(BASE_CONFIGS).map(([key, value]) => ({
      key,
      value: JSON.stringify(value),
    })),
    inventory: [
      {
        id: "inv-thief-crop-fast-normal",
        player_id: THIEF_ID,
        item_id: "crop_fast",
        grade: "Normal",
        quantity: 0,
        category: "crops",
      },
    ],
    coin_transactions: [],
    updateCalls: [],
    rpcCalls: [],
    raceEmptyOnFreshRead: overrides.raceEmptyOnFreshRead ?? false,
  };
}

class MockQuery {
  private filters: Record<string, unknown> = {};
  private selectedColumns = "";
  private selectOptions: { count?: "exact"; head?: boolean } = {};
  private pendingUpdate: Record<string, unknown> | null = null;
  private pendingInsert: Record<string, unknown> | null = null;

  /**
   * Creates a mock Supabase query builder.
   * @param db - Mock database.
   * @param table - Queried table name.
   * @throws Never.
   */
  constructor(private db: MockDatabase, private table: TableName) {}

  /**
   * Records selected columns for query-chain compatibility.
   * @param columns - Selected columns.
   * @returns This query.
   * @throws Never.
   */
  select(
    columns: string,
    options: { count?: "exact"; head?: boolean } = {},
  ): MockQuery {
    this.selectedColumns = columns;
    this.selectOptions = options;
    return this;
  }

  /**
   * Records an equality filter.
   * @param column - Filtered column.
   * @param value - Filter value.
   * @returns This query.
   * @throws Never.
   */
  eq(column: string, value: string): MockQuery {
    this.filters[column] = value;
    return this;
  }

  /**
   * Returns rows matching an in-list filter.
   * @param column - Filtered column.
   * @param values - Allowed values.
   * @returns Supabase-like query result.
   * @throws Never.
   */
  async in(
    column: string,
    values: string[],
  ): Promise<{ data: GameConfigRow[]; error: null }> {
    await Promise.resolve();
    if (this.table !== "game_config" || column !== "key") {
      return { data: [], error: null };
    }
    return {
      data: this.db.game_config.filter((row) => values.includes(row.key)),
      error: null,
    };
  }

  /**
   * Returns one row or null without an error.
   * @returns Supabase-like query result.
   * @throws Never.
   */
  async maybeSingle(): Promise<
    {
      data:
        | GameConfigRow
        | PlayerRow
        | InventoryRow
        | Record<string, unknown>
        | null;
      error: null;
    }
  > {
    await Promise.resolve();
    if (this.table === "players") {
      const id = String(this.filters.id ?? "");
      return {
        data: this.db.players.find((row) => row.id === id) ?? null,
        error: null,
      };
    }
    if (this.table === "inventory") {
      return { data: this.findInventoryRow() ?? null, error: null };
    }
    if (this.table === "coin_transactions") {
      return { data: null, error: null };
    }
    if (this.table !== "game_config") return { data: null, error: null };
    const key = String(this.filters.key ?? "");
    return {
      data: this.db.game_config.find((row) => row.key === key) ?? null,
      error: null,
    };
  }

  /**
   * Returns one player row or null without an error.
   * @returns Supabase-like query result.
   * @throws Never.
   */
  async single(): Promise<
    {
      data: PlayerRow | InventoryRow | { quantity: number } | null;
      error: null;
    }
  > {
    await Promise.resolve();
    if (this.pendingInsert && this.table === "inventory") {
      const row: InventoryRow = {
        id: `inv-${this.db.inventory.length + 1}`,
        player_id: String(this.pendingInsert.player_id),
        item_id: String(this.pendingInsert.item_id),
        grade: String(this.pendingInsert.grade),
        quantity: Number(this.pendingInsert.quantity),
        category: String(this.pendingInsert.category),
      };
      this.db.inventory.push(row);
      this.pendingInsert = null;
      return { data: { quantity: row.quantity }, error: null };
    }
    if (this.table === "inventory") {
      if (this.pendingUpdate) {
        const rowToUpdate = this.findInventoryRow();
        if (rowToUpdate) Object.assign(rowToUpdate, clone(this.pendingUpdate));
        this.pendingUpdate = null;
      }
      const row = this.findInventoryRow();
      return { data: row ? { quantity: row.quantity } : null, error: null };
    }
    if (this.table !== "players") return { data: null, error: null };
    const player = this.findPlayer();
    if (
      player?.id === TARGET_ID &&
      this.db.raceEmptyOnFreshRead &&
      this.selectedColumns === "farm_plots, thief_stats"
    ) {
      const copy = clone(player);
      copy.farm_plots = copy.farm_plots.map((farmPlot) => ({
        ...farmPlot,
        stealPoolRemaining: 0,
      }));
      return { data: copy, error: null };
    }
    return { data: player ?? null, error: null };
  }

  /**
   * Records an attempted update for zero-side-effects assertions.
   * @param values - Values that would be updated.
   * @returns This query.
   * @throws Never.
   */
  update(values: Record<string, unknown>): MockQuery {
    this.db.updateCalls.push({ table: this.table, values: clone(values) });
    this.pendingUpdate = clone(values);
    return this;
  }

  /**
   * Records an attempted insert for inventory helper compatibility.
   * @param values - Values that would be inserted.
   * @returns This query.
   * @throws Never.
   */
  insert(values: Record<string, unknown>): MockQuery {
    this.pendingInsert = clone(values);
    return this;
  }

  /**
   * Applies pending updates and resolves head/count selects.
   * @param onfulfilled - Promise fulfillment callback.
   * @returns Promise-like query result.
   * @throws Never.
   */
  then<
    TResult1 = { data: unknown[] | null; error: null; count?: number | null },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: { data: unknown[] | null; error: null; count?: number | null },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    void onrejected;
    const result = this.resolveThenResult();
    return Promise.resolve(
      onfulfilled ? onfulfilled(result) : result as TResult1,
    );
  }

  /**
   * Finds the currently filtered player row.
   * @returns Matching player row, if any.
   * @throws Never.
   */
  private findPlayer(): PlayerRow | undefined {
    const id = String(this.filters.id ?? "");
    return this.db.players.find((row) => row.id === id);
  }

  /**
   * Finds the currently filtered inventory row.
   * @returns Matching inventory row, if any.
   * @throws Never.
   */
  private findInventoryRow(): InventoryRow | undefined {
    return this.db.inventory.find((row) =>
      Object.entries(this.filters).every(([key, value]) =>
        String((row as unknown as Record<string, unknown>)[key]) ===
          String(value)
      )
    );
  }

  /**
   * Applies pending update state and returns a Supabase-like result.
   * @returns Query result.
   * @throws Never.
   */
  private resolveThenResult(): {
    data: unknown[] | null;
    error: null;
    count?: number | null;
  } {
    if (this.table === "players" && this.pendingUpdate) {
      const player = this.findPlayer();
      if (player) Object.assign(player, clone(this.pendingUpdate));
    }
    if (this.table === "inventory" && this.pendingUpdate) {
      const row = this.findInventoryRow();
      if (row) Object.assign(row, clone(this.pendingUpdate));
    }
    if (this.table === "inventory" && this.selectOptions.head) {
      const rows = this.db.inventory.filter((row) =>
        Object.entries(this.filters).every(([key, value]) =>
          String((row as unknown as Record<string, unknown>)[key]) ===
            String(value)
        )
      );
      return { data: null, error: null, count: rows.length };
    }
    return { data: [], error: null };
  }
}

/**
 * Installs a Supabase test double backed by the provided mock database.
 * @param db - Mock database.
 * @returns Nothing.
 * @throws Never.
 */
function installMockSupabase(db: MockDatabase): void {
  setSupabaseAdminForTesting({
    from(table: string): MockQuery {
      return new MockQuery(db, table as TableName);
    },
    async rpc(functionName: string, params: Record<string, unknown>) {
      await Promise.resolve();
      db.rpcCalls.push({ functionName, params: clone(params) });
      if (functionName === "debit_coins") {
        const player = db.players.find((row) => row.id === params.p_player_id);
        const amount = Number(params.p_amount);
        const balanceBefore = player?.coins ?? 0;
        if (player) player.coins -= amount;
        return {
          data: {
            success: true,
            transactionId: `txn-${db.rpcCalls.length}`,
            balanceBefore,
            balanceAfter: player?.coins ?? balanceBefore,
            idempotencyKey: String(params.p_idempotency_key),
          },
          error: null,
        };
      }
      return { data: null, error: null };
    },
  });
}

Deno.test("T6.1.1 target has 3 stealable plots", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(6, [
    plot("plot-1"),
    plot("plot-2"),
    plot("plot-3"),
  ]));

  const result = await getStealableItems(THIEF_ID, TARGET_ID);

  assertEquals(result.stealableItems.length, 3, "stealable item count");
  assertEquals(result.targetProtected, false, "target protected");
});

Deno.test("T6.1.2 no stealable plots", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(6, [
    plot("plot-growing", { cropId: "crop_slow" }),
    emptyPlot("plot-empty"),
  ]));

  const result = await getStealableItems(THIEF_ID, TARGET_ID);

  assertEquals(result.stealableItems, [], "stealable items");
});

Deno.test("T6.1.3 pool=0 not returned", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(6, [
    plot("plot-empty-pool", { stealPoolRemaining: 0 }),
    plot("plot-stealable", { stealPoolRemaining: 1 }),
  ]));

  const result = await getStealableItems(THIEF_ID, TARGET_ID);

  assertEquals(
    result.stealableItems.map((item) => item.plotId),
    ["plot-stealable"],
    "returned plot ids",
  );
});

Deno.test("T6.1.4 friend costs are 0", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(true);
  installMockSupabase(createDb(6, [
    plot("plot-1"),
    plot("plot-2"),
  ]));

  const result = await getStealableItems(THIEF_ID, TARGET_ID);

  assertEquals(
    result.stealableItems.map((item) => item.stealCost),
    [0, 0],
    "steal costs",
  );
});

Deno.test("T6.1.5 stranger uses Normal cost", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(false);
  installMockSupabase(createDb(6, [plot("plot-1")]));

  const result = await getStealableItems(THIEF_ID, TARGET_ID);

  assertEquals(result.isFriend, false, "friendship flag");
  assertEquals(result.stealableItems[0].stealCost, 15, "steal cost");
});

Deno.test("T6.1.6 fox pet stub hides grade", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(6, [
    plot("plot-1"),
    plot("plot-2"),
  ]));

  const result = await getStealableItems(THIEF_ID, TARGET_ID);

  assertEquals(
    result.stealableItems.map((item) => item.gradeVisible),
    ["Unknown", "Unknown"],
    "visible grades",
  );
});

Deno.test("T6.1.7 target level 5 protected", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(5, [plot("plot-1")]));

  const result = await getStealableItems(THIEF_ID, TARGET_ID);

  assertEquals(result, {
    stealableItems: [],
    targetProtected: true,
    reason: "TARGET_PROTECTED",
  }, "protected result");
});

Deno.test("T6.1.8 target level 6 not protected", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(6, [plot("plot-1")]));

  const result = await getStealableItems(THIEF_ID, TARGET_ID);

  assertEquals(result.targetProtected, false, "target protected");
  assertEquals(result.stealableItems.length, 1, "stealable item count");
});

Deno.test("T6.2.1 valid friend steal", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(true);
  installMockSupabase(createDb(6, [plot("plot-1")]));

  const result = await validateStealAttempt(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result, {
    valid: true,
    error: null,
    isFriend: true,
    stealCost: 0,
  }, "validation result");
});

Deno.test("T6.2.2 valid stranger steal", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(false);
  installMockSupabase(createDb(6, [plot("plot-1")]));

  const result = await validateStealAttempt(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result, {
    valid: true,
    error: null,
    isFriend: false,
    stealCost: 15,
  }, "validation result");
});

Deno.test("T6.2.3 target protected", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(4, [plot("plot-1")]));

  const result = await validateStealAttempt(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result.error, "TARGET_PROTECTED_NEW_PLAYER", "error");
  assertEquals(result.valid, false, "valid");
});

Deno.test("T6.2.4 target level 6 OK", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(6, [plot("plot-1")]));

  const result = await validateStealAttempt(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result.valid, true, "valid");
});

Deno.test("T6.2.5 not connected", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(false);
  installMockSupabase(createDb(6, [plot("plot-1")], {
    thiefNeighbourhoodId: "hood-a",
    targetNeighbourhoodId: "hood-b",
  }));

  const result = await validateStealAttempt(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result, {
    valid: false,
    error: "NOT_CONNECTED",
    isFriend: false,
    stealCost: 0,
  }, "validation result");
});

Deno.test("T6.2.6 plot not stealable", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(6, [
    plot("plot-growing", { cropId: "crop_slow" }),
  ]));

  const result = await validateStealAttempt(
    THIEF_ID,
    TARGET_ID,
    "plot-growing",
  );

  assertEquals(result.error, "PLOT_NOT_STEALABLE:GROWING", "error");
  assertEquals(result.valid, false, "valid");
});

Deno.test("T6.2.7 pool exhausted", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(6, [
    plot("plot-exhausted", { stealPoolRemaining: 0 }),
  ]));

  const result = await validateStealAttempt(
    THIEF_ID,
    TARGET_ID,
    "plot-exhausted",
  );

  assertEquals(result.error, "STEAL_POOL_EXHAUSTED", "error");
  assertEquals(result.valid, false, "valid");
});

Deno.test("T6.2.8 stranger daily limit", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(false);
  const todayUTC = new Date().toISOString().slice(0, 10);
  installMockSupabase(createDb(6, [plot("plot-1")], {
    strangerStealsToday: { count: 3, resetDate: todayUTC },
  }));

  const result = await validateStealAttempt(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result, {
    valid: false,
    error: "STRANGER_DAILY_LIMIT_REACHED",
    isFriend: false,
    stealCost: 0,
  }, "validation result");
});

Deno.test("T6.2.9 insufficient funds", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(false);
  installMockSupabase(createDb(6, [plot("plot-1")], { thiefCoins: 5 }));

  const result = await validateStealAttempt(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result, {
    valid: false,
    error: "INSUFFICIENT_FUNDS",
    isFriend: false,
    stealCost: 15,
  }, "validation result");
});

Deno.test("T6.2.10 zero side effects", async () => {
  resetStealStubsForTesting();
  const db = createDb(4, [plot("plot-1")]);
  installMockSupabase(db);
  const beforePlayers = clone(db.players);
  const beforeConfigs = clone(db.game_config);

  const result = await validateStealAttempt(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result.valid, false, "valid");
  assertEquals(db.players, beforePlayers, "players unchanged");
  assertEquals(db.game_config, beforeConfigs, "config unchanged");
  assertEquals(db.updateCalls, [], "no updates");
  assertEquals(db.rpcCalls, [], "no rpc calls");
});

Deno.test("T6.3.1 friend steal success", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(true);
  setStealRandomIntForTesting(() => 2);
  const db = createDb(6, [plot("plot-1", { stealPoolRemaining: 3 })]);
  installMockSupabase(db);

  const result = await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result.success, true, "success");
  assertEquals(result.itemsStolen?.[0].quantity, 2, "quantity stolen");
  assertEquals(
    db.players.find((row) => row.id === THIEF_ID)?.coins,
    100,
    "coins",
  );
  assertEquals(
    db.players.find((row) => row.id === TARGET_ID)?.farm_plots[0]
      .stealPoolRemaining,
    1,
    "pool remaining",
  );
  assertEquals(db.inventory[0].quantity, 2, "inventory quantity");
  assertEquals(getStealStubCallsForTesting().notifications, [{
    playerId: TARGET_ID,
    type: "STOLEN_FROM",
    data: { cropId: "crop_fast", unitsStolen: 2, anonymous: true },
  }], "notifications");
});

Deno.test("T6.3.2 units in valid range", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(true);
  for (let i = 0; i < 1000; i++) {
    const db = createDb(6, [plot("plot-1", { stealPoolRemaining: 3 })]);
    installMockSupabase(db);
    const result = await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");
    const quantity = result.itemsStolen?.[0].quantity ?? 0;
    if (quantity < 1 || quantity > 2) {
      throw new Error(`quantity out of range: ${quantity}`);
    }
  }
});

Deno.test("T6.3.3 cannot steal more than pool", async () => {
  resetStealStubsForTesting();
  setStealRandomIntForTesting(() => 2);
  const db = createDb(6, [plot("plot-1", { stealPoolRemaining: 1 })]);
  installMockSupabase(db);

  const result = await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result.itemsStolen?.[0].quantity, 1, "quantity stolen");
  assertEquals(result.stealPoolRemainingAfter, 0, "pool remaining");
});

Deno.test("T6.3.4 stranger steal deducts", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(false);
  setStealRandomIntForTesting(() => 1);
  const db = createDb(6, [plot("plot-1", { stealPoolRemaining: 3 })]);
  installMockSupabase(db);

  const result = await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result.stealCost, 15, "steal cost");
  assertEquals(
    db.players.find((row) => row.id === THIEF_ID)?.coins,
    85,
    "coins",
  );
  assertEquals(db.rpcCalls[0].functionName, "debit_coins", "rpc");
});

Deno.test("T6.3.5 pool decremented", async () => {
  resetStealStubsForTesting();
  setStealRandomIntForTesting(() => 2);
  const db = createDb(6, [plot("plot-1", { stealPoolRemaining: 3 })]);
  installMockSupabase(db);

  await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(
    db.players.find((row) => row.id === TARGET_ID)?.farm_plots[0]
      .stealPoolRemaining,
    1,
    "pool remaining",
  );
});

Deno.test("T6.3.6 pool exhausted flag", async () => {
  resetStealStubsForTesting();
  setStealRandomIntForTesting(() => 2);
  const db = createDb(6, [plot("plot-1", { stealPoolRemaining: 2 })]);
  installMockSupabase(db);

  const result = await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result.poolExhausted, true, "pool exhausted");
  assertEquals(result.stealPoolRemainingAfter, 0, "pool remaining");
});

Deno.test("T6.3.7 race condition pool empty", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(false);
  const db = createDb(6, [plot("plot-1", { stealPoolRemaining: 2 })], {
    raceEmptyOnFreshRead: true,
  });
  installMockSupabase(db);

  const result = await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result, {
    success: false,
    reason: "STEAL_POOL_EMPTY_RACE_CONDITION",
    refund: 0,
    message: "Another player just claimed the last items.",
  }, "race result");
  assertEquals(
    db.players.find((row) => row.id === THIEF_ID)?.coins,
    100,
    "coins",
  );
  assertEquals(db.rpcCalls, [], "no charge");
});

Deno.test("T6.3.8 thief stats updated", async () => {
  resetStealStubsForTesting();
  const db = createDb(6, [plot("plot-1")], {
    thiefStats: { totalAttemptsLifetime: 4, totalSuccessesLifetime: 3 },
  });
  installMockSupabase(db);

  await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  const stats = db.players.find((row) => row.id === THIEF_ID)!.thief_stats;
  assertEquals(stats.totalAttemptsLifetime, 5, "attempts");
  assertEquals(stats.totalSuccessesLifetime, 4, "successes");
});

Deno.test("T6.3.9 target stats updated", async () => {
  resetStealStubsForTesting();
  const db = createDb(6, [plot("plot-1")], {
    targetStats: { timesStorenFrom: 7 },
  });
  installMockSupabase(db);

  await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(
    db.players.find((row) => row.id === TARGET_ID)!.thief_stats.timesStorenFrom,
    8,
    "times stolen from",
  );
});

Deno.test("T6.3.10 stranger score penalty", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(false);
  const db = createDb(6, [plot("plot-1")], { neighbourScore: 50 });
  installMockSupabase(db);

  await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(
    db.players.find((row) => row.id === THIEF_ID)?.neighbour_score,
    42,
    "score",
  );
});

Deno.test("T6.3.11 friend steal no score change", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(true);
  const db = createDb(6, [plot("plot-1")], { neighbourScore: 50 });
  installMockSupabase(db);

  await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(
    db.players.find((row) => row.id === THIEF_ID)?.neighbour_score,
    50,
    "score",
  );
});

Deno.test("T6.3.12 stranger counter increments", async () => {
  resetStealStubsForTesting();
  setMutualFriendResultForTesting(false);
  const todayUTC = new Date().toISOString().slice(0, 10);
  const db = createDb(6, [plot("plot-1")], {
    strangerStealsToday: { count: 1, resetDate: todayUTC },
  });
  installMockSupabase(db);

  await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(
    db.players.find((row) => row.id === THIEF_ID)?.stranger_steals_today,
    { count: 2, resetDate: todayUTC },
    "stranger steals today",
  );
});

Deno.test("T6.3.13 notification is anonymous", async () => {
  resetStealStubsForTesting();
  const db = createDb(6, [plot("plot-1")]);
  installMockSupabase(db);

  await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  const data = getStealStubCallsForTesting().notifications[0].data;
  assertEquals(data.anonymous, true, "anonymous");
  assertEquals("thiefPlayerId" in data, false, "no thief id");
  assertEquals("thiefName" in data, false, "no thief name");
});

Deno.test("T6.3.14 stolen items are Normal grade", async () => {
  resetStealStubsForTesting();
  const db = createDb(6, [plot("plot-1")]);
  installMockSupabase(db);

  const result = await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(result.itemsStolen?.[0].grade, "Normal", "grade");
});

Deno.test("T6.3.15 nemesis recalculated", async () => {
  resetStealStubsForTesting();
  const db = createDb(6, [plot("plot-1")], {
    stealLog: [
      { targetId: TARGET_ID, timestamp: 1 },
      { targetId: TARGET_ID, timestamp: 2 },
      { targetId: TARGET_ID, timestamp: 3 },
      { targetId: TARGET_ID, timestamp: 4 },
    ],
  });
  installMockSupabase(db);

  await attemptSteal(THIEF_ID, TARGET_ID, "plot-1");

  assertEquals(
    db.players.find((row) => row.id === THIEF_ID)?.thief_stats.nemesisPlayerId,
    TARGET_ID,
    "nemesis",
  );
});

Deno.test("T6.4.1 success rate", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(6, [], {
    thiefStats: { totalAttemptsLifetime: 5, totalSuccessesLifetime: 3 },
  }));

  const result = await getPublicThiefStats(THIEF_ID);

  assertEquals(result.successRatePercent, 60.0, "success rate");
});

Deno.test("T6.4.2 zero attempts", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(6, [], {
    thiefStats: { totalAttemptsLifetime: 0, totalSuccessesLifetime: 0 },
  }));

  const result = await getPublicThiefStats(THIEF_ID);

  assertEquals(result.successRatePercent, 0.0, "success rate");
});

Deno.test("T6.4.3 100% rate", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(6, [], {
    thiefStats: { totalAttemptsLifetime: 10, totalSuccessesLifetime: 10 },
  }));

  const result = await getPublicThiefStats(THIEF_ID);

  assertEquals(result.successRatePercent, 100.0, "success rate");
});

Deno.test("T6.4.4 one decimal", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(6, [], {
    thiefStats: { totalAttemptsLifetime: 3, totalSuccessesLifetime: 2 },
  }));

  const result = await getPublicThiefStats(THIEF_ID);

  assertEquals(result.successRatePercent, 66.7, "success rate");
});

Deno.test("T6.4.5 no private data", async () => {
  resetStealStubsForTesting();
  installMockSupabase(createDb(6, [], {
    thiefStats: {
      totalAttemptsLifetime: 5,
      totalSuccessesLifetime: 3,
      nemesisDisplayName: "Chef A",
      timesStorenFrom: 2,
    },
  }));

  const result = await getPublicThiefStats(THIEF_ID);
  const keys = Object.keys(result);

  assertEquals(keys.includes("coins"), false, "no coins");
  assertEquals(keys.includes("inventory"), false, "no inventory");
  assertEquals(keys.includes("steal_log"), false, "no steal log");
  assertEquals(
    keys.includes("stranger_steals_today"),
    false,
    "no daily counter",
  );
});

Deno.test("T6.4.6 score floor at 0", async () => {
  resetStealStubsForTesting();
  const db = createDb(6, [], { neighbourScore: 3 });
  installMockSupabase(db);

  const result = await updateNeighbourScore(THIEF_ID, -8);

  assertEquals(result.newScore, 0, "new score");
  assertEquals(
    db.players.find((row) => row.id === THIEF_ID)?.neighbour_score,
    0,
    "stored score",
  );
});

Deno.test("T6.4.7 score ceiling at 100", async () => {
  resetStealStubsForTesting();
  const db = createDb(6, [], { neighbourScore: 98 });
  installMockSupabase(db);

  const result = await updateNeighbourScore(THIEF_ID, 5);

  assertEquals(result.newScore, 100, "new score");
  assertEquals(
    db.players.find((row) => row.id === THIEF_ID)?.neighbour_score,
    100,
    "stored score",
  );
});

Deno.test("T6.4.8 score tier OUTLAW", async () => {
  resetStealStubsForTesting();
  const db = createDb(6, [], { neighbourScore: 3 });
  installMockSupabase(db);

  const result = await updateNeighbourScore(THIEF_ID, -8);

  assertEquals(result.tier, "OUTLAW", "tier");
  assertEquals(calculateNeighbourScoreTier(0), "OUTLAW", "re-exported tier");
});

Deno.test("T6.4.9 daily count auto-resets", async () => {
  resetStealStubsForTesting();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(
    0,
    10,
  );
  const today = new Date().toISOString().slice(0, 10);
  installMockSupabase(createDb(6, [], {
    strangerStealsToday: { count: 2, resetDate: yesterday },
  }));

  const result = await getDailyStrangerStealCount(THIEF_ID);

  assertEquals(result, { count: 0, resetDate: today }, "daily count");
});

Deno.test("T6.4.10 daily count same day", async () => {
  resetStealStubsForTesting();
  const today = new Date().toISOString().slice(0, 10);
  installMockSupabase(createDb(6, [], {
    strangerStealsToday: { count: 2, resetDate: today },
  }));

  const result = await getDailyStrangerStealCount(THIEF_ID);

  assertEquals(result, { count: 2, resetDate: today }, "daily count");
});
