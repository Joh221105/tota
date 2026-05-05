import {
  acceptFriendRequest,
  declineFriendRequest,
  getFriendsList,
  isMutualFriend,
  removeFriend,
  sendFriendRequest,
} from "./index.ts";
import {
  getStealStubCallsForTesting,
  resetStealStubsForTesting,
} from "../p2-steal/index.ts";
import { setSupabaseAdminForTesting } from "../_lib/supabase.ts";
import type { FarmPlot } from "../_lib/farm.ts";
import type { AnimalRecord } from "../_lib/animals.ts";
import type { FishingTrap } from "../p1-traps/index.ts";

type TableName = "players" | "friend_requests" | "friendships" | "game_config";

interface PlayerRow {
  id: string;
  display_name: string | null;
  level: number;
  michelin_stars: number;
  neighbour_score: number;
  equipped_pet: string | null;
  restaurant: { tier: number };
  thief_stats: {
    totalAttemptsLifetime: number;
    totalSuccessesLifetime: number;
    nemesisDisplayName: string | null;
    timesStorenFrom: number;
  };
  farm_plots: FarmPlot[];
  animals: Record<string, AnimalRecord>;
  fishing_traps: FishingTrap[];
}

interface FriendRequestRow {
  id: string;
  from_id: string;
  to_id: string;
  status: "pending" | "accepted" | "declined";
  sent_at: string;
}

interface FriendshipRow {
  player_id: string;
  friend_id: string;
  created_at: string;
}

interface GameConfigRow {
  key: string;
  value: string;
}

interface MockDatabase {
  players: PlayerRow[];
  friend_requests: FriendRequestRow[];
  friendships: FriendshipRow[];
  game_config: GameConfigRow[];
  nextRequestNumber: number;
}

const A_ID = "00000000-0000-0000-0000-00000000000a";
const B_ID = "00000000-0000-0000-0000-00000000000b";
const C_ID = "00000000-0000-0000-0000-00000000000c";

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
 * Asserts that an async action rejects with an exact error message.
 * @param action - Async action expected to reject.
 * @param expectedMessage - Expected exact message.
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
 * Creates a JSON-compatible deep clone.
 * @param value - Value to clone.
 * @returns Cloned value.
 * @throws Never.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Builds an empty farm plot fixture.
 * @returns Farm plot fixture.
 * @throws Never.
 */
function emptyPlot(): FarmPlot {
  return {
    plotId: "plot-1",
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
 * Builds a public player row fixture.
 * @param id - Player id.
 * @param name - Display name.
 * @returns Player row.
 * @throws Never.
 */
function player(id: string, name: string): PlayerRow {
  return {
    id,
    display_name: name,
    level: 12,
    michelin_stars: 1,
    neighbour_score: 50,
    equipped_pet: null,
    restaurant: { tier: 2 },
    thief_stats: {
      totalAttemptsLifetime: 0,
      totalSuccessesLifetime: 0,
      nemesisDisplayName: null,
      timesStorenFrom: 0,
    },
    farm_plots: [emptyPlot()],
    animals: {},
    fishing_traps: [],
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
      player(A_ID, "Aster"),
      player(B_ID, "Basil"),
      player(C_ID, "Clover"),
    ],
    friend_requests: [],
    friendships: [],
    game_config: [
      {
        key: "animal_cow",
        value: JSON.stringify({
          animalType: "cow",
          displayName: "Cow",
          feedIntervalSeconds: 28_800,
          feedCostCoins: 5,
          feedItemId: "animal_hay",
          unlockLevel: 1,
          products: [],
        }),
      },
    ],
    nextRequestNumber: 1,
  };
}

class MockSupabaseClient {
  readonly database: MockDatabase;

  /**
   * Creates a mock client.
   * @param database - Backing in-memory database.
   * @returns Mock client.
   * @throws Never.
   */
  constructor(database: MockDatabase) {
    this.database = database;
  }

  /**
   * Starts a query for a mock table.
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
  private filters: Array<{ column: string; value: string }> = [];
  private countMode = false;
  private headMode = false;
  private mutation:
    | {
      kind: "insert";
      values: Record<string, unknown> | Record<string, unknown>[];
    }
    | { kind: "update"; values: Record<string, unknown> }
    | { kind: "delete" }
    | null = null;
  private orPairs: Array<Record<string, string>> = [];

  /**
   * Creates a query builder.
   * @param database - Backing in-memory database.
   * @param table - Queried table.
   * @returns Query builder.
   * @throws Never.
   */
  constructor(database: MockDatabase, table: TableName) {
    this.database = database;
    this.table = table;
  }

  /**
   * Records selected columns and count options.
   * @param columns - Selected column list.
   * @param options - Optional count/head options.
   * @returns Current query builder.
   * @throws Never.
   */
  select(
    columns: string,
    options: { count?: "exact"; head?: boolean } = {},
  ): MockQueryBuilder {
    this.selectedColumns = columns;
    this.countMode = options.count === "exact";
    this.headMode = options.head === true;
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
   * Adds an IN filter for game_config queries.
   * @param column - Column name.
   * @param values - Accepted values.
   * @returns Query result.
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
   * Records an OR expression used by social friendship queries.
   * @param expression - Supabase OR expression.
   * @returns Current query builder.
   * @throws Never.
   */
  or(expression: string): MockQueryBuilder {
    this.orPairs = parseFriendshipPairs(expression);
    return this;
  }

  /**
   * Records an insert mutation.
   * @param values - Insert values.
   * @returns Current query builder.
   * @throws Never.
   */
  insert(
    values: Record<string, unknown> | Record<string, unknown>[],
  ): MockQueryBuilder {
    this.mutation = { kind: "insert", values };
    return this;
  }

  /**
   * Records an update mutation.
   * @param values - Updated values.
   * @returns Current query builder.
   * @throws Never.
   */
  update(values: Record<string, unknown>): MockQueryBuilder {
    this.mutation = { kind: "update", values };
    return this;
  }

  /**
   * Records a delete mutation.
   * @returns Current query builder.
   * @throws Never.
   */
  delete(): MockQueryBuilder {
    this.mutation = { kind: "delete" };
    return this;
  }

  /**
   * Resolves a single row query.
   * @returns Query result.
   * @throws Never.
   */
  async single(): Promise<
    { data: Record<string, unknown> | null; error: null }
  > {
    const result = await this.execute();
    return { data: result.data[0] ?? null, error: null };
  }

  /**
   * Resolves a maybe-single row query.
   * @returns Query result.
   * @throws Never.
   */
  async maybeSingle(): Promise<
    { data: Record<string, unknown> | null; error: null }
  > {
    const result = await this.execute();
    return { data: result.data[0] ?? null, error: null };
  }

  /**
   * Makes mutation builders awaitable.
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
   * Executes the current query or mutation.
   * @returns Query result.
   * @throws Never.
   */
  private async execute(): Promise<MockExecuteResult> {
    await Promise.resolve();
    if (this.mutation?.kind === "insert") return this.executeInsert();
    if (this.mutation?.kind === "update") return this.executeUpdate();
    if (this.mutation?.kind === "delete") return this.executeDelete();

    const rows = this.matchingRows();
    return {
      data: this.headMode ? [] : rows.map((row) => this.projectRow(row)),
      error: null,
      count: this.countMode ? rows.length : null,
    };
  }

  /**
   * Executes an insert mutation.
   * @returns Mutation result.
   * @throws Never.
   */
  private executeInsert(): MockExecuteResult {
    if (this.mutation?.kind !== "insert") {
      return { data: [], error: null, count: null };
    }
    const rows: Record<string, unknown>[] = Array.isArray(this.mutation.values)
      ? this.mutation.values
      : [this.mutation.values];
    const inserted = rows.map((row) => this.insertRow(row));
    return {
      data: inserted.map((row) => this.projectRow(row)),
      error: null,
      count: null,
    };
  }

  /**
   * Executes an update mutation.
   * @returns Mutation result.
   * @throws Never.
   */
  private executeUpdate(): MockExecuteResult {
    const rows = this.matchingRows();
    for (const row of rows) {
      Object.assign(
        row,
        this.mutation?.kind === "update" ? this.mutation.values : {},
      );
    }
    return {
      data: rows.map((row) => this.projectRow(row)),
      error: null,
      count: null,
    };
  }

  /**
   * Executes a delete mutation.
   * @returns Mutation result.
   * @throws Never.
   */
  private executeDelete(): MockExecuteResult {
    const rows = this.tableRows();
    const keep = rows.filter((row) => !this.matches(row));
    rows.splice(0, rows.length, ...keep);
    return { data: [], error: null, count: null };
  }

  /**
   * Inserts one row into the target table.
   * @param row - Insert values.
   * @returns Inserted row.
   * @throws Never.
   */
  private insertRow(row: Record<string, unknown>): Record<string, unknown> {
    if (this.table === "friend_requests") {
      const inserted: FriendRequestRow = {
        id: "request-" + this.database.nextRequestNumber++,
        from_id: String(row.from_id),
        to_id: String(row.to_id),
        status: String(row.status) as FriendRequestRow["status"],
        sent_at: "2026-05-04T00:00:00.000Z",
      };
      this.database.friend_requests.push(inserted);
      return inserted as unknown as Record<string, unknown>;
    }
    if (this.table === "friendships") {
      const inserted: FriendshipRow = {
        player_id: String(row.player_id),
        friend_id: String(row.friend_id),
        created_at: "2026-05-04T00:00:00.000Z",
      };
      this.database.friendships.push(inserted);
      return inserted as unknown as Record<string, unknown>;
    }
    return row;
  }

  /**
   * Returns rows matching filters and OR expressions.
   * @returns Matching rows.
   * @throws Never.
   */
  private matchingRows(): Array<Record<string, unknown>> {
    return this.tableRows().filter((row) => this.matches(row));
  }

  /**
   * Checks whether one row matches the query.
   * @param row - Source row.
   * @returns True if the row matches.
   * @throws Never.
   */
  private matches(row: Record<string, unknown>): boolean {
    const filtersMatch = this.filters.every((filter) =>
      String(row[filter.column]) === filter.value
    );
    const orMatch = this.orPairs.length === 0 ||
      this.orPairs.some((pair) =>
        Object.entries(pair).every(([column, value]) =>
          String(row[column]) === value
        )
      );
    return filtersMatch && orMatch;
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
   * Projects selected columns from one row.
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
  count: number | null;
}

/**
 * Parses the limited friendship OR expressions used by Task 7.1.
 * @param expression - Supabase OR expression.
 * @returns Column/value pairs for each OR branch.
 * @throws Never.
 */
function parseFriendshipPairs(
  expression: string,
): Array<Record<string, string>> {
  const pairs: Array<Record<string, string>> = [];
  const mutualPattern = /player_id\.eq\.([^,\)]+),friend_id\.eq\.([^,\)]+)/g;
  for (const match of expression.matchAll(mutualPattern)) {
    pairs.push({ player_id: match[1], friend_id: match[2] });
  }
  if (pairs.length > 0) return pairs;

  const deletePattern = /player_id\.eq\.([^\.]+)\.and\.friend_id\.eq\.([^,]+)/g;
  for (const match of expression.matchAll(deletePattern)) {
    pairs.push({ player_id: match[1], friend_id: match[2] });
  }
  return pairs;
}

/**
 * Installs a fresh mock Supabase client.
 * @returns Mock database.
 * @throws Never.
 */
function installMockSupabase(): MockDatabase {
  resetStealStubsForTesting();
  const database = buildDb();
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

Deno.test("T7.1.1 Send request inserts pending row and notifies target", async () => {
  const db = installMockSupabase();

  const result = await sendFriendRequest(A_ID, B_ID);

  assertEquals(result, { success: true, requestId: "request-1" }, "result");
  assertEquals(db.friend_requests.length, 1, "request count");
  assertEquals(db.friend_requests[0].status, "pending", "request status");
  assertEquals(db.friend_requests[0].from_id, A_ID, "from id");
  assertEquals(db.friend_requests[0].to_id, B_ID, "to id");
  assertEquals(getStealStubCallsForTesting().notifications, [
    { playerId: B_ID, type: "NEW_FRIEND_REQUEST", data: { fromId: A_ID } },
  ], "notifications");
});

Deno.test("T7.1.2 Duplicate pending request is blocked", async () => {
  installMockSupabase();

  await sendFriendRequest(A_ID, B_ID);
  await assertRejectsWithMessage(
    () => sendFriendRequest(A_ID, B_ID),
    "ALREADY_SENT",
  );
});

Deno.test("T7.1.3 Accept inserts bilateral friendship rows", async () => {
  const db = installMockSupabase();
  const request = await sendFriendRequest(A_ID, B_ID);

  const result = await acceptFriendRequest(B_ID, request.requestId);

  assertEquals(result, { success: true, newFriendId: A_ID }, "result");
  assertEquals(db.friend_requests[0].status, "accepted", "request status");
  assertEquals(db.friendships.map((row) => [row.player_id, row.friend_id]), [
    [B_ID, A_ID],
    [A_ID, B_ID],
  ], "friendship rows");
});

Deno.test("T7.1.4 isMutualFriend true after accept in both directions", async () => {
  installMockSupabase();
  const request = await sendFriendRequest(A_ID, B_ID);
  await acceptFriendRequest(B_ID, request.requestId);

  assertEquals(await isMutualFriend(A_ID, B_ID), true, "A to B");
  assertEquals(await isMutualFriend(B_ID, A_ID), true, "B to A");
});

Deno.test("T7.1.5 Decline creates no friendship", async () => {
  const db = installMockSupabase();
  const request = await sendFriendRequest(A_ID, B_ID);

  await declineFriendRequest(B_ID, request.requestId);

  assertEquals(db.friend_requests[0].status, "declined", "request status");
  assertEquals(db.friendships.length, 0, "friendship count");
  assertEquals(await isMutualFriend(A_ID, B_ID), false, "mutual");
});

Deno.test("T7.1.6 Remove friend deletes both rows", async () => {
  const db = installMockSupabase();
  const request = await sendFriendRequest(A_ID, B_ID);
  await acceptFriendRequest(B_ID, request.requestId);

  await removeFriend(A_ID, B_ID);

  assertEquals(db.friendships.length, 0, "friendship count");
  assertEquals(await isMutualFriend(A_ID, B_ID), false, "mutual");
});

Deno.test("T7.1.7 Self-request throws CANNOT_FRIEND_SELF", async () => {
  installMockSupabase();

  await assertRejectsWithMessage(
    () => sendFriendRequest(A_ID, A_ID),
    "CANNOT_FRIEND_SELF",
  );
});

Deno.test("T7.1.8 getFriendsList includes has_help_needed true for bugged friend", async () => {
  const db = installMockSupabase();
  db.friendships.push({
    player_id: A_ID,
    friend_id: B_ID,
    created_at: "2026-05-04T00:00:00.000Z",
  });
  db.players.find((row) => row.id === B_ID)!.farm_plots[0].hasBugs = true;

  const friends = await getFriendsList(A_ID);

  assertEquals(friends.length, 1, "friend count");
  assertEquals(friends[0].playerId, B_ID, "friend id");
  assertEquals(friends[0].displayName, "Basil", "display name");
  assertEquals(friends[0].has_help_needed, true, "help flag");
});

Deno.test("T7.1.9 Cannot accept another player's request", async () => {
  installMockSupabase();
  const request = await sendFriendRequest(A_ID, B_ID);

  await assertRejectsWithMessage(
    () => acceptFriendRequest(C_ID, request.requestId),
    "REQUEST_NOT_FOUND",
  );
});
