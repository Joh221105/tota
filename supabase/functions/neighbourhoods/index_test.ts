import { assignToNeighbourhood, runMonthlyRotation } from "./index.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";

type TableName =
  | "players"
  | "friendships"
  | "neighbourhoods"
  | "neighbourhood_members";

interface PlayerRow {
  id: string;
  neighbourhood_id: string | null;
  last_active_timestamp: number;
}

interface FriendshipRow {
  player_id: string;
  friend_id: string;
}

interface NeighbourhoodRow {
  id: string;
  member_count: number;
  created_at: string;
}

interface NeighbourhoodMemberRow {
  neighbourhood_id: string;
  player_id: string;
  joined_at: string;
}

interface MockDatabase {
  players: PlayerRow[];
  friendships: FriendshipRow[];
  neighbourhoods: NeighbourhoodRow[];
  neighbourhood_members: NeighbourhoodMemberRow[];
  nextNeighbourhoodNumber: number;
  rpcCalls: Array<{ functionName: string; params: Record<string, unknown> }>;
}

const PLAYER_ID = "00000000-0000-0000-0000-000000000001";
const FRIEND_1_ID = "00000000-0000-0000-0000-000000000002";
const FRIEND_2_ID = "00000000-0000-0000-0000-000000000003";
const ACTIVE_ID = "00000000-0000-0000-0000-000000000004";
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
 * Returns the current Unix timestamp in seconds.
 * @returns Current Unix second.
 * @throws Never.
 */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Builds a player fixture.
 * @param id - Player id.
 * @param neighbourhoodId - Optional neighbourhood id.
 * @param lastActiveTimestamp - Last active timestamp.
 * @returns Player row.
 * @throws Never.
 */
function player(
  id: string,
  neighbourhoodId: string | null = null,
  lastActiveTimestamp = nowSeconds(),
): PlayerRow {
  return {
    id,
    neighbourhood_id: neighbourhoodId,
    last_active_timestamp: lastActiveTimestamp,
  };
}

/**
 * Builds a neighbourhood fixture.
 * @param id - Neighbourhood id.
 * @param memberCount - Member count.
 * @returns Neighbourhood row.
 * @throws Never.
 */
function neighbourhood(id: string, memberCount: number): NeighbourhoodRow {
  return {
    id,
    member_count: memberCount,
    created_at: "2026-05-04T00:00:00.000Z",
  };
}

/**
 * Builds a base mock database.
 * @returns Mock database.
 * @throws Never.
 */
function buildDb(): MockDatabase {
  return {
    players: [
      player(PLAYER_ID),
      player(FRIEND_1_ID),
      player(FRIEND_2_ID),
      player(ACTIVE_ID),
    ],
    friendships: [],
    neighbourhoods: [
      neighbourhood(NB_A, 20),
      neighbourhood(NB_B, 10),
    ],
    neighbourhood_members: [],
    nextNeighbourhoodNumber: 1,
    rpcCalls: [],
  };
}

class MockSupabaseClient {
  readonly database: MockDatabase;

  /**
   * Creates a mock Supabase client.
   * @param database - Backing in-memory database.
   * @returns Mock client.
   * @throws Never.
   */
  constructor(database: MockDatabase) {
    this.database = database;
  }

  /**
   * Starts a table query.
   * @param table - Table name.
   * @returns Query builder.
   * @throws Never.
   */
  from(table: string): MockQueryBuilder {
    return new MockQueryBuilder(this.database, table as TableName);
  }

  /**
   * Executes a mocked Postgres RPC.
   * @param functionName - RPC function name.
   * @param params - RPC parameters.
   * @returns RPC result.
   * @throws Never.
   */
  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<{ data: null; error: null }> {
    this.database.rpcCalls.push({ functionName, params: clone(params) });
    const neighbourhoodId = String(params.nb_id ?? "");
    const row = this.database.neighbourhoods.find((nb) =>
      nb.id === neighbourhoodId
    );
    if (functionName === "increment_member_count" && row) {
      row.member_count += 1;
    }
    if (functionName === "decrement_member_count" && row) {
      row.member_count = Math.max(row.member_count - 1, 0);
    }
    return Promise.resolve({ data: null, error: null });
  }
}

class MockQueryBuilder {
  private readonly database: MockDatabase;
  private readonly table: TableName;
  private selectedColumns = "*";
  private filters: Array<{ column: string; value: unknown }> = [];
  private inFilters: Array<{ column: string; values: string[] }> = [];
  private notNullColumns: string[] = [];
  private ltFilters: Array<{ column: string; value: number }> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private mutation:
    | { kind: "insert"; values: Record<string, unknown> }
    | { kind: "update"; values: Record<string, unknown> }
    | { kind: "delete" }
    | null = null;

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
   * Records selected columns.
   * @param columns - Selected column list.
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
   * Adds a supported not-null filter.
   * @param column - Column name.
   * @param operator - Filter operator.
   * @param value - Compared value.
   * @returns Current query builder.
   * @throws Never.
   */
  not(column: string, operator: string, value: unknown): MockQueryBuilder {
    if (operator === "is" && value === null) this.notNullColumns.push(column);
    return this;
  }

  /**
   * Adds a less-than filter.
   * @param column - Column name.
   * @param value - Exclusive upper bound.
   * @returns Current query builder.
   * @throws Never.
   */
  lt(column: string, value: number): MockQueryBuilder {
    this.ltFilters.push({ column, value });
    return this;
  }

  /**
   * Adds ordering.
   * @param column - Column name.
   * @param options - Ordering options.
   * @returns Current query builder.
   * @throws Never.
   */
  order(column: string, options: { ascending: boolean }): MockQueryBuilder {
    this.orderBy = { column, ascending: options.ascending };
    return this;
  }

  /**
   * Adds a result limit.
   * @param count - Maximum row count.
   * @returns Current query builder.
   * @throws Never.
   */
  limit(count: number): MockQueryBuilder {
    this.limitCount = count;
    return this;
  }

  /**
   * Records an insert mutation.
   * @param values - Insert values.
   * @returns Current query builder.
   * @throws Never.
   */
  insert(values: Record<string, unknown>): MockQueryBuilder {
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
   * Executes the query or mutation.
   * @returns Query result.
   * @throws Never.
   */
  private async execute(): Promise<MockExecuteResult> {
    await Promise.resolve();
    if (this.mutation?.kind === "insert") return this.executeInsert();
    if (this.mutation?.kind === "update") return this.executeUpdate();
    if (this.mutation?.kind === "delete") return this.executeDelete();

    let rows = this.matchingRows();
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = rows.toSorted((a, b) => {
        const left = Number(a[column]);
        const right = Number(b[column]);
        return ascending ? left - right : right - left;
      });
    }
    if (this.limitCount != null) rows = rows.slice(0, this.limitCount);

    return {
      data: rows.map((row) => this.projectRow(row)),
      error: null,
    };
  }

  /**
   * Executes an insert mutation.
   * @returns Mutation result.
   * @throws Never.
   */
  private executeInsert(): MockExecuteResult {
    if (this.mutation?.kind !== "insert") return { data: [], error: null };
    const inserted = this.insertRow(this.mutation.values);
    return { data: [this.projectRow(inserted)], error: null };
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
    return { data: rows.map((row) => this.projectRow(row)), error: null };
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
    return { data: [], error: null };
  }

  /**
   * Inserts one row into a supported table.
   * @param values - Insert values.
   * @returns Inserted row.
   * @throws Never.
   */
  private insertRow(values: Record<string, unknown>): Record<string, unknown> {
    if (this.table === "neighbourhoods") {
      const row: NeighbourhoodRow = {
        id: "new-neighbourhood-" + this.database.nextNeighbourhoodNumber++,
        member_count: 0,
        created_at: "2026-05-04T00:00:00.000Z",
      };
      this.database.neighbourhoods.push(row);
      return row as unknown as Record<string, unknown>;
    }

    if (this.table === "neighbourhood_members") {
      const row: NeighbourhoodMemberRow = {
        neighbourhood_id: String(values.neighbourhood_id),
        player_id: String(values.player_id),
        joined_at: "2026-05-04T00:00:00.000Z",
      };
      this.database.neighbourhood_members.push(row);
      return row as unknown as Record<string, unknown>;
    }

    return values;
  }

  /**
   * Returns matching rows.
   * @returns Matching rows.
   * @throws Never.
   */
  private matchingRows(): Array<Record<string, unknown>> {
    return this.tableRows().filter((row) => this.matches(row));
  }

  /**
   * Checks whether a row matches current filters.
   * @param row - Candidate row.
   * @returns True when the row matches.
   * @throws Never.
   */
  private matches(row: Record<string, unknown>): boolean {
    return this.filters.every((filter) =>
      row[filter.column] === filter.value
    ) &&
      this.inFilters.every((filter) =>
        filter.values.includes(String(row[filter.column]))
      ) &&
      this.notNullColumns.every((column) => row[column] !== null) &&
      this.ltFilters.every((filter) =>
        Number(row[filter.column]) < filter.value
      );
  }

  /**
   * Returns mutable rows for the current table.
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

interface MockExecuteResult {
  data: Record<string, unknown>[];
  error: null;
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

Deno.test("T7.2.1 New player with no friends assigned to available neighbourhood", async () => {
  const db = installMockSupabase();

  const result = await assignToNeighbourhood(PLAYER_ID);

  assertEquals(result, {
    success: true,
    neighbourhoodId: NB_A,
    memberCount: 21,
  }, "assignment result");
  assertEquals(
    db.players.find((row) => row.id === PLAYER_ID)?.neighbourhood_id,
    NB_A,
    "player neighbourhood",
  );
  assertEquals(db.neighbourhood_members, [
    {
      neighbourhood_id: NB_A,
      player_id: PLAYER_ID,
      joined_at: "2026-05-04T00:00:00.000Z",
    },
  ], "membership row");
});

Deno.test("T7.2.2 New player with friends joins friends' neighbourhood", async () => {
  const db = installMockSupabase();
  db.neighbourhoods.find((row) => row.id === NB_A)!.member_count = 50;
  db.players.find((row) => row.id === FRIEND_1_ID)!.neighbourhood_id = NB_A;
  db.players.find((row) => row.id === FRIEND_2_ID)!.neighbourhood_id = NB_A;
  db.friendships.push(
    { player_id: PLAYER_ID, friend_id: FRIEND_1_ID },
    { player_id: PLAYER_ID, friend_id: FRIEND_2_ID },
  );

  const result = await assignToNeighbourhood(PLAYER_ID);

  assertEquals(result.neighbourhoodId, NB_A, "chosen neighbourhood");
  assertEquals(result.memberCount, 51, "member count");
});

Deno.test("T7.2.3 Full friends' neighbourhood falls back elsewhere", async () => {
  const db = installMockSupabase();
  db.neighbourhoods.find((row) => row.id === NB_A)!.member_count = 80;
  db.players.find((row) => row.id === FRIEND_1_ID)!.neighbourhood_id = NB_A;
  db.friendships.push({ player_id: PLAYER_ID, friend_id: FRIEND_1_ID });

  const result = await assignToNeighbourhood(PLAYER_ID);

  assertEquals(result.neighbourhoodId, NB_B, "chosen neighbourhood");
  assertEquals(
    db.neighbourhoods.find((row) => row.id === NB_B)!.member_count,
    11,
    "NB_B count",
  );
});

Deno.test("T7.2.4 All full creates a new neighbourhood", async () => {
  const db = installMockSupabase();
  for (const row of db.neighbourhoods) row.member_count = 80;

  const result = await assignToNeighbourhood(PLAYER_ID);

  assertEquals(result, {
    success: true,
    neighbourhoodId: "new-neighbourhood-1",
    memberCount: 1,
  }, "assignment result");
  assertEquals(db.neighbourhoods.length, 3, "neighbourhood count");
});

Deno.test("T7.2.5 Already assigned player skips without changes", async () => {
  const db = installMockSupabase();
  db.players.find((row) => row.id === PLAYER_ID)!.neighbourhood_id = NB_B;

  const result = await assignToNeighbourhood(PLAYER_ID);

  assertEquals(result, { alreadyAssigned: true }, "assignment result");
  assertEquals(db.neighbourhood_members.length, 0, "membership count");
  assertEquals(db.rpcCalls.length, 0, "rpc count");
});

Deno.test("T7.2.6 Member count increments on assignment", async () => {
  const db = installMockSupabase();

  await assignToNeighbourhood(PLAYER_ID);

  assertEquals(
    db.neighbourhoods.find((row) => row.id === NB_A)!.member_count,
    21,
    "member count",
  );
  assertEquals(db.rpcCalls, [
    { functionName: "increment_member_count", params: { nb_id: NB_A } },
  ], "rpc calls");
});

Deno.test("T7.2.7 Inactive rotation removes player after eight days", async () => {
  const db = installMockSupabase();
  const inactiveTs = nowSeconds() - (8 * 24 * 3600);
  db.players.find((row) => row.id === PLAYER_ID)!.neighbourhood_id = NB_A;
  db.players.find((row) => row.id === PLAYER_ID)!.last_active_timestamp =
    inactiveTs;
  db.neighbourhood_members.push({
    neighbourhood_id: NB_A,
    player_id: PLAYER_ID,
    joined_at: "2026-05-04T00:00:00.000Z",
  });

  const result = await runMonthlyRotation();

  assertEquals(
    result,
    { neighbourhoodsProcessed: 0, playersRemoved: 1 },
    "rotation result",
  );
  assertEquals(db.neighbourhood_members.length, 0, "membership count");
  assertEquals(
    db.players.find((row) => row.id === PLAYER_ID)?.neighbourhood_id,
    null,
    "player neighbourhood",
  );
  assertEquals(
    db.neighbourhoods.find((row) => row.id === NB_A)!.member_count,
    19,
    "member count",
  );
});

Deno.test("T7.2.8 Active player is not removed", async () => {
  const db = installMockSupabase();
  const activeTs = nowSeconds() - (3 * 24 * 3600);
  db.players.find((row) => row.id === ACTIVE_ID)!.neighbourhood_id = NB_A;
  db.players.find((row) => row.id === ACTIVE_ID)!.last_active_timestamp =
    activeTs;
  db.neighbourhood_members.push({
    neighbourhood_id: NB_A,
    player_id: ACTIVE_ID,
    joined_at: "2026-05-04T00:00:00.000Z",
  });

  const result = await runMonthlyRotation();

  assertEquals(
    result,
    { neighbourhoodsProcessed: 0, playersRemoved: 0 },
    "rotation result",
  );
  assertEquals(db.neighbourhood_members.length, 1, "membership count");
  assertEquals(
    db.players.find((row) => row.id === ACTIVE_ID)?.neighbourhood_id,
    NB_A,
    "player neighbourhood",
  );
});
