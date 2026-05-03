import { getConfig, getConfigs } from "../lib/config.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";
import { initialiseNewPlayer } from "./index.ts";

type TableName = "players" | "game_config";

interface PlayerRow {
  id: string;
  device_id: string;
  coins: number;
  skills: Record<string, SkillTrack>;
  inventory_slots: Record<string, number>;
  farm_plots: unknown[];
  steal_protection_active: boolean;
}

interface SkillTrack {
  level: number;
  xp: number;
  available_points: number;
  active_bonuses: unknown[];
}

interface GameConfigRow {
  key: string;
  value: string;
  description?: string | null;
}

interface MockDatabase {
  players: PlayerRow[];
  game_config: GameConfigRow[];
}

const expectedInventorySlots = {
  crops: 20,
  fish: 10,
  animal_produce: 10,
  processed: 15,
  cooked_dishes: 10,
  tools: 10,
};

const expectedSkills = {
  farming: { level: 0, xp: 0, available_points: 0, active_bonuses: [] },
  fishing: { level: 0, xp: 0, available_points: 0, active_bonuses: [] },
  ranching: { level: 0, xp: 0, available_points: 0, active_bonuses: [] },
  cooking: { level: 0, xp: 0, available_points: 0, active_bonuses: [] },
  commerce: { level: 0, xp: 0, available_points: 0, active_bonuses: [] },
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
 * Asserts that two values are deeply equal by JSON representation.
 * @param actual - Actual value.
 * @param expected - Expected value.
 * @param message - Failure message.
 * @returns Nothing.
 * @throws Error when the values differ.
 */
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

/**
 * Asserts that an async function rejects with an exact error message.
 * @param action - Async action expected to throw.
 * @param expectedMessage - Exact expected error message.
 * @returns Nothing.
 * @throws Error when no error is thrown or the message differs.
 */
async function assertRejectsWithMessage(action: () => Promise<unknown>, expectedMessage: string): Promise<void> {
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
 * Builds the minimum seeded game_config rows needed by Task 1.1 tests.
 * @returns Seeded game_config rows.
 * @throws Never.
 */
function buildGameConfigRows(): GameConfigRow[] {
  return [
    { key: "STARTER_COINS", value: "500" },
    { key: "STEAL_WINDOW_SECONDS", value: "60" },
    { key: "OFFLINE_CAP_SECONDS", value: "57600" },
    {
      key: "crop_wheat",
      value: '{"growTimeSeconds":14400,"seedCostCoins":15,"isPerpetual":false,"unlockLevel":1,"baseYieldMin":6,"baseYieldMax":10}',
    },
    {
      key: "crop_tomato",
      value: '{"growTimeSeconds":7200,"seedCostCoins":10,"isPerpetual":false,"unlockLevel":1,"baseYieldMin":5,"baseYieldMax":8}',
    },
  ];
}

/**
 * Builds a new mock database for one test.
 * @returns Mock database with seeded config and no players.
 * @throws Never.
 */
function buildMockDatabase(): MockDatabase {
  return {
    players: [],
    game_config: buildGameConfigRows(),
  };
}

/**
 * Builds a player row with migration defaults applied.
 * @param input - Inserted player values.
 * @param sequence - One-based row sequence for deterministic IDs.
 * @returns Player row with defaults.
 * @throws Never.
 */
function buildPlayerRow(input: Record<string, unknown>, sequence: number): PlayerRow {
  return {
    id: `player-${String(sequence).padStart(3, "0")}`,
    device_id: String(input.device_id),
    coins: Number(input.coins ?? 500),
    skills: clone(expectedSkills),
    inventory_slots: clone(expectedInventorySlots),
    farm_plots: clone((input.farm_plots as unknown[]) ?? []),
    steal_protection_active: true,
  };
}

class MockSupabaseClient {
  database: MockDatabase;

  /**
   * Creates a mock Supabase client over an in-memory database.
   * @param database - In-memory database tables.
   * @returns Mock Supabase client instance.
   * @throws Never.
   */
  constructor(database: MockDatabase) {
    this.database = database;
  }

  /**
   * Starts a query against a mock table.
   * @param table - Table name.
   * @returns Query builder for the table.
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
  private insertedValue: Record<string, unknown> | null = null;

  /**
   * Creates a mock query builder.
   * @param database - In-memory database tables.
   * @param table - Table name.
   * @returns Mock query builder instance.
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
   * Inserts a row into the selected table.
   * @param value - Inserted row fields.
   * @returns Current query builder.
   * @throws Never.
   */
  insert(value: Record<string, unknown>): MockQueryBuilder {
    this.insertedValue = value;
    return this;
  }

  /**
   * Resolves a maybeSingle query.
   * @returns Query result with zero or one row.
   * @throws Never.
   */
  async maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }> {
    const rows = this.matchingRows();
    return { data: rows.length > 0 ? this.projectRow(rows[0]) : null, error: null };
  }

  /**
   * Resolves a single insert query.
   * @returns Query result with the inserted row.
   * @throws Never.
   */
  async single(): Promise<{ data: Record<string, unknown> | null; error: null }> {
    if (this.table !== "players" || !this.insertedValue) return { data: null, error: null };
    const row = buildPlayerRow(this.insertedValue, this.database.players.length + 1);
    this.database.players.push(row);
    return { data: this.projectRow(row as unknown as Record<string, unknown>), error: null };
  }

  /**
   * Resolves an IN query.
   * @param column - Column name.
   * @param values - Allowed values.
   * @returns Query result with all matching rows.
   * @throws Never.
   */
  async in(column: string, values: string[]): Promise<{ data: Record<string, unknown>[]; error: null }> {
    const rows = this.tableRows().filter((row) => values.includes(String(row[column])));
    return { data: rows.map((row) => this.projectRow(row)), error: null };
  }

  /**
   * Returns rows matching equality filters.
   * @returns Matching rows.
   * @throws Never.
   */
  private matchingRows(): Array<Record<string, unknown>> {
    return this.tableRows().filter((row) =>
      this.filters.every((filter) => String(row[filter.column]) === filter.value)
    );
  }

  /**
   * Returns rows for the selected table.
   * @returns Table rows.
   * @throws Never.
   */
  private tableRows(): Array<Record<string, unknown>> {
    return this.database[this.table] as unknown as Array<Record<string, unknown>>;
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
 * Installs a fresh mock Supabase client and returns the backing database.
 * @returns Mock database backing the injected Supabase client.
 * @throws Never.
 */
function installMockSupabase(): MockDatabase {
  const database = buildMockDatabase();
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

/**
 * Tests new player initialisation.
 * @returns Nothing.
 * @throws Error when expectations fail.
 */
async function testNewPlayerInitialisation(): Promise<void> {
  const database = installMockSupabase();
  const result = await initialiseNewPlayer("test-player-001");
  assertEquals(result.success, true, "success");
  assertEquals(result.wasAlreadyInitialised, false, "wasAlreadyInitialised");
  assertEquals(database.players.length, 1, "players row count");
  assertEquals(database.players[0].device_id, "test-player-001", "device_id");
}

Deno.test("T1.1.1 New player init", testNewPlayerInitialisation);

/**
 * Tests idempotent player initialisation for a repeated device ID.
 * @returns Nothing.
 * @throws Error when expectations fail.
 */
async function testIdempotency(): Promise<void> {
  const database = installMockSupabase();
  const first = await initialiseNewPlayer("test-player-001");
  const second = await initialiseNewPlayer("test-player-001");
  assertEquals(first.wasAlreadyInitialised, false, "first init flag");
  assertEquals(second.wasAlreadyInitialised, true, "second init flag");
  assertEquals(second.playerId, first.playerId, "same player ID");
  assertEquals(database.players.length, 1, "players row count");
  assertEquals(database.players[0].coins, 500, "coins unchanged");
}

Deno.test("T1.1.2 Idempotency", testIdempotency);

/**
 * Tests initial coin balance.
 * @returns Nothing.
 * @throws Error when expectations fail.
 */
async function testCoinBalanceAtInit(): Promise<void> {
  const database = installMockSupabase();
  await initialiseNewPlayer("test-player-001");
  assertEquals(database.players[0].coins, 500, "coins");
}

Deno.test("T1.1.3 Coin balance at init", testCoinBalanceAtInit);

/**
 * Tests initial inventory slots.
 * @returns Nothing.
 * @throws Error when expectations fail.
 */
async function testInventorySlotsAtInit(): Promise<void> {
  const database = installMockSupabase();
  await initialiseNewPlayer("test-player-001");
  assertEquals(database.players[0].inventory_slots, expectedInventorySlots, "inventory_slots");
}

Deno.test("T1.1.4 Inventory slots at init", testInventorySlotsAtInit);

/**
 * Tests initial farm plot state.
 * @returns Nothing.
 * @throws Error when expectations fail.
 */
async function testFarmPlotsAtInit(): Promise<void> {
  const database = installMockSupabase();
  await initialiseNewPlayer("test-player-001");
  const farmPlots = database.players[0].farm_plots as Array<Record<string, unknown>>;
  assertEquals(farmPlots.length, 6, "plot count");
  for (const plot of farmPlots) {
    assertEquals(plot.cropId, null, "plot cropId");
    assertEquals(plot.state, "EMPTY", "plot state");
  }
}

Deno.test("T1.1.5 Farm plots at init", testFarmPlotsAtInit);

/**
 * Tests initial steal protection.
 * @returns Nothing.
 * @throws Error when expectations fail.
 */
async function testStealProtectionAtInit(): Promise<void> {
  const database = installMockSupabase();
  await initialiseNewPlayer("test-player-001");
  assertEquals(database.players[0].steal_protection_active, true, "steal_protection_active");
}

Deno.test("T1.1.6 Steal protection at init", testStealProtectionAtInit);

/**
 * Tests STEAL_WINDOW_SECONDS config parsing.
 * @returns Nothing.
 * @throws Error when expectations fail.
 */
async function testConfigStealWindow(): Promise<void> {
  installMockSupabase();
  const value = await getConfig("STEAL_WINDOW_SECONDS");
  assertEquals(value, 60, "STEAL_WINDOW_SECONDS");
  assertEquals(typeof value, "number", "STEAL_WINDOW_SECONDS type");
}

Deno.test("T1.1.7 Config - steal window", testConfigStealWindow);

/**
 * Tests wheat crop config parsing.
 * @returns Nothing.
 * @throws Error when expectations fail.
 */
async function testConfigWheatGrowTime(): Promise<void> {
  installMockSupabase();
  const value = await getConfig("crop_wheat") as Record<string, unknown>;
  assertEquals(value.growTimeSeconds, 14400, "crop_wheat growTimeSeconds");
}

Deno.test("T1.1.8 Config - wheat grow time", testConfigWheatGrowTime);

/**
 * Tests tomato crop config parsing.
 * @returns Nothing.
 * @throws Error when expectations fail.
 */
async function testConfigCropTomato(): Promise<void> {
  installMockSupabase();
  const value = await getConfig("crop_tomato") as Record<string, unknown>;
  assertEquals(value.growTimeSeconds, 7200, "crop_tomato growTimeSeconds");
}

Deno.test("T1.1.9 Config - crop tomato", testConfigCropTomato);

/**
 * Tests fetching multiple config keys in one query.
 * @returns Nothing.
 * @throws Error when expectations fail.
 */
async function testMultipleConfigKeys(): Promise<void> {
  installMockSupabase();
  const values = await getConfigs(["STEAL_WINDOW_SECONDS", "OFFLINE_CAP_SECONDS"]);
  assertEquals(values.STEAL_WINDOW_SECONDS, 60, "STEAL_WINDOW_SECONDS");
  assertEquals(values.OFFLINE_CAP_SECONDS, 57600, "OFFLINE_CAP_SECONDS");
}

Deno.test("T1.1.10 Multiple config keys", testMultipleConfigKeys);

/**
 * Tests missing config key error message.
 * @returns Nothing.
 * @throws Error when expectations fail.
 */
async function testConfigKeyNotFound(): Promise<void> {
  installMockSupabase();
  await assertRejectsWithMessage(
    () => getConfig("NONEXISTENT_KEY"),
    "CONFIG_KEY_NOT_FOUND:NONEXISTENT_KEY",
  );
}

Deno.test("T1.1.11 Config key not found", testConfigKeyNotFound);

/**
 * Tests initial skills JSON.
 * @returns Nothing.
 * @throws Error when expectations fail.
 */
async function testSkillsInit(): Promise<void> {
  const database = installMockSupabase();
  await initialiseNewPlayer("test-player-001");
  assertEquals(database.players[0].skills, expectedSkills, "skills");
  for (const skill of Object.values(database.players[0].skills)) {
    assertEquals(skill.level, 0, "skill level");
    assertEquals(skill.xp, 0, "skill xp");
    assertEquals(skill.available_points, 0, "skill available_points");
    assert(Array.isArray(skill.active_bonuses), "skill active_bonuses array");
    assertEquals(skill.active_bonuses.length, 0, "skill active_bonuses empty");
  }
}

Deno.test("T1.1.12 Skills init", testSkillsInit);
