import {
  buyFromMarket,
  closeSundayMarket,
  getISOWeekId,
  getSundayMarketStall,
  isSundayMarketOpen,
  listItemAtStall,
  paySundayMarketFee,
  type SundayMarketStall,
} from "./index.ts";
import { setSupabaseAdminForTesting } from "../_lib/supabase.ts";

type TableName =
  | "players"
  | "game_config"
  | "inventory"
  | "market_listings"
  | "coin_transactions";

interface PlayerRow {
  id: string;
  coins: number;
  inventory_slots: Record<string, number>;
  sunday_market_stall: SundayMarketStall | null;
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

interface MarketListingRow {
  id: string;
  seller_id: string;
  item_id: string;
  grade: string;
  quantity: number;
  price_per_unit: number;
  week_id: string;
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
  market_listings: MarketListingRow[];
  coin_transactions: CoinTransactionRow[];
}

const SELLER_ID = "seller-001";
const BUYER_ID = "buyer-001";
const SUNDAY_SECONDS = Date.UTC(2026, 4, 3, 12, 0, 0) / 1000;
const MONDAY_SECONDS = Date.UTC(2026, 4, 4, 12, 0, 0) / 1000;
const TUESDAY_SECONDS = Date.UTC(2026, 4, 5, 12, 0, 0) / 1000;
const NEXT_SUNDAY_SECONDS = Date.UTC(2026, 4, 10, 12, 0, 0) / 1000;

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

async function assertRejectsWithMessage(
  action: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      expectedMessage,
      "error message",
    );
    return;
  }
  throw new Error(`Expected rejection with ${expectedMessage}`);
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

function listing(overrides: Partial<MarketListingRow> = {}): MarketListingRow {
  return {
    id: `listing-${Math.random()}`,
    seller_id: SELLER_ID,
    item_id: "crop_tomato",
    grade: "Normal",
    quantity: 5,
    price_per_unit: 20,
    week_id: getISOWeekId(SUNDAY_SECONDS),
    ...overrides,
  };
}

function buildMockDatabase(overrides: {
  players?: Partial<PlayerRow>[];
  inventory?: InventoryRow[];
  listings?: MarketListingRow[];
} = {}): MockDatabase {
  const player = (id: string): PlayerRow => ({
    id,
    coins: 50_000,
    inventory_slots: {
      crops: 5000,
      fish: 5000,
      animal_produce: 5000,
      processed: 5000,
      cooked_dishes: 5000,
      tools: 5000,
    },
    sunday_market_stall: {
      paidThisWeek: false,
      paidWeekId: "",
      stallSize: 5,
    },
  });
  return {
    players: (overrides.players ?? [{ id: SELLER_ID }, { id: BUYER_ID }]).map((
      row,
    ) => ({
      ...player(String(row.id ?? SELLER_ID)),
      ...clone(row),
    })),
    game_config: [
      { key: "SUNDAY_MARKET_FEE", value: JSON.stringify(10_000) },
      { key: "SUNDAY_MARKET_INITIAL_SIZE", value: JSON.stringify(5) },
    ],
    inventory: clone(overrides.inventory ?? []),
    market_listings: clone(overrides.listings ?? []),
    coin_transactions: [],
  };
}

function installMockSupabase(
  database: MockDatabase,
  options: { deleteListingAfterBuyerDebit?: string } = {},
): MockDatabase {
  setSupabaseAdminForTesting(new MockSupabaseClient(database, options));
  return database;
}

class MockSupabaseClient {
  constructor(
    readonly database: MockDatabase,
    private readonly options: { deleteListingAfterBuyerDebit?: string },
  ) {}

  from(table: string): MockQueryBuilder {
    return new MockQueryBuilder(this.database, table as TableName);
  }

  rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<
    { data: Record<string, unknown> | null; error: { message: string } | null }
  > {
    if (functionName !== "debit_coins" && functionName !== "credit_coins") {
      return Promise.resolve({ data: null, error: { message: "UNKNOWN_RPC" } });
    }
    const player = this.database.players.find((row) =>
      row.id === params.p_player_id
    );
    if (!player) {
      return Promise.resolve({
        data: null,
        error: { message: "PLAYER_NOT_FOUND:" + String(params.p_player_id) },
      });
    }

    const amount = Number(params.p_amount);
    const before = player.coins;
    if (functionName === "debit_coins") {
      if (before < amount) {
        return Promise.resolve({
          data: null,
          error: { message: `INSUFFICIENT_FUNDS:${before}:${amount}` },
        });
      }
      player.coins -= amount;
      if (
        params.p_player_id === BUYER_ID &&
        this.options.deleteListingAfterBuyerDebit
      ) {
        this.database.market_listings = this.database.market_listings.filter((
          row,
        ) => row.id !== this.options.deleteListingAfterBuyerDebit);
      }
    } else {
      player.coins += amount;
    }

    const tx = {
      id: `tx-${this.database.coin_transactions.length + 1}`,
      idempotency_key: String(params.p_idempotency_key),
      balance_before: before,
      balance_after: player.coins,
    };
    this.database.coin_transactions.push(tx);
    return Promise.resolve({
      data: {
        success: true,
        transactionId: tx.id,
        balanceBefore: before,
        balanceAfter: player.coins,
        idempotencyKey: tx.idempotency_key,
      },
      error: null,
    });
  }
}

class MockQueryBuilder {
  private selectedColumns = "*";
  private filters: Array<{ column: string; value: unknown }> = [];
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
    this.filters.push({ column, value });
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
      if (this.table === "market_listings") {
        values.id = values.id ??
          `listing-${this.database.market_listings.length + 1}`;
        this.database.market_listings.push(
          values as unknown as MarketListingRow,
        );
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
      this.filters.every((filter) =>
        String(row[filter.column]) === String(filter.value)
      )
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

Deno.test("T9.1.1 Market open on Sunday", () => {
  assertEquals(isSundayMarketOpen(SUNDAY_SECONDS), true, "Sunday open");
});

Deno.test("T9.1.2 Market closed on Monday", () => {
  assertEquals(isSundayMarketOpen(MONDAY_SECONDS), false, "Monday closed");
});

Deno.test("T9.1.3 List on non-Sunday", async () => {
  installMockSupabase(buildMockDatabase({
    inventory: [inv(SELLER_ID, "crop_tomato", "Normal", 5)],
  }));

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        TUESDAY_SECONDS,
        () => listItemAtStall(SELLER_ID, "crop_tomato", "Normal", 1, 10),
      ),
    "MARKET_NOT_OPEN",
  );
});

Deno.test("T9.1.4 Dish listing rejected", async () => {
  installMockSupabase(buildMockDatabase({
    inventory: [inv(SELLER_ID, "dish_cheeseburger", "Normal", 1)],
  }));

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        SUNDAY_SECONDS,
        () => listItemAtStall(SELLER_ID, "dish_cheeseburger", "Normal", 1, 100),
      ),
    "COOKED_DISHES_NOT_ALLOWED",
  );
});

Deno.test("T9.1.5 Stall fee once", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: [inv(SELLER_ID, "crop_tomato", "Normal", 3)],
  }));

  await withMockedNow(SUNDAY_SECONDS, async () => {
    await listItemAtStall(SELLER_ID, "crop_tomato", "Normal", 1, 10);
    await listItemAtStall(SELLER_ID, "crop_tomato", "Normal", 1, 10);
    await listItemAtStall(SELLER_ID, "crop_tomato", "Normal", 1, 10);
  });

  assertEquals(database.players[0].coins, 40_000, "single fee charged");
  assertEquals(database.coin_transactions.length, 1, "one debit transaction");
});

Deno.test("T9.1.6 Stall slot limit", async () => {
  installMockSupabase(buildMockDatabase({
    inventory: [inv(SELLER_ID, "crop_tomato", "Normal", 6)],
  }));

  await withMockedNow(SUNDAY_SECONDS, async () => {
    for (let i = 0; i < 5; i++) {
      await listItemAtStall(SELLER_ID, "crop_tomato", "Normal", 1, 10);
    }
    await assertRejectsWithMessage(
      () => listItemAtStall(SELLER_ID, "crop_tomato", "Normal", 1, 10),
      "STALL_FULL:5",
    );
  });
});

Deno.test("T9.1.7 Listing removes from inventory", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: [inv(SELLER_ID, "crop_tomato", "Gold", 10)],
  }));

  await withMockedNow(
    SUNDAY_SECONDS,
    () => listItemAtStall(SELLER_ID, "crop_tomato", "Gold", 5, 25),
  );

  assertEquals(database.inventory[0].quantity, 5, "remaining tomatoes");
});

Deno.test("T9.1.8 Buy transfers correctly", async () => {
  const activeListing = listing({ id: "listing-001" });
  const database = installMockSupabase(buildMockDatabase({
    listings: [activeListing],
  }));

  const result = await withMockedNow(
    SUNDAY_SECONDS,
    () => buyFromMarket(BUYER_ID, activeListing.id),
  );

  assertEquals(result.totalCost, 100, "total cost");
  assertEquals(
    database.players.find((row) => row.id === BUYER_ID)!.coins,
    49_900,
    "buyer coins",
  );
  assertEquals(
    database.players.find((row) => row.id === SELLER_ID)!.coins,
    50_100,
    "seller coins",
  );
  assertEquals(database.inventory[0].player_id, BUYER_ID, "buyer inventory");
  assertEquals(database.inventory[0].quantity, 5, "buyer item quantity");
  assertEquals(database.market_listings.length, 0, "listing deleted");
});

Deno.test("T9.1.9 Race condition full refund", async () => {
  const activeListing = listing({ id: "listing-race" });
  const database = installMockSupabase(
    buildMockDatabase({ listings: [activeListing] }),
    { deleteListingAfterBuyerDebit: activeListing.id },
  );

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        SUNDAY_SECONDS,
        () => buyFromMarket(BUYER_ID, activeListing.id),
      ),
    "ITEM_SOLD_OUT_RACE_CONDITION",
  );
  assertEquals(
    database.players.find((row) => row.id === BUYER_ID)!.coins,
    50_000,
    "buyer refunded",
  );
  assertEquals(
    database.players.find((row) => row.id === SELLER_ID)!.coins,
    50_000,
    "seller unchanged",
  );
  assertEquals(database.inventory.length, 0, "no inventory added");
});

Deno.test("T9.1.10 Market close returns items", async () => {
  const listings = Array.from(
    { length: 10 },
    (_, index) => listing({ id: `listing-${index}`, quantity: 1 }),
  );
  const database = installMockSupabase(buildMockDatabase({ listings }));

  const result = await withMockedNow(SUNDAY_SECONDS, () => closeSundayMarket());

  assertEquals(
    result,
    { playersRefunded: 1, itemsReturned: 10 },
    "closure result",
  );
  assertEquals(database.market_listings.length, 0, "listings cleared");
  assertEquals(database.inventory[0].quantity, 10, "items returned");
  assertEquals(
    database.players[0].sunday_market_stall?.paidThisWeek,
    false,
    "stall reset",
  );
});

Deno.test("T9.1.11 Stall fee resets next Sunday", async () => {
  const database = installMockSupabase(buildMockDatabase());

  await withMockedNow(SUNDAY_SECONDS, () => paySundayMarketFee(SELLER_ID));
  assertEquals(
    database.players[0].sunday_market_stall?.paidThisWeek,
    true,
    "paid",
  );

  const stall = await withMockedNow(
    NEXT_SUNDAY_SECONDS,
    () => getSundayMarketStall(SELLER_ID),
  );

  assertEquals(stall.paidThisWeek, false, "reset read");
  assertEquals(
    database.players[0].sunday_market_stall?.paidThisWeek,
    false,
    "reset persisted",
  );
});
