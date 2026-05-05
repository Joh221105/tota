import {
  addItemToInventory,
  getCategory,
  removeItemFromInventory,
} from "./inventory.ts";
import { setSupabaseAdminForTesting } from "./supabase.ts";

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
 * Builds a new in-memory inventory database.
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
  private head = false;
  private wantsCount = false;
  private filters: Array<{ column: string; value: string }> = [];
  private mutation:
    | { type: "update"; values: Record<string, unknown> }
    | { type: "insert"; values: Record<string, unknown> }
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
   * Records selected columns and select options.
   * @param columns - Column list.
   * @param options - Optional count and head options.
   * @returns Current query builder.
   * @throws Never.
   */
  select(
    columns: string,
    options: { count?: "exact"; head?: boolean } = {},
  ): MockQueryBuilder {
    this.selectedColumns = columns;
    this.head = options.head === true;
    this.wantsCount = options.count === "exact";
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
   * Records an insert mutation.
   * @param values - Values to insert.
   * @returns Current query builder.
   * @throws Never.
   */
  insert(values: Record<string, unknown>): MockQueryBuilder {
    this.mutation = { type: "insert", values };
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
   * Resolves a single query or mutation.
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
    if (this.mutation?.type === "insert") return this.executeInsert();
    if (this.mutation?.type === "update") return this.executeUpdate();
    if (this.mutation?.type === "delete") return this.executeDelete();

    const rows = this.matchingRows();
    return {
      data: this.head ? null : rows.map((row) => this.projectRow(row)),
      error: null,
      count: this.wantsCount ? rows.length : null,
    };
  }

  /**
   * Executes an insert mutation.
   * @returns Mock query result.
   * @throws Never.
   */
  private executeInsert(): MockQueryResult {
    const values =
      (this.mutation as { type: "insert"; values: Record<string, unknown> })
        .values;
    const row = {
      id: `inv-${String(this.database.nextInventoryId++).padStart(3, "0")}`,
      player_id: String(values.player_id),
      item_id: String(values.item_id),
      grade: String(values.grade),
      quantity: Number(values.quantity),
      category: values.category as InventoryCategory,
    };
    this.database.inventory.push(row);
    return { data: [this.projectRow(row)], error: null, count: null };
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
      Object.assign(row, values);
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

interface MockQueryResult {
  data: Record<string, unknown> | Array<Record<string, unknown>> | null;
  error: { message: string } | null;
  count: number | null;
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

Deno.test("T1.6.1 add to new slot", async () => {
  const database = installMockSupabase();

  const result = await addItemToInventory(
    "player-001",
    "crop_tomato",
    "Gold",
    5,
  );

  assertEquals(result, {
    success: true,
    itemId: "crop_tomato",
    grade: "Gold",
    quantityAdded: 5,
    newStackQuantity: 5,
    category: "crops",
  }, "add result");
  assertEquals(database.inventory.length, 1, "inventory row count");
  assertEquals(database.inventory[0].item_id, "crop_tomato", "item id");
  assertEquals(database.inventory[0].grade, "Gold", "grade");
  assertEquals(database.inventory[0].quantity, 5, "quantity");
});

Deno.test("T1.6.2 add to existing stack", async () => {
  const database = installMockSupabase();
  addInventoryRow(database, {
    item_id: "crop_tomato",
    grade: "Gold",
    quantity: 5,
    category: "crops",
  });

  await addItemToInventory("player-001", "crop_tomato", "Gold", 3);

  assertEquals(database.inventory.length, 1, "inventory row count");
  assertEquals(database.inventory[0].quantity, 8, "quantity");
});

Deno.test("T1.6.3 different grade creates new row", async () => {
  const database = installMockSupabase();
  addInventoryRow(database, {
    item_id: "crop_tomato",
    grade: "Gold",
    quantity: 8,
    category: "crops",
  });

  await addItemToInventory("player-001", "crop_tomato", "Silver", 5);

  const tomatoRows = database.inventory.filter((row) =>
    row.item_id === "crop_tomato"
  );
  assertEquals(tomatoRows.length, 2, "tomato row count");
});

Deno.test("T1.6.4 inventory full blocks new item", async () => {
  const database = installMockSupabase({ crops: 20 });
  for (let index = 0; index < 20; index += 1) {
    addInventoryRow(database, {
      item_id: `crop_full_${index}`,
      grade: "Normal",
      quantity: 1,
      category: "crops",
    });
  }

  await assertRejectsWithMessage(
    () => addItemToInventory("player-001", "crop_tomato", "Gold", 5),
    "INVENTORY_FULL:crops:20:20",
  );
});

Deno.test("T1.6.5 full inventory allows existing stack", async () => {
  const database = installMockSupabase({ crops: 20 });
  addInventoryRow(database, {
    item_id: "crop_tomato",
    grade: "Gold",
    quantity: 5,
    category: "crops",
  });
  for (let index = 1; index < 20; index += 1) {
    addInventoryRow(database, {
      item_id: `crop_full_${index}`,
      grade: "Normal",
      quantity: 1,
      category: "crops",
    });
  }

  const result = await addItemToInventory(
    "player-001",
    "crop_tomato",
    "Gold",
    3,
  );

  assertEquals(result.newStackQuantity, 8, "new stack quantity");
  assertEquals(database.inventory.length, 20, "inventory row count");
});

Deno.test("T1.6.6 remove partial stack", async () => {
  const database = installMockSupabase();
  addInventoryRow(database, {
    item_id: "crop_tomato",
    grade: "Gold",
    quantity: 8,
    category: "crops",
  });

  const result = await removeItemFromInventory(
    "player-001",
    "crop_tomato",
    "Gold",
    3,
  );

  assertEquals(result, {
    success: true,
    quantityRemoved: 3,
    newStackQuantity: 5,
  }, "remove result");
  assertEquals(database.inventory[0].quantity, 5, "quantity");
});

Deno.test("T1.6.7 remove entire stack", async () => {
  const database = installMockSupabase();
  addInventoryRow(database, {
    item_id: "crop_tomato",
    grade: "Gold",
    quantity: 8,
    category: "crops",
  });

  await removeItemFromInventory("player-001", "crop_tomato", "Gold", 8);

  assertEquals(database.inventory.length, 0, "inventory row count");
});

Deno.test("T1.6.8 remove more than available", async () => {
  const database = installMockSupabase();
  addInventoryRow(database, {
    item_id: "crop_tomato",
    grade: "Gold",
    quantity: 5,
    category: "crops",
  });

  await assertRejectsWithMessage(
    () => removeItemFromInventory("player-001", "crop_tomato", "Gold", 10),
    "INSUFFICIENT_QUANTITY:5:10",
  );
});

Deno.test("T1.6.9 remove non-existent item", async () => {
  installMockSupabase();

  await assertRejectsWithMessage(
    () => removeItemFromInventory("player-001", "crop_tomato", "Gold", 1),
    "ITEM_NOT_FOUND:crop_tomato:Gold",
  );
});

Deno.test("T1.6.10 invalid grade", async () => {
  installMockSupabase();

  await assertRejectsWithMessage(
    () => addItemToInventory("player-001", "crop_tomato", "Platinum", 5),
    "INVALID_GRADE",
  );
});

Deno.test("T1.6.11 stack overflow", async () => {
  const database = installMockSupabase();
  addInventoryRow(database, {
    item_id: "crop_tomato",
    grade: "Gold",
    quantity: 995,
    category: "crops",
  });

  await assertRejectsWithMessage(
    () => addItemToInventory("player-001", "crop_tomato", "Gold", 5),
    "STACK_OVERFLOW",
  );
});

Deno.test("T1.6.12 correct fish category routing", async () => {
  const database = installMockSupabase();

  await addItemToInventory("player-001", "fish_catfish", "Normal", 3);

  assertEquals(getCategory("fish_catfish"), "fish", "category helper");
  assertEquals(database.inventory[0].category, "fish", "stored category");
});

Deno.test("T1.6.13 tools routing", async () => {
  const database = installMockSupabase();

  await addItemToInventory("player-001", "timeskip_1min", "Normal", 1);

  assertEquals(getCategory("timeskip_1min"), "tools", "category helper");
  assertEquals(database.inventory[0].category, "tools", "stored category");
});

Deno.test("addItemToInventory rejects invalid quantity", async () => {
  installMockSupabase();

  await assertRejectsWithMessage(
    () => addItemToInventory("player-001", "crop_tomato", "Gold", 0),
    "INVALID_QUANTITY",
  );
});
