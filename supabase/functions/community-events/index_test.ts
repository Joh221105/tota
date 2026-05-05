import {
  contributeToEvent,
  distributeEventRewards,
  getCommunityEventStubCallsForTesting,
  getDailyChallenges,
  resetCommunityEventStubsForTesting,
  updateChallengeProgress,
} from "./index.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";

type TableName =
  | "players"
  | "game_config"
  | "inventory"
  | "community_events"
  | "coin_transactions";

interface PlayerRow {
  id: string;
  coins: number;
  inventory_slots: Record<string, number>;
  daily_challenge_progress: Record<string, Record<string, unknown>>;
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

interface CommunityEventRow {
  id: string;
  event_type: string;
  title: string;
  contribution_type: string;
  start_at: string;
  end_at: string;
  current_total: number;
  milestones: Array<{
    threshold: number;
    rewardDistributed?: boolean;
    rewardTiers: Record<string, unknown>;
  }>;
  contributions: Array<{ playerId: string; value: number; timestamp: number }>;
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
  community_events: CommunityEventRow[];
  coin_transactions: CoinTransactionRow[];
}

const PLAYER_ID = "player-001";
const EVENT_ID = "event-001";
const MAY_4_SECONDS = Date.UTC(2026, 4, 4, 12, 0, 0) / 1000;
const MAY_5_SECONDS = Date.UTC(2026, 4, 5, 12, 0, 0) / 1000;

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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

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

function categoryFor(itemId: string): string {
  if (itemId.startsWith("crop_")) return "crops";
  if (itemId.startsWith("fish_")) return "fish";
  if (itemId.startsWith("animal_")) return "animal_produce";
  if (itemId.startsWith("processed_")) return "processed";
  if (itemId.startsWith("dish_")) return "cooked_dishes";
  return "tools";
}

function inv(
  playerId: string,
  itemId: string,
  grade: string,
  quantity: number,
): InventoryRow {
  return {
    id: `inv-${playerId}-${itemId}-${grade}`,
    player_id: playerId,
    item_id: itemId,
    grade,
    quantity,
    category: categoryFor(itemId),
  };
}

function player(overrides: Partial<PlayerRow> = {}): PlayerRow {
  return {
    id: PLAYER_ID,
    coins: 50_000,
    inventory_slots: {
      crops: 5000,
      fish: 5000,
      animal_produce: 5000,
      processed: 5000,
      cooked_dishes: 5000,
      tools: 5000,
    },
    daily_challenge_progress: {},
    ...clone(overrides),
  };
}

function event(overrides: Partial<CommunityEventRow> = {}): CommunityEventRow {
  return {
    id: EVENT_ID,
    event_type: "community",
    title: "Tomato Drive",
    contribution_type: "any_ingredient",
    start_at: "2020-01-01T00:00:00.000Z",
    end_at: "2030-01-01T00:00:00.000Z",
    current_total: 0,
    milestones: [],
    contributions: [],
    ...clone(overrides),
  };
}

function buildMockDatabase(overrides: {
  players?: PlayerRow[];
  inventory?: InventoryRow[];
  events?: CommunityEventRow[];
} = {}): MockDatabase {
  return {
    players: clone(overrides.players ?? [player()]),
    game_config: [
      {
        key: "EVENT_GRADE_MULTIPLIERS",
        value: JSON.stringify({
          Normal: 1,
          Bronze: 1.5,
          Silver: 2,
          Gold: 3,
          Diamond: 5,
          Legendary: 10,
        }),
      },
      { key: "EVENT_CONTRIBUTION_XP_CAP", value: JSON.stringify(500) },
      { key: "DAILY_CHALLENGE_COIN_REWARD", value: JSON.stringify(50) },
      { key: "DAILY_CHALLENGE_XP_REWARD", value: JSON.stringify(100) },
      { key: "crop_tomato", value: JSON.stringify({ baseValue: 10 }) },
      { key: "crop_big", value: JSON.stringify({ baseValue: 10_000 }) },
    ],
    inventory: clone(overrides.inventory ?? []),
    community_events: clone(overrides.events ?? [event()]),
    coin_transactions: [],
  };
}

function installMockSupabase(database: MockDatabase): MockDatabase {
  resetCommunityEventStubsForTesting();
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

class MockSupabaseClient {
  constructor(readonly database: MockDatabase) {}

  from(table: string): MockQueryBuilder {
    return new MockQueryBuilder(this.database, table as TableName);
  }

  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<
    { data: Record<string, unknown> | null; error: { message: string } | null }
  > {
    const playerRow = this.database.players.find((row) =>
      row.id === params.p_player_id
    );
    if (!playerRow) {
      return Promise.resolve({
        data: null,
        error: { message: "PLAYER_NOT_FOUND:" + String(params.p_player_id) },
      });
    }

    const amount = Number(params.p_amount);
    const before = playerRow.coins;
    if (functionName === "credit_coins") {
      playerRow.coins += amount;
    } else {
      return Promise.resolve({ data: null, error: { message: "UNKNOWN_RPC" } });
    }

    const tx = {
      id: `tx-${this.database.coin_transactions.length + 1}`,
      idempotency_key: String(params.p_idempotency_key),
      balance_before: before,
      balance_after: playerRow.coins,
    };
    this.database.coin_transactions.push(tx);
    return Promise.resolve({
      data: {
        success: true,
        transactionId: tx.id,
        balanceBefore: before,
        balanceAfter: playerRow.coins,
        idempotencyKey: tx.idempotency_key,
      },
      error: null,
    });
  }
}

class MockQueryBuilder {
  private selectedColumns = "*";
  private filters: Array<
    { column: string; op: "eq" | "in"; value: unknown }
  > = [];
  private insertValues: Record<string, unknown> | null = null;
  private updateValues: Record<string, unknown> | null = null;
  private deleteRequested = false;
  private countRequested = false;

  constructor(
    private readonly database: MockDatabase,
    private readonly table: TableName,
  ) {}

  select(
    columns: string,
    options?: { count?: "exact"; head?: boolean },
  ): MockQueryBuilder {
    this.selectedColumns = columns;
    this.countRequested = options?.count === "exact";
    return this;
  }

  eq(column: string, value: unknown): MockQueryBuilder {
    this.filters.push({ column, op: "eq", value });
    return this;
  }

  in(column: string, values: unknown[]): Promise<
    { data: Record<string, unknown>[] | null; error: null }
  > {
    this.filters.push({ column, op: "in", value: values });
    return Promise.resolve({
      data: this.matchingRows().map((row) => this.projectRow(row)),
      error: null,
    });
  }

  insert(values: Record<string, unknown>): MockQueryBuilder {
    this.insertValues = values;
    return this;
  }

  update(values: Record<string, unknown>): MockQueryBuilder {
    this.updateValues = values;
    return this;
  }

  delete(): MockQueryBuilder {
    this.deleteRequested = true;
    return this;
  }

  maybeSingle(): Promise<
    { data: Record<string, unknown> | null; error: null }
  > {
    const row = this.matchingRows()[0] ?? null;
    return Promise.resolve({
      data: row ? this.projectRow(row) : null,
      error: null,
    });
  }

  single(): Promise<{ data: Record<string, unknown> | null; error: null }> {
    const row = this.applyMutationAndReturnRows()[0] ?? null;
    return Promise.resolve({
      data: row ? this.projectRow(row) : null,
      error: null,
    });
  }

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

  private matchingRows(): Array<Record<string, unknown>> {
    return this.tableRows().filter((row) =>
      this.filters.every((filter) => {
        if (filter.op === "in") {
          return (filter.value as unknown[]).map(String).includes(
            String(row[filter.column]),
          );
        }
        return String(row[filter.column]) === String(filter.value);
      })
    );
  }

  private tableRows(): Array<Record<string, unknown>> {
    return this.database[this.table] as unknown as Array<
      Record<string, unknown>
    >;
  }

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

Deno.test("T9.3.1 Diamond contribution", async () => {
  installMockSupabase(buildMockDatabase({
    inventory: [inv(PLAYER_ID, "crop_tomato", "Diamond", 1)],
  }));

  const result = await withMockedNow(
    MAY_4_SECONDS,
    () => contributeToEvent(PLAYER_ID, EVENT_ID, "crop_tomato", "Diamond", 1),
  );

  assertEquals(result.contributionValue, 50, "contribution");
});

Deno.test("T9.3.2 Normal contribution", async () => {
  installMockSupabase(buildMockDatabase({
    inventory: [inv(PLAYER_ID, "crop_tomato", "Normal", 1)],
  }));

  const result = await withMockedNow(
    MAY_4_SECONDS,
    () => contributeToEvent(PLAYER_ID, EVENT_ID, "crop_tomato", "Normal", 1),
  );

  assertEquals(result.contributionValue, 10, "contribution");
});

Deno.test("T9.3.3 Items removed", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: [inv(PLAYER_ID, "crop_tomato", "Gold", 3)],
  }));

  await withMockedNow(
    MAY_4_SECONDS,
    () => contributeToEvent(PLAYER_ID, EVENT_ID, "crop_tomato", "Gold", 2),
  );

  assertEquals(database.inventory[0].quantity, 1, "remaining quantity");
});

Deno.test("T9.3.4 Milestone triggers rewards", async () => {
  installMockSupabase(buildMockDatabase({
    inventory: [inv(PLAYER_ID, "crop_tomato", "Normal", 1)],
    events: [event({
      current_total: 90,
      milestones: [{
        threshold: 100,
        rewardTiers: {
          gold: { tier: "gold" },
          silver: { tier: "silver" },
          bronze: { tier: "bronze" },
          participation: { tier: "participation" },
        },
      }],
    })],
  }));

  await withMockedNow(
    MAY_4_SECONDS,
    () => contributeToEvent(PLAYER_ID, EVENT_ID, "crop_tomato", "Normal", 1),
  );

  assertEquals(
    getCommunityEventStubCallsForTesting().rewardDistributions,
    [{ playerId: PLAYER_ID, reward: { tier: "gold" } }],
    "reward calls",
  );
});

Deno.test("T9.3.5 Top 10% Gold reward", async () => {
  installMockSupabase(buildMockDatabase());
  const contributions = Array.from({ length: 100 }, (_, index) => ({
    playerId: `player-${String(index + 1).padStart(3, "0")}`,
    value: 100 - index,
    timestamp: MAY_4_SECONDS,
  }));

  await distributeEventRewards(contributions, {
    threshold: 100,
    rewardTiers: {
      gold: { tier: "gold" },
      silver: { tier: "silver" },
      bronze: { tier: "bronze" },
      participation: { tier: "participation" },
    },
  });

  const calls = getCommunityEventStubCallsForTesting().rewardDistributions;
  assertEquals(
    calls.slice(0, 10).map((call) => call.reward),
    Array.from({ length: 10 }, () => ({ tier: "gold" })),
    "gold rewards",
  );
  assertEquals(calls[10].reward, { tier: "silver" }, "11th reward");
});

Deno.test("T9.3.6 Same challenges per day", async () => {
  installMockSupabase(buildMockDatabase());

  const results = [];
  for (let i = 0; i < 10; i++) {
    results.push(
      await withMockedNow(MAY_4_SECONDS, () => getDailyChallenges(PLAYER_ID)),
    );
  }

  const first = results[0].challenges.map((challenge) => challenge.key);
  for (const result of results) {
    assertEquals(
      result.challenges.map((challenge) => challenge.key),
      first,
      "challenge keys",
    );
  }
});

Deno.test("T9.3.7 Progress updates", async () => {
  const harvestPlayerId = "player-1";
  installMockSupabase(buildMockDatabase({
    players: [player({ id: harvestPlayerId })],
  }));
  const set = await withMockedNow(
    MAY_4_SECONDS,
    () => getDailyChallenges(harvestPlayerId),
  );
  if (
    !set.challenges.find((challenge) => challenge.key === "harvest_4_crops")
  ) {
    throw new Error("Test seed must select harvest_4_crops");
  }

  for (let i = 0; i < 4; i++) {
    await withMockedNow(
      MAY_4_SECONDS,
      () => updateChallengeProgress(harvestPlayerId, "harvest_crop"),
    );
  }

  const after = await withMockedNow(
    MAY_4_SECONDS,
    () => getDailyChallenges(harvestPlayerId),
  );
  assertEquals(
    after.challenges.find((challenge) => challenge.key === "harvest_4_crops"),
    { key: "harvest_4_crops", target: 4, progress: 4, complete: true },
    "harvest challenge",
  );
});

Deno.test("T9.3.8 All 3 complete - bonus", async () => {
  const database = installMockSupabase(buildMockDatabase());

  await completeTodaysChallenges(PLAYER_ID);

  assertEquals(database.players[0].coins, 50_050, "coins");
  assertEquals(
    database.inventory.find((row) =>
      row.player_id === PLAYER_ID && row.item_id === "timeskip_5min"
    )?.quantity,
    1,
    "timeskip",
  );
  assertEquals(
    getCommunityEventStubCallsForTesting().xpAwards.some((call) =>
      call.amount === 100 && call.source === "DAILY_CHALLENGE_COMPLETE"
    ),
    true,
    "xp awarded",
  );
});

Deno.test("T9.3.9 Bonus only once", async () => {
  const database = installMockSupabase(buildMockDatabase());

  await completeTodaysChallenges(PLAYER_ID);
  await withMockedNow(
    MAY_4_SECONDS,
    () => updateChallengeProgress(PLAYER_ID, "harvest_crop"),
  );

  assertEquals(database.players[0].coins, 50_050, "coins only once");
  assertEquals(
    database.inventory.filter((row) => row.item_id === "timeskip_5min").length,
    1,
    "one timeskip stack",
  );
});

Deno.test("T9.3.10 Progress resets daily", async () => {
  installMockSupabase(buildMockDatabase());

  await completeTodaysChallenges(PLAYER_ID);
  const dayTwo = await withMockedNow(
    MAY_5_SECONDS,
    () => getDailyChallenges(PLAYER_ID),
  );

  assertEquals(
    dayTwo.challenges.map((challenge) => challenge.progress),
    [0, 0, 0],
    "day two progress",
  );
});

Deno.test("T9.3.11 XP capped at 500", async () => {
  installMockSupabase(buildMockDatabase({
    inventory: [inv(PLAYER_ID, "crop_big", "Normal", 1)],
  }));

  const result = await withMockedNow(
    MAY_4_SECONDS,
    () => contributeToEvent(PLAYER_ID, EVENT_ID, "crop_big", "Normal", 1),
  );

  assertEquals(result.xpAwarded, 500, "xp cap");
});

async function completeTodaysChallenges(playerId: string): Promise<void> {
  const actionForChallenge: Record<string, string> = {
    harvest_4_crops: "harvest_crop",
    collect_animal_3_times: "collect_animal",
    catch_3_fish: "catch_fish",
    complete_2_processing_jobs: "complete_processing",
    harvest_perpetual_crop_2_times: "harvest_perpetual",
    recycle_junk_3_times: "recycle_junk",
    steal_from_neighbour: "steal_success",
    visit_2_friends: "visit_friend",
    help_a_neighbour: "help_neighbour",
    fulfill_wishlist: "fulfill_wishlist",
    post_wishlist: "post_wishlist",
    list_5_dishes: "list_dish",
    collect_restaurant_earnings: "collect_restaurant",
    sell_favoured_dish: "sell_favoured",
  };

  const set = await withMockedNow(
    MAY_4_SECONDS,
    () => getDailyChallenges(playerId),
  );
  for (const challenge of set.challenges) {
    for (let i = 0; i < challenge.target; i++) {
      await withMockedNow(
        MAY_4_SECONDS,
        () =>
          updateChallengeProgress(playerId, actionForChallenge[challenge.key]),
      );
    }
  }
}
