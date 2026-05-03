import {
  calculateNeighbourScoreTier,
  getPlayerProfile,
} from "../get-player-profile/index.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";
import { loginOrCreate } from "./index.ts";

type TableName = "players" | "game_config";

interface PlayerRow {
  id: string;
  device_id: string;
  auth_user_id: string | null;
  display_name: string | null;
  coins: number;
  level: number;
  michelin_stars: number;
  neighbour_score: number;
  equipped_pet: string | null;
  restaurant: { tier: number };
  thief_stats: {
    totalAttemptsLifetime: number;
    totalSuccessesLifetime: number;
    nemesisPlayerId: string | null;
    nemesisDisplayName: string | null;
    timesStorenFrom: number;
  };
  inventory_slots: Record<string, number>;
  farm_plots: unknown[];
  created_at: string;
  updated_at: string;
}

interface GameConfigRow {
  key: string;
  value: string;
}

interface AuthUserRow {
  id: string;
  email: string;
  password: string;
}

interface MockDatabase {
  players: PlayerRow[];
  game_config: GameConfigRow[];
  authUsers: AuthUserRow[];
  selectedColumns: string[];
}

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
 * @throws Error when values are different.
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
 * Asserts object does not include a property.
 * @param object - Object to inspect.
 * @param key - Forbidden property name.
 * @returns Nothing.
 * @throws Error when the property exists.
 */
function assertNotHasProperty(
  object: Record<string, unknown>,
  key: string,
): void {
  assert(!(key in object), `forbidden property present: ${key}`);
}

/**
 * Asserts an async action rejects with an exact error message.
 * @param action - Async action expected to reject.
 * @param expectedMessage - Expected exact error message.
 * @returns Nothing.
 * @throws Error when the action does not reject with the expected message.
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
 * Deep clones a JSON-compatible value.
 * @param value - Value to clone.
 * @returns Cloned value.
 * @throws Never.
 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Builds a new in-memory database for Task 1.2 tests.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(): MockDatabase {
  return {
    players: [],
    game_config: [{ key: "STARTER_COINS", value: "500" }],
    authUsers: [],
    selectedColumns: [],
  };
}

/**
 * Builds a player row with database defaults applied.
 * @param input - Insert payload.
 * @param sequence - Deterministic row sequence.
 * @returns Player row.
 * @throws Never.
 */
function buildPlayerRow(
  input: Record<string, unknown>,
  sequence: number,
): PlayerRow {
  return {
    id: `player-${String(sequence).padStart(3, "0")}`,
    device_id: String(input.device_id),
    auth_user_id: null,
    display_name: null,
    coins: Number(input.coins ?? 500),
    level: 1,
    michelin_stars: 0,
    neighbour_score: 50,
    equipped_pet: null,
    restaurant: { tier: 1 },
    thief_stats: {
      totalAttemptsLifetime: 0,
      totalSuccessesLifetime: 0,
      nemesisPlayerId: null,
      nemesisDisplayName: null,
      timesStorenFrom: 0,
    },
    inventory_slots: { crops: 20 },
    farm_plots: clone((input.farm_plots as unknown[]) ?? []),
    created_at: "2026-05-03T00:00:00Z",
    updated_at: "2026-05-03T00:00:00Z",
  };
}

class MockSupabaseClient {
  readonly database: MockDatabase;
  readonly auth: MockAuthClient;

  /**
   * Creates a mock Supabase client.
   * @param database - In-memory database.
   * @returns Mock Supabase client.
   * @throws Never.
   */
  constructor(database: MockDatabase) {
    this.database = database;
    this.auth = new MockAuthClient(database);
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

class MockAuthClient {
  readonly admin: MockAuthAdmin;
  private readonly database: MockDatabase;

  /**
   * Creates a mock auth client.
   * @param database - In-memory database.
   * @returns Mock auth client.
   * @throws Never.
   */
  constructor(database: MockDatabase) {
    this.database = database;
    this.admin = new MockAuthAdmin(database);
  }

  /**
   * Creates a deterministic session for email/password credentials.
   * @param input - Email and password credentials.
   * @returns Mock session result.
   * @throws Never.
   */
  signInWithPassword(
    input: { email: string; password: string },
  ): Promise<{
    data: { session: { access_token: string } | null };
    error: { message: string } | null;
  }> {
    const user = this.database.authUsers.find((row) =>
      row.email === input.email && row.password === input.password
    );
    return Promise.resolve({
      data: { session: user ? { access_token: `token-${user.id}` } : null },
      error: user ? null : { message: "auth user not found" },
    });
  }
}

class MockAuthAdmin {
  private readonly database: MockDatabase;

  /**
   * Creates a mock auth admin client.
   * @param database - In-memory database.
   * @returns Mock auth admin client.
   * @throws Never.
   */
  constructor(database: MockDatabase) {
    this.database = database;
  }

  /**
   * Creates a deterministic auth user.
   * @param input - Auth user creation payload.
   * @returns Mock auth user result.
   * @throws Never.
   */
  createUser(
    input: { email: string; password: string; email_confirm: boolean },
  ): Promise<{
    data: { user: { id: string } };
    error: null;
  }> {
    const existing = this.database.authUsers.find((row) =>
      row.email === input.email
    );
    if (existing) {
      return Promise.resolve({
        data: { user: { id: existing.id } },
        error: null,
      });
    }

    const user = {
      id: `auth-${String(this.database.authUsers.length + 1).padStart(3, "0")}`,
      email: input.email,
      password: input.password,
    };
    this.database.authUsers.push(user);
    return Promise.resolve({ data: { user: { id: user.id } }, error: null });
  }
}

class MockQueryBuilder {
  private readonly database: MockDatabase;
  private readonly table: TableName;
  private selectedColumns = "*";
  private filters: Array<{ column: string; value: string }> = [];
  private insertedValue: Record<string, unknown> | null = null;
  private updatedValue: Record<string, unknown> | null = null;

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
   * @returns Current query builder.
   * @throws Never.
   */
  select(columns: string): MockQueryBuilder {
    this.selectedColumns = columns;
    this.database.selectedColumns.push(columns);
    return this;
  }

  /**
   * Adds an equality filter.
   * @param column - Column name.
   * @param value - Expected value.
   * @returns Current query builder or mutation result promise.
   * @throws Never.
   */
  eq(
    column: string,
    value: string,
  ): MockQueryBuilder | Promise<{ data: null; error: null }> {
    this.filters.push({ column, value });
    if (!this.updatedValue) return this;
    for (const row of this.matchingRows()) {
      Object.assign(row, this.updatedValue);
    }
    return Promise.resolve({ data: null, error: null });
  }

  /**
   * Stores an insert payload.
   * @param value - Inserted row values.
   * @returns Current query builder.
   * @throws Never.
   */
  insert(value: Record<string, unknown>): MockQueryBuilder {
    this.insertedValue = value;
    return this;
  }

  /**
   * Stores an update payload.
   * @param value - Updated row values.
   * @returns Current query builder.
   * @throws Never.
   */
  update(value: Record<string, unknown>): MockQueryBuilder {
    this.updatedValue = value;
    return this;
  }

  /**
   * Resolves a maybeSingle query.
   * @returns Zero-or-one projected row.
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
   * Resolves a single query or insert.
   * @returns Single projected row.
   * @throws Never.
   */
  single(): Promise<
    { data: Record<string, unknown> | null; error: null }
  > {
    if (this.insertedValue) {
      const row = buildPlayerRow(
        this.insertedValue,
        this.database.players.length + 1,
      );
      this.database.players.push(row);
      return Promise.resolve({
        data: this.projectRow(row as unknown as Record<string, unknown>),
        error: null,
      });
    }
    const rows = this.matchingRows();
    return Promise.resolve({
      data: rows[0] ? this.projectRow(rows[0]) : null,
      error: null,
    });
  }

  /**
   * Resolves an IN query.
   * @param column - Column name.
   * @param values - Allowed values.
   * @returns Projected matching rows.
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
   * Returns rows matching equality filters.
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
   * Returns rows for the active table.
   * @returns Table rows.
   * @throws Never.
   */
  private tableRows(): Array<Record<string, unknown>> {
    return this.database[this.table] as unknown as Array<
      Record<string, unknown>
    >;
  }

  /**
   * Projects a row using the selected columns.
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
 * Installs a fresh mock Supabase client.
 * @returns Mock database backing the client.
 * @throws Never.
 */
function installMockSupabase(): MockDatabase {
  const database = buildMockDatabase();
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

Deno.test("T1.2.1 New device creates account", async () => {
  installMockSupabase();
  const result = await loginOrCreate("device-abc-123", "ios");
  assertEquals(result.isNewPlayer, true, "isNewPlayer");
  assert(
    typeof result.playerId === "string" && result.playerId.length > 0,
    "playerId non-null",
  );
  assertEquals(result.level, 1, "level");
  assertEquals(result.coins, 500, "coins");
});

Deno.test("T1.2.2 Same device returns same account", async () => {
  installMockSupabase();
  const first = await loginOrCreate("device-abc-123", "ios");
  const second = await loginOrCreate("device-abc-123", "ios");
  assertEquals(second.isNewPlayer, false, "isNewPlayer");
  assertEquals(second.playerId, first.playerId, "same playerId");
});

Deno.test("T1.2.3 Different device creates different account", async () => {
  installMockSupabase();
  const first = await loginOrCreate("device-abc-123", "ios");
  const second = await loginOrCreate("device-xyz-456", "ios");
  assertEquals(second.isNewPlayer, true, "isNewPlayer");
  assert(second.playerId !== first.playerId, "different playerId");
});

Deno.test("T1.2.4 Public profile has no coin field", async () => {
  const database = installMockSupabase();
  const login = await loginOrCreate("device-abc-123", "ios");
  const profile = await getPlayerProfile(login.playerId);
  const profileRecord = profile as unknown as Record<string, unknown>;
  assertNotHasProperty(profileRecord, "coins");
  assertNotHasProperty(profileRecord, "inventory");
  assertNotHasProperty(profileRecord, "inventory_slots");
  assertNotHasProperty(profileRecord, "created_at");
  assertNotHasProperty(profileRecord, "updated_at");
  const profileSelect = database.selectedColumns.find((columns) =>
    columns.includes("neighbour_score")
  );
  assert(Boolean(profileSelect), "profile select recorded");
  assert(!String(profileSelect).includes("coins"), "coins not selected");
  assert(
    !String(profileSelect).includes("inventory"),
    "inventory not selected",
  );
  assert(
    !String(profileSelect).includes("created_at"),
    "created_at not selected",
  );
  assert(
    !String(profileSelect).includes("updated_at"),
    "updated_at not selected",
  );
});

Deno.test("T1.2.5 Thief stats start at zero", async () => {
  installMockSupabase();
  const login = await loginOrCreate("device-abc-123", "ios");
  const profile = await getPlayerProfile(login.playerId);
  assertEquals(profile.thiefStats.successRatePercent, 0, "successRatePercent");
  assertEquals(
    profile.thiefStats.nemesisDisplayName,
    null,
    "nemesisDisplayName",
  );
});

Deno.test("T1.2.6 Score tier: 80 boundary", () => {
  assertEquals(calculateNeighbourScoreTier(80), "PILLAR", "tier");
});

Deno.test("T1.2.7 Score tier: 79 boundary", () => {
  assertEquals(calculateNeighbourScoreTier(79), "REGULAR", "tier");
});

Deno.test("T1.2.8 Score tier: 40 boundary", () => {
  assertEquals(calculateNeighbourScoreTier(40), "REGULAR", "tier");
});

Deno.test("T1.2.9 Score tier: 39 boundary", () => {
  assertEquals(calculateNeighbourScoreTier(39), "FOX", "tier");
});

Deno.test("T1.2.10 Score tier: 15 boundary", () => {
  assertEquals(calculateNeighbourScoreTier(15), "FOX", "tier");
});

Deno.test("T1.2.11 Score tier: 14 boundary", () => {
  assertEquals(calculateNeighbourScoreTier(14), "OUTLAW", "tier");
});

Deno.test("T1.2.12 Empty deviceId rejected", async () => {
  installMockSupabase();
  await assertRejectsWithMessage(
    () => loginOrCreate("", "ios"),
    "INVALID_DEVICE_ID",
  );
});

Deno.test("T1.2.13 Invalid platform rejected", async () => {
  installMockSupabase();
  await assertRejectsWithMessage(
    () => loginOrCreate("device-abc-123", "android"),
    "INVALID_PLATFORM",
  );
});
