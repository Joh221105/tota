import { expandInventory } from "./index.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";

type TableName = "players" | "inventory";

type InventoryCategory =
  | "crops"
  | "fish"
  | "animal_produce"
  | "processed"
  | "cooked_dishes"
  | "tools";

interface PlayerRow {
  id: string;
  inventory_slots: Record<InventoryCategory, number>;
}

interface InventoryRow {
  id: string;
  player_id: string;
  item_id: string;
  grade: string;
  quantity: number;
  category: InventoryCategory;
}

interface MockDatabase {
  players: PlayerRow[];
  inventory: InventoryRow[];
  nextInventoryId: number;
}

interface MockQueryResult {
  data: Record<string, unknown> | Array<Record<string, unknown>> | null;
  error: { message: string } | null;
  count: number | null;
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
 * Builds a new in-memory expansion database.
 * @param slots - Optional slot overrides for the default player.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(
  slots: Partial<Record<InventoryCategory, number>> = {},
): MockDatabase {
  return {
    players: [{
      id: "player-001",
      inventory_slots: {
        crops: 20,
        fish: 10,
        animal_produce: 10,
        processed: 15,
        cooked_dishes: 10,
        tools: 10,
        ...slots,
      },
    }],
    inventory: [],
    nextInventoryId: 1,
  };
}

/**
 * Creates an inventory row for test setup.
 * @param database - Mock database to mutate.
 * @param values - Row values except generated ID and player ID defaults.
 * @returns Created row.
 * @throws Never.
 */
function addInventoryRow(
  database: MockDatabase,
  values: Omit<InventoryRow, "id" | "player_id"> & { player_id?: string },
): InventoryRow {
  const row = {
    id: `inv-${String(database.nextInventoryId++).padStart(3, "0")}`,
    player_id: values.player_id ?? "player-001",
    item_id: values.item_id,
    grade: values.grade,
    quantity: values.quantity,
    category: values.category,
  };
  database.inventory.push(row);
  return row;
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

class MockQueryBuilder implements PromiseLike<MockQueryResult> {
  private readonly database: MockDatabase;
  private readonly table: TableName;
  private selectedColumns = "*";
  private filters: Array<{ column: string; value: string }> = [];
  private mutation:
    | { type: "update"; values: Record<string, unknown> }
    | { type: "delete" }
    | null = null;

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
   * Records an update mutation.
   * @param values - Values to update.
   * @returns Current query builder.
   * @throws Never.
   */
  update(values: Record<string, unknown>): MockQueryBuilder {
    this.mutation = { type: "update", values };
    return this;
  }

  /**
   * Records a delete mutation.
   * @returns Current query builder.
   * @throws Never.
   */
  delete(): MockQueryBuilder {
    this.mutation = { type: "delete" };
    return this;
  }

  /**
   * Resolves a maybeSingle query.
   * @returns Query result with zero or one row.
   * @throws Never.
   */
  maybeSingle(): Promise<MockQueryResult> {
    const rows = this.matchingRows();
    return Promise.resolve({
      data: rows.length > 0 ? this.projectRow(rows[0]) : null,
      error: null,
      count: null,
    });
  }

  /**
   * Resolves a single query.
   * @returns Query result with one row.
   * @throws Never.
   */
  single(): Promise<MockQueryResult> {
    const result = this.execute();
    const row = Array.isArray(result.data)
      ? result.data[0] ?? null
      : result.data;
    return Promise.resolve({
      data: row,
      error: result.error,
      count: result.count,
    });
  }

  /**
   * Makes the query builder awaitable.
   * @param onfulfilled - Fulfilled callback.
   * @param onrejected - Rejected callback.
   * @returns Promise-like query result.
   * @throws Never.
   */
  then<TResult1 = MockQueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: MockQueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  /**
   * Executes the currently configured query or mutation.
   * @returns Mock query result.
   * @throws Never.
   */
  private execute(): MockQueryResult {
    if (this.mutation?.type === "update") return this.executeUpdate();
    if (this.mutation?.type === "delete") return this.executeDelete();

    const rows = this.matchingRows();
    return {
      data: rows.map((row) => this.projectRow(row)),
      error: null,
      count: null,
    };
  }

  /**
   * Executes an update mutation.
   * @returns Mock query result.
   * @throws Never.
   */
  private executeUpdate(): MockQueryResult {
    const values =
      (this.mutation as { type: "update"; values: Record<string, unknown> })
        .values;
    const rows = this.matchingRows() as Array<Record<string, unknown>>;
    for (const row of rows) {
      Object.assign(row, clone(values));
    }
    return {
      data: rows.map((row) => this.projectRow(row)),
      error: null,
      count: null,
    };
  }

  /**
   * Executes a delete mutation.
   * @returns Mock query result.
   * @throws Never.
   */
  private executeDelete(): MockQueryResult {
    const rows = this.matchingRows();
    const ids = new Set(rows.map((row) => String(row.id)));
    this.database.inventory = this.database.inventory.filter((row) =>
      !ids.has(row.id)
    );
    return { data: null, error: null, count: null };
  }

  /**
   * Returns rows matching all equality filters.
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
 * @param slots - Optional slot overrides for the default player.
 * @returns Mock database backing the client.
 * @throws Never.
 */
function installMockSupabase(
  slots: Partial<Record<InventoryCategory, number>> = {},
): MockDatabase {
  const database = buildMockDatabase(slots);
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

Deno.test("T1.7.1 normal expansion", async () => {
  const database = installMockSupabase({ crops: 20 });
  addInventoryRow(database, {
    item_id: "expand_wooden_plank",
    grade: "Normal",
    quantity: 1,
    category: "tools",
  });

  const result = await expandInventory("player-001", "expand_wooden_plank");

  assertEquals(result, {
    success: true,
    category: "crops",
    slotsBefore: 20,
    slotsAfter: 25,
  }, "expand result");
  assertEquals(
    database.players[0].inventory_slots.crops,
    25,
    "crops slot count",
  );
  assertEquals(database.inventory.length, 0, "plank consumed");
});

Deno.test("T1.7.2 material not in inventory", async () => {
  const database = installMockSupabase();
  // SPEC_AMBIGUITY: T1.7.2 says 0 Wooden Planks should throw INSUFFICIENT_QUANTITY, but removeItemFromInventory throws ITEM_NOT_FOUND when no stack exists.
  addInventoryRow(database, {
    item_id: "expand_wooden_plank",
    grade: "Normal",
    quantity: 0,
    category: "tools",
  });

  await assertRejectsWithMessage(
    () => expandInventory("player-001", "expand_wooden_plank"),
    "INSUFFICIENT_QUANTITY:0:1",
  );
  assertEquals(
    database.players[0].inventory_slots.crops,
    20,
    "slots unchanged",
  );
});

Deno.test("T1.7.3 already at max capacity", async () => {
  const database = installMockSupabase({ crops: 200 });
  addInventoryRow(database, {
    item_id: "expand_wooden_plank",
    grade: "Normal",
    quantity: 1,
    category: "tools",
  });

  await assertRejectsWithMessage(
    () => expandInventory("player-001", "expand_wooden_plank"),
    "AT_MAX_CAPACITY:crops:200",
  );
  assertEquals(database.inventory[0].quantity, 1, "plank not consumed");
});

Deno.test("T1.7.4 steel beam needs target", async () => {
  installMockSupabase();

  await assertRejectsWithMessage(
    () => expandInventory("player-001", "expand_steel_beam"),
    "STEEL_BEAM_REQUIRES_CATEGORY",
  );
});

Deno.test("T1.7.5 steel beam valid target", async () => {
  const database = installMockSupabase({ fish: 10 });
  addInventoryRow(database, {
    item_id: "expand_steel_beam",
    grade: "Normal",
    quantity: 1,
    category: "tools",
  });

  const result = await expandInventory(
    "player-001",
    "expand_steel_beam",
    "fish",
  );

  assertEquals(result, {
    success: true,
    category: "fish",
    slotsBefore: 10,
    slotsAfter: 20,
  }, "expand result");
  assertEquals(database.players[0].inventory_slots.fish, 20, "fish slot count");
  assertEquals(database.inventory.length, 0, "steel beam consumed");
});

Deno.test("T1.7.6 three consecutive expansions", async () => {
  const database = installMockSupabase({ crops: 20 });
  addInventoryRow(database, {
    item_id: "expand_wooden_plank",
    grade: "Normal",
    quantity: 3,
    category: "tools",
  });

  const first = await expandInventory("player-001", "expand_wooden_plank");
  const second = await expandInventory("player-001", "expand_wooden_plank");
  const third = await expandInventory("player-001", "expand_wooden_plank");

  assertEquals(first.slotsAfter, 25, "first expansion");
  assertEquals(second.slotsAfter, 30, "second expansion");
  assertEquals(third.slotsAfter, 35, "third expansion");
  assertEquals(
    database.players[0].inventory_slots.crops,
    35,
    "crops slot count",
  );
  assertEquals(database.inventory.length, 0, "planks consumed");
});

Deno.test("T1.7.7 iron nail expands processed", async () => {
  const database = installMockSupabase({ processed: 15 });
  addInventoryRow(database, {
    item_id: "expand_iron_nail",
    grade: "Normal",
    quantity: 1,
    category: "tools",
  });

  const result = await expandInventory("player-001", "expand_iron_nail");

  assertEquals(result, {
    success: true,
    category: "processed",
    slotsBefore: 15,
    slotsAfter: 20,
  }, "expand result");
  assertEquals(
    database.players[0].inventory_slots.processed,
    20,
    "processed slot count",
  );
  assertEquals(database.inventory.length, 0, "iron nail consumed");
});

Deno.test("T1.7.8 invalid material", async () => {
  installMockSupabase();

  await assertRejectsWithMessage(
    () => expandInventory("player-001", "fish_catfish"),
    "INVALID_EXPANSION_MATERIAL",
  );
});
