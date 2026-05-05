import {
  addLevelMilestoneFeedEvent,
  addNeighbourhoodFeedEvent,
  getNeighbourhoodFeed,
  getNeighbourhoodLeaderboard,
} from "./index.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";

type TableName = "players" | "neighbourhood_feed" | "neighbourhood_members";

interface PlayerRow {
  id: string;
  display_name: string | null;
  neighbourhood_id: string | null;
  lifetime_stats: Record<string, number>;
}

interface FeedRow {
  id: string;
  neighbourhood_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  trigger_player_id: string | null;
  created_at: string;
  expires_at: string;
}

interface MemberRow {
  neighbourhood_id: string;
  player_id: string;
}

interface MockDatabase {
  players: PlayerRow[];
  neighbourhood_feed: FeedRow[];
  neighbourhood_members: MemberRow[];
  nextFeedNumber: number;
}

const PLAYER_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_ID = "00000000-0000-0000-0000-000000000002";
const NB_A = "10000000-0000-0000-0000-000000000001";
const NB_B = "10000000-0000-0000-0000-000000000002";

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
 * Creates a JSON-compatible deep clone.
 * @param value - Value to clone.
 * @returns Cloned value.
 * @throws Never.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Returns an ISO timestamp offset from now.
 * @param secondsAgo - Seconds before now.
 * @returns ISO timestamp.
 * @throws Never.
 */
function isoSecondsAgo(secondsAgo: number): string {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

/**
 * Builds default lifetime stats.
 * @param restaurantEarnings - Restaurant earnings lifetime value.
 * @returns Lifetime stats object.
 * @throws Never.
 */
function lifetimeStats(restaurantEarnings = 0): Record<string, number> {
  return {
    crops_harvested: 0,
    fish_caught: 0,
    help_actions_given: 0,
    steals_attempted: 0,
    restaurant_earnings_lifetime: restaurantEarnings,
  };
}

/**
 * Builds a player fixture.
 * @param id - Player id.
 * @param neighbourhoodId - Neighbourhood id.
 * @param restaurantEarnings - Restaurant lifetime earnings.
 * @returns Player row.
 * @throws Never.
 */
function player(
  id: string,
  neighbourhoodId: string | null,
  restaurantEarnings = 0,
): PlayerRow {
  return {
    id,
    display_name: "Player " + id.slice(-2),
    neighbourhood_id: neighbourhoodId,
    lifetime_stats: lifetimeStats(restaurantEarnings),
  };
}

/**
 * Builds a feed row fixture.
 * @param db - Mock database.
 * @param neighbourhoodId - Neighbourhood id.
 * @param createdAt - Created timestamp.
 * @param overrides - Optional feed overrides.
 * @returns Feed row.
 * @throws Never.
 */
function feedRow(
  db: MockDatabase,
  neighbourhoodId: string,
  createdAt: string,
  overrides: Partial<FeedRow> = {},
): FeedRow {
  return {
    id: "feed-" + db.nextFeedNumber++,
    neighbourhood_id: neighbourhoodId,
    event_type: "TEST_EVENT",
    event_data: {},
    trigger_player_id: PLAYER_ID,
    created_at: createdAt,
    expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    ...overrides,
  };
}

/**
 * Builds a clean mock database.
 * @returns Mock database.
 * @throws Never.
 */
function buildDb(): MockDatabase {
  return {
    players: [
      player(PLAYER_ID, NB_A),
      player(OTHER_ID, NB_B),
    ],
    neighbourhood_feed: [],
    neighbourhood_members: [{ neighbourhood_id: NB_A, player_id: PLAYER_ID }],
    nextFeedNumber: 1,
  };
}

class MockSupabaseClient {
  readonly database: MockDatabase;

  /**
   * Creates a mock client.
   * @param database - Backing database.
   * @returns Mock client.
   * @throws Never.
   */
  constructor(database: MockDatabase) {
    this.database = database;
  }

  /**
   * Starts a query.
   * @param table - Table name.
   * @returns Query builder.
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
  private inFilters: Array<{ column: string; values: string[] }> = [];
  private gtFilters: Array<{ column: string; value: string }> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private rangeStart: number | null = null;
  private rangeEnd: number | null = null;
  private insertValues: Record<string, unknown> | null = null;

  /**
   * Creates a query builder.
   * @param database - Backing database.
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
   * @param columns - Selected columns.
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
  eq(column: string, value: unknown): MockQueryBuilder {
    this.filters.push({ column, value });
    return this;
  }

  /**
   * Adds an IN filter.
   * @param column - Column name.
   * @param values - Accepted values.
   * @returns Current query builder.
   * @throws Never.
   */
  in(column: string, values: string[]): MockQueryBuilder {
    this.inFilters.push({ column, values });
    return this;
  }

  /**
   * Adds a greater-than filter.
   * @param column - Column name.
   * @param value - Exclusive lower bound.
   * @returns Current query builder.
   * @throws Never.
   */
  gt(column: string, value: string): MockQueryBuilder {
    this.gtFilters.push({ column, value });
    return this;
  }

  /**
   * Adds ordering.
   * @param column - Column or JSON path.
   * @param options - Ordering options.
   * @returns Current query builder.
   * @throws Never.
   */
  order(column: string, options: { ascending: boolean }): MockQueryBuilder {
    this.orderBy = { column, ascending: options.ascending };
    return this;
  }

  /**
   * Adds an inclusive range.
   * @param from - Start index.
   * @param to - End index.
   * @returns Current query builder.
   * @throws Never.
   */
  range(from: number, to: number): MockQueryBuilder {
    this.rangeStart = from;
    this.rangeEnd = to;
    return this;
  }

  /**
   * Records an insert.
   * @param values - Insert values.
   * @returns Current query builder.
   * @throws Never.
   */
  insert(values: Record<string, unknown>): MockQueryBuilder {
    this.insertValues = values;
    return this;
  }

  /**
   * Resolves a single row.
   * @returns Single row result.
   * @throws Never.
   */
  async single(): Promise<
    { data: Record<string, unknown> | null; error: null }
  > {
    const result = await this.execute();
    return { data: result.data[0] ?? null, error: null };
  }

  /**
   * Makes builders awaitable.
   * @param onfulfilled - Fulfilled callback.
   * @param onrejected - Rejected callback.
   * @returns Promise-like result.
   * @throws Never.
   */
  then<TResult1 = MockExecuteResult, TResult2 = never>(
    onfulfilled?:
      | ((value: MockExecuteResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  /**
   * Executes the query.
   * @returns Query result.
   * @throws Never.
   */
  private async execute(): Promise<MockExecuteResult> {
    await Promise.resolve();
    if (this.insertValues) return this.executeInsert();

    let rows = this.matchingRows();
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = rows.toSorted((a, b) => {
        const left = valueForOrder(a, column);
        const right = valueForOrder(b, column);
        if (left < right) return ascending ? -1 : 1;
        if (left > right) return ascending ? 1 : -1;
        return 0;
      });
    }
    if (this.rangeStart != null && this.rangeEnd != null) {
      rows = rows.slice(this.rangeStart, this.rangeEnd + 1);
    }

    return { data: rows.map((row) => this.projectRow(row)), error: null };
  }

  /**
   * Executes an insert.
   * @returns Insert result.
   * @throws Never.
   */
  private executeInsert(): MockExecuteResult {
    if (this.table !== "neighbourhood_feed") return { data: [], error: null };
    const row: FeedRow = {
      id: "feed-" + this.database.nextFeedNumber++,
      neighbourhood_id: String(this.insertValues?.neighbourhood_id),
      event_type: String(this.insertValues?.event_type),
      event_data: clone(
        this.insertValues?.event_data as Record<string, unknown>,
      ),
      trigger_player_id: String(this.insertValues?.trigger_player_id),
      created_at: new Date().toISOString(),
      expires_at: String(this.insertValues?.expires_at),
    };
    this.database.neighbourhood_feed.push(row);
    trimFeedTo200(this.database, row.neighbourhood_id);
    return {
      data: [this.projectRow(row as unknown as Record<string, unknown>)],
      error: null,
    };
  }

  /**
   * Returns rows matching current filters.
   * @returns Matching rows.
   * @throws Never.
   */
  private matchingRows(): Array<Record<string, unknown>> {
    return this.tableRows().filter((row) =>
      this.filters.every((filter) => row[filter.column] === filter.value) &&
      this.inFilters.every((filter) =>
        filter.values.includes(String(row[filter.column]))
      ) &&
      this.gtFilters.every((filter) =>
        String(row[filter.column]) > filter.value
      )
    );
  }

  /**
   * Returns mutable table rows.
   * @returns Table rows.
   * @throws Never.
   */
  private tableRows(): Array<Record<string, unknown>> {
    return this.database[this.table] as unknown as Array<
      Record<string, unknown>
    >;
  }

  /**
   * Projects selected columns.
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

interface MockExecuteResult {
  data: Record<string, unknown>[];
  error: null;
}

/**
 * Returns the comparable value for a requested order column.
 * @param row - Source row.
 * @param column - Column or JSON path.
 * @returns Comparable value.
 * @throws Never.
 */
function valueForOrder(
  row: Record<string, unknown>,
  column: string,
): string | number {
  if (column.startsWith("lifetime_stats->>")) {
    const key = column.replace("lifetime_stats->>", "");
    const stats = row.lifetime_stats as Record<string, number> | undefined;
    return Number(stats?.[key] ?? 0);
  }
  return row[column] as string | number;
}

/**
 * Trims one neighbourhood feed to the newest 200 events, matching the migration trigger.
 * @param database - Mock database.
 * @param neighbourhoodId - Neighbourhood id.
 * @returns Nothing.
 * @throws Never.
 */
function trimFeedTo200(database: MockDatabase, neighbourhoodId: string): void {
  const rows = database.neighbourhood_feed
    .filter((row) => row.neighbourhood_id === neighbourhoodId)
    .toSorted((a, b) => b.created_at.localeCompare(a.created_at));
  const keepIds = new Set(rows.slice(0, 200).map((row) => row.id));
  database.neighbourhood_feed = database.neighbourhood_feed.filter((row) =>
    row.neighbourhood_id !== neighbourhoodId || keepIds.has(row.id)
  );
}

/**
 * Installs a fresh mock Supabase client.
 * @returns Mock database.
 * @throws Never.
 */
function installMockSupabase(): MockDatabase {
  const database = buildDb();
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

Deno.test("T7.4.1 Feed event added appears in getNeighbourhoodFeed", async () => {
  installMockSupabase();

  await addNeighbourhoodFeedEvent(PLAYER_ID, "STEAL", {
    cropId: "crop_carrot",
    anonymous: true,
  });
  const feed = await getNeighbourhoodFeed(PLAYER_ID);

  assertEquals(feed.length, 1, "feed count");
  assertEquals(feed[0].event_type, "STEAL", "event type");
  assertEquals(feed[0].event_data, {
    cropId: "crop_carrot",
    anonymous: true,
  }, "event data");
});

Deno.test("T7.4.2 Feed sorted newest first", async () => {
  const db = installMockSupabase();
  db.neighbourhood_feed.push(
    feedRow(db, NB_A, isoSecondsAgo(300), { event_type: "old" }),
    feedRow(db, NB_A, isoSecondsAgo(60), { event_type: "new" }),
    feedRow(db, NB_A, isoSecondsAgo(180), { event_type: "middle" }),
  );

  const feed = await getNeighbourhoodFeed(PLAYER_ID);

  assertEquals(feed.map((event) => event.event_type), [
    "new",
    "middle",
    "old",
  ], "event order");
});

Deno.test("T7.4.3 Expired feed events are not returned", async () => {
  const db = installMockSupabase();
  db.neighbourhood_feed.push(
    feedRow(db, NB_A, isoSecondsAgo(8 * 24 * 3600), {
      event_type: "expired",
      expires_at: isoSecondsAgo(24 * 3600),
    }),
  );

  const feed = await getNeighbourhoodFeed(PLAYER_ID);

  assertEquals(feed.length, 0, "feed count");
});

Deno.test("T7.4.4 Steal feed event stays anonymous", async () => {
  installMockSupabase();

  await addNeighbourhoodFeedEvent(PLAYER_ID, "STEAL", {
    anonymous: true,
    targetPlayerId: OTHER_ID,
  });
  const feed = await getNeighbourhoodFeed(PLAYER_ID);

  assertEquals(
    Object.hasOwn(feed[0].event_data, "thiefName"),
    false,
    "thiefName absent",
  );
  assertEquals(
    Object.hasOwn(feed[0].event_data, "displayName"),
    false,
    "displayName absent",
  );
});

Deno.test("T7.4.5 Level 15 does not create feed event", async () => {
  const db = installMockSupabase();

  await addLevelMilestoneFeedEvent(PLAYER_ID, 15);

  assertEquals(db.neighbourhood_feed.length, 0, "feed count");
});

Deno.test("T7.4.6 Level 20 creates feed event", async () => {
  const db = installMockSupabase();

  await addLevelMilestoneFeedEvent(PLAYER_ID, 20);

  assertEquals(db.neighbourhood_feed.length, 1, "feed count");
  assertEquals(
    db.neighbourhood_feed[0].event_type,
    "LEVEL_MILESTONE",
    "event type",
  );
  assertEquals(
    db.neighbourhood_feed[0].event_data,
    { level: 20 },
    "event data",
  );
});

Deno.test("T7.4.7 Different neighbourhood feed is filtered out", async () => {
  const db = installMockSupabase();
  db.neighbourhood_feed.push(
    feedRow(db, NB_B, isoSecondsAgo(60), { event_type: "other-hood" }),
  );

  const feed = await getNeighbourhoodFeed(PLAYER_ID);

  assertEquals(feed.length, 0, "feed count");
});

Deno.test("T7.4.8 Leaderboard returns exactly top 10 entries", async () => {
  const db = installMockSupabase();
  db.players = [];
  db.neighbourhood_members = [];
  for (let index = 1; index <= 12; index += 1) {
    const id = "player-" + String(index).padStart(2, "0");
    db.players.push(player(id, NB_A, 1000 - index));
    db.neighbourhood_members.push({ neighbourhood_id: NB_A, player_id: id });
  }

  const result = await getNeighbourhoodLeaderboard(
    "player-01",
    "restaurant_earnings",
  );

  assertEquals(result.entries.length, 10, "entry count");
  assertEquals(result.entries[0].playerId, "player-01", "top player");
});

Deno.test("T7.4.9 Leaderboard includes playerRank outside top 10", async () => {
  const db = installMockSupabase();
  db.players = [];
  db.neighbourhood_members = [];
  for (let index = 1; index <= 14; index += 1) {
    const id = "player-" + String(index).padStart(2, "0");
    db.players.push(player(id, NB_A, 1000 - index));
    db.neighbourhood_members.push({ neighbourhood_id: NB_A, player_id: id });
  }

  const result = await getNeighbourhoodLeaderboard(
    "player-14",
    "restaurant_earnings",
  );

  assertEquals(result.entries.length, 10, "entry count");
  assertEquals(result.playerRank, 14, "player rank");
  assertEquals(result.playerScore, 986, "player score");
});

Deno.test("T7.4.10 Feed trigger retains newest 200 entries", () => {
  const db = installMockSupabase();
  for (let index = 0; index < 201; index += 1) {
    db.neighbourhood_feed.push(
      feedRow(db, NB_A, isoSecondsAgo(201 - index), {
        event_type: "event-" + index,
      }),
    );
    trimFeedTo200(db, NB_A);
  }

  assertEquals(db.neighbourhood_feed.length, 200, "feed count");
  assertEquals(
    db.neighbourhood_feed.some((event) => event.event_type === "event-0"),
    false,
    "oldest removed",
  );
});
