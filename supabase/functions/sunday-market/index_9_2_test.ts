import {
  fulfillWishlist,
  getActiveWishlists,
  getISOWeekId,
  getMarketListings,
  getSundayMarketStubCallsForTesting,
  listItemAtStall,
  postWishlist,
  resetSundayMarketStubsForTesting,
  type SundayMarketStall,
} from "./index.ts";
import { setSupabaseAdminForTesting } from "../lib/supabase.ts";

type TableName =
  | "players"
  | "game_config"
  | "inventory"
  | "market_listings"
  | "wishlist_board"
  | "coin_transactions"
  | "neighbourhood_feed";

interface PlayerRow {
  id: string;
  coins: number;
  inventory_slots: Record<string, number>;
  sunday_market_stall: SundayMarketStall | null;
  wishlist_posts_today: { count: number; date: string } | null;
  neighbourhood_id: string | null;
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
  listed_at: string;
  week_id: string;
}

interface WishlistRow {
  id: string;
  poster_id: string;
  item_id: string;
  grade: string;
  quantity_wanted: number;
  quantity_fulfilled: number;
  price_per_unit: number;
  posted_at: string;
  expires_at: string;
}

interface CoinTransactionRow {
  id: string;
  idempotency_key: string;
  balance_before: number;
  balance_after: number;
}

interface FeedRow {
  id: string;
  neighbourhood_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  trigger_player_id: string | null;
  expires_at: string;
}

interface MockDatabase {
  players: PlayerRow[];
  game_config: GameConfigRow[];
  inventory: InventoryRow[];
  market_listings: MarketListingRow[];
  wishlist_board: WishlistRow[];
  coin_transactions: CoinTransactionRow[];
  neighbourhood_feed: FeedRow[];
}

const POSTER_ID = "poster-001";
const SELLER_ID = "seller-001";
const VIEWER_ID = "viewer-001";
const SUNDAY_SECONDS = Date.UTC(2026, 4, 3, 12, 0, 0) / 1000;
const MONDAY_SECONDS = Date.UTC(2026, 4, 4, 12, 0, 0) / 1000;
const DAY_TWO_SECONDS = Date.UTC(2026, 4, 4, 12, 0, 0) / 1000;
const EXPIRED_SECONDS = SUNDAY_SECONDS + 86_401;

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
    id: `listing-${overrides.price_per_unit ?? 10}`,
    seller_id: SELLER_ID,
    item_id: "crop_tomato",
    grade: "Normal",
    quantity: 1,
    price_per_unit: 10,
    listed_at: new Date(SUNDAY_SECONDS * 1000).toISOString(),
    week_id: getISOWeekId(SUNDAY_SECONDS),
    ...overrides,
  };
}

function wishlist(overrides: Partial<WishlistRow> = {}): WishlistRow {
  return {
    id: "wishlist-001",
    poster_id: POSTER_ID,
    item_id: "crop_tomato",
    grade: "Normal",
    quantity_wanted: 5,
    quantity_fulfilled: 0,
    price_per_unit: 20,
    posted_at: new Date(SUNDAY_SECONDS * 1000).toISOString(),
    expires_at: new Date((SUNDAY_SECONDS + 86_400) * 1000).toISOString(),
    ...overrides,
  };
}

function buildMockDatabase(overrides: {
  players?: Partial<PlayerRow>[];
  inventory?: InventoryRow[];
  listings?: MarketListingRow[];
  wishlists?: WishlistRow[];
} = {}): MockDatabase {
  const basePlayer = (id: string): PlayerRow => ({
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
    wishlist_posts_today: { count: 0, date: "" },
    neighbourhood_id: null,
  });

  return {
    players: (overrides.players ?? [
      { id: POSTER_ID },
      { id: SELLER_ID },
      { id: VIEWER_ID },
    ]).map((row) => ({
      ...basePlayer(String(row.id ?? POSTER_ID)),
      ...clone(row),
    })),
    game_config: [
      { key: "SUNDAY_MARKET_FEE", value: JSON.stringify(10_000) },
      { key: "SUNDAY_MARKET_INITIAL_SIZE", value: JSON.stringify(5) },
    ],
    inventory: clone(overrides.inventory ?? []),
    market_listings: clone(overrides.listings ?? []),
    wishlist_board: clone(overrides.wishlists ?? []),
    coin_transactions: [],
    neighbourhood_feed: [],
  };
}

function installMockSupabase(database: MockDatabase): MockDatabase {
  resetSundayMarketStubsForTesting();
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
    } else if (functionName === "credit_coins") {
      player.coins += amount;
    } else {
      return Promise.resolve({ data: null, error: { message: "UNKNOWN_RPC" } });
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
  private filters: Array<
    { column: string; op: "eq" | "like" | "gt"; value: unknown }
  > = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
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

  like(column: string, value: string): MockQueryBuilder {
    this.filters.push({ column, op: "like", value });
    return this;
  }

  gt(column: string, value: string): MockQueryBuilder {
    this.filters.push({ column, op: "gt", value });
    return this;
  }

  order(column: string, options: { ascending: boolean }): MockQueryBuilder {
    this.orderBy = { column, ascending: options.ascending };
    return this;
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
      } else if (this.table === "market_listings") {
        values.id = values.id ??
          `listing-${this.database.market_listings.length + 1}`;
        values.listed_at = values.listed_at ??
          new Date(Date.now()).toISOString();
        this.database.market_listings.push(
          values as unknown as MarketListingRow,
        );
      } else if (this.table === "wishlist_board") {
        values.id = values.id ??
          `wishlist-${this.database.wishlist_board.length + 1}`;
        values.quantity_fulfilled = values.quantity_fulfilled ?? 0;
        values.posted_at = values.posted_at ??
          new Date(Date.now()).toISOString();
        this.database.wishlist_board.push(values as unknown as WishlistRow);
      } else if (this.table === "neighbourhood_feed") {
        values.id = values.id ??
          `feed-${this.database.neighbourhood_feed.length + 1}`;
        this.database.neighbourhood_feed.push(values as unknown as FeedRow);
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
    const rows = this.tableRows().filter((row) =>
      this.filters.every((filter) => {
        const value = String(row[filter.column]);
        if (filter.op === "eq") return value === String(filter.value);
        if (filter.op === "gt") return value > String(filter.value);
        return value.startsWith(String(filter.value).replace("%", ""));
      })
    );
    if (!this.orderBy) return rows;
    return [...rows].sort((a, b) => {
      const av = a[this.orderBy!.column] as string | number;
      const bv = b[this.orderBy!.column] as string | number;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return this.orderBy!.ascending ? cmp : -cmp;
    });
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

Deno.test("T9.2.1 getMarketListings open", async () => {
  installMockSupabase(buildMockDatabase({
    listings: [
      listing({ id: "a" }),
      listing({ id: "b" }),
      listing({ id: "c" }),
    ],
  }));

  const result = await withMockedNow(
    SUNDAY_SECONDS,
    () => getMarketListings(VIEWER_ID),
  );

  assertEquals(result.totalListings, 3, "listing count");
  assertEquals(result.listings.map((row) => row.id), ["a", "b", "c"], "ids");
});

Deno.test("T9.2.2 getMarketListings closed", async () => {
  installMockSupabase(buildMockDatabase({
    listings: [listing({ id: "a" })],
  }));

  const result = await withMockedNow(
    MONDAY_SECONDS,
    () => getMarketListings(VIEWER_ID),
  );

  assertEquals(result, { listings: [], totalListings: 0 }, "closed result");
});

Deno.test("T9.2.3 Sort by price_asc", async () => {
  installMockSupabase(buildMockDatabase({
    listings: [
      listing({ id: "mid", price_per_unit: 30 }),
      listing({ id: "low", price_per_unit: 10 }),
      listing({ id: "high", price_per_unit: 50 }),
    ],
  }));

  const result = await withMockedNow(
    SUNDAY_SECONDS,
    () => getMarketListings(VIEWER_ID, { sortBy: "price_asc" }),
  );

  assertEquals(
    result.listings.map((row) => row.id),
    ["low", "mid", "high"],
    "sorted ids",
  );
});

Deno.test("T9.2.4 Post wishlist", async () => {
  const database = installMockSupabase(buildMockDatabase());

  const result = await withMockedNow(
    SUNDAY_SECONDS,
    () => postWishlist(POSTER_ID, "crop_tomato", "Normal", 5, 20),
  );

  assertEquals(result.wishlistId, "wishlist-1", "wishlist id");
  assertEquals(database.wishlist_board.length, 1, "entry created");
  assertEquals(database.players[0].wishlist_posts_today, {
    count: 1,
    date: "2026-05-03",
  }, "counter");
});

Deno.test("T9.2.5 4th post same day", async () => {
  installMockSupabase(buildMockDatabase({
    players: [{
      id: POSTER_ID,
      wishlist_posts_today: { count: 3, date: "2026-05-03" },
    }],
  }));

  await assertRejectsWithMessage(
    () =>
      withMockedNow(
        SUNDAY_SECONDS,
        () => postWishlist(POSTER_ID, "crop_tomato", "Normal", 1, 10),
      ),
    "DAILY_LIMIT_REACHED",
  );
});

Deno.test("T9.2.6 Post resets next day", async () => {
  const database = installMockSupabase(buildMockDatabase({
    players: [{
      id: POSTER_ID,
      wishlist_posts_today: { count: 3, date: "2026-05-03" },
    }],
  }));

  await withMockedNow(
    DAY_TWO_SECONDS,
    () => postWishlist(POSTER_ID, "crop_tomato", "Normal", 1, 10),
  );

  assertEquals(database.players[0].wishlist_posts_today, {
    count: 1,
    date: "2026-05-04",
  }, "counter reset");
});

Deno.test("T9.2.7 Wishlist expires", async () => {
  installMockSupabase(buildMockDatabase());

  await withMockedNow(
    SUNDAY_SECONDS,
    () => postWishlist(POSTER_ID, "crop_tomato", "Normal", 1, 10),
  );
  const active = await withMockedNow(
    EXPIRED_SECONDS,
    () => getActiveWishlists(),
  );

  assertEquals(active.length, 0, "expired hidden");
});

Deno.test("T9.2.8 Full fulfillment", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: [inv(SELLER_ID, "crop_tomato", "Normal", 5)],
    wishlists: [wishlist({ quantity_wanted: 5 })],
  }));

  const result = await withMockedNow(
    SUNDAY_SECONDS,
    () => fulfillWishlist(SELLER_ID, "wishlist-001", 5),
  );

  assertEquals(
    result,
    { fulfilled: 5, totalPaid: 100, wishlistComplete: true },
    "result",
  );
  assertEquals(database.wishlist_board.length, 0, "entry removed");
  assertEquals(
    database.players.find((row) => row.id === POSTER_ID)!.coins,
    49_900,
    "poster coins",
  );
  assertEquals(
    database.players.find((row) => row.id === SELLER_ID)!.coins,
    50_100,
    "seller coins",
  );
});

Deno.test("T9.2.9 Partial fulfillment", async () => {
  const database = installMockSupabase(buildMockDatabase({
    inventory: [inv(SELLER_ID, "crop_tomato", "Normal", 3)],
    wishlists: [wishlist({ quantity_wanted: 10 })],
  }));

  const result = await withMockedNow(
    SUNDAY_SECONDS,
    () => fulfillWishlist(SELLER_ID, "wishlist-001", 3),
  );

  assertEquals(
    result,
    { fulfilled: 3, totalPaid: 60, wishlistComplete: false },
    "result",
  );
  assertEquals(database.wishlist_board[0].quantity_fulfilled, 3, "fulfilled");
  assertEquals(
    database.wishlist_board[0].quantity_wanted -
      database.wishlist_board[0].quantity_fulfilled,
    7,
    "remaining",
  );
});

Deno.test("T9.2.10 Seller XP awarded", async () => {
  installMockSupabase(buildMockDatabase({
    inventory: [inv(SELLER_ID, "crop_tomato", "Normal", 1)],
    wishlists: [wishlist({ quantity_wanted: 1 })],
  }));

  await withMockedNow(
    SUNDAY_SECONDS,
    () => fulfillWishlist(SELLER_ID, "wishlist-001", 1),
  );

  assertEquals(getSundayMarketStubCallsForTesting().xpAwards, [{
    playerId: SELLER_ID,
    amount: 15,
    source: "FULFILL_WISHLIST",
  }], "xp call");
});

Deno.test("T9.2.11 Poster notified", async () => {
  installMockSupabase(buildMockDatabase({
    inventory: [inv(SELLER_ID, "crop_tomato", "Normal", 1)],
    wishlists: [wishlist({ quantity_wanted: 1 })],
  }));

  await withMockedNow(
    SUNDAY_SECONDS,
    () => fulfillWishlist(SELLER_ID, "wishlist-001", 1),
  );

  assertEquals(getSundayMarketStubCallsForTesting().notifications, [{
    playerId: POSTER_ID,
    type: "WISHLIST_FULFILLED",
    data: { quantity: 1, totalPaid: 20 },
  }], "notification call");
});

Deno.test("T9.2.12 Legendary market listing", async () => {
  const database = installMockSupabase(buildMockDatabase({
    players: [
      { id: SELLER_ID, neighbourhood_id: "neighbourhood-001" },
      { id: POSTER_ID },
    ],
    inventory: [inv(SELLER_ID, "fish_oarfish", "Legendary", 1)],
  }));

  const result = await withMockedNow(
    SUNDAY_SECONDS,
    () => listItemAtStall(SELLER_ID, "fish_oarfish", "Legendary", 1, 5000),
  );

  assertEquals(database.neighbourhood_feed.length, 1, "feed count");
  assertEquals(
    database.neighbourhood_feed[0].event_type,
    "LEGENDARY_MARKET_LISTING",
    "event type",
  );
  assertEquals(database.neighbourhood_feed[0].event_data, {
    listingId: result.listingId,
    itemId: "fish_oarfish",
    grade: "Legendary",
    quantity: 1,
    pricePerUnit: 5000,
  }, "event data");
});
