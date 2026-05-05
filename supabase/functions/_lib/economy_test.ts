import {
  creditCoins,
  debitCoins,
  getBalance,
  validateCanAfford,
} from "./economy.ts";
import { setSupabaseAdminForTesting } from "./supabase.ts";

type TableName = "players" | "coin_transactions";

interface PlayerRow {
  id: string;
  coins: number;
}

interface CoinTransactionRow {
  id: string;
  player_id: string;
  direction: "DEBIT" | "CREDIT";
  amount: number;
  transaction_type: string;
  balance_before: number;
  balance_after: number;
  idempotency_key: string;
  metadata: Record<string, unknown>;
}

interface MockDatabase {
  players: PlayerRow[];
  coin_transactions: CoinTransactionRow[];
  rpcCalls: Array<{ functionName: string; params: Record<string, unknown> }>;
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
 * Builds a new in-memory economy database.
 * @param balance - Starting balance for the default player.
 * @returns Mock database.
 * @throws Never.
 */
function buildMockDatabase(balance: number): MockDatabase {
  return {
    players: [{ id: "player-001", coins: balance }],
    coin_transactions: [],
    rpcCalls: [],
  };
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

  /**
   * Executes a mock Postgres RPC.
   * @param functionName - RPC function name.
   * @param params - RPC parameters.
   * @returns RPC result.
   * @throws Never.
   */
  async rpc(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<
    { data: Record<string, unknown> | null; error: { message: string } | null }
  > {
    this.database.rpcCalls.push({ functionName, params: clone(params) });
    if (functionName !== "debit_coins" && functionName !== "credit_coins") {
      return {
        data: null,
        error: { message: `RPC_NOT_FOUND:${functionName}` },
      };
    }

    const playerId = String(params.p_player_id);
    const amount = Number(params.p_amount);
    const player = this.database.players.find((row) => row.id === playerId);
    if (!player) {
      return { data: null, error: { message: `PLAYER_NOT_FOUND:${playerId}` } };
    }

    const balanceBefore = player.coins;
    const isDebit = functionName === "debit_coins";
    if (isDebit && balanceBefore < amount) {
      return {
        data: null,
        error: { message: `INSUFFICIENT_FUNDS:${balanceBefore}:${amount}` },
      };
    }

    const balanceAfter = isDebit
      ? balanceBefore - amount
      : balanceBefore + amount;
    const transaction = {
      id: `txn-${
        String(this.database.coin_transactions.length + 1).padStart(3, "0")
      }`,
      player_id: playerId,
      direction: isDebit ? "DEBIT" as const : "CREDIT" as const,
      amount,
      transaction_type: String(params.p_transaction_type),
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      idempotency_key: String(params.p_idempotency_key),
      metadata: clone(params.p_metadata as Record<string, unknown>),
    };

    player.coins = balanceAfter;
    this.database.coin_transactions.push(transaction);

    return {
      data: {
        success: true,
        transactionId: transaction.id,
        balanceBefore,
        balanceAfter,
        idempotencyKey: transaction.idempotency_key,
      },
      error: null,
    };
  }
}

class MockQueryBuilder {
  private readonly database: MockDatabase;
  private readonly table: TableName;
  private selectedColumns = "*";
  private filters: Array<{ column: string; value: string }> = [];

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
   * Resolves a maybeSingle query.
   * @returns Query result with zero or one row.
   * @throws Never.
   */
  async maybeSingle(): Promise<
    { data: Record<string, unknown> | null; error: null }
  > {
    const rows = this.tableRows().filter((row) =>
      this.filters.every((filter) =>
        String(row[filter.column]) === filter.value
      )
    );
    return {
      data: rows.length > 0 ? this.projectRow(rows[0]) : null,
      error: null,
    };
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
 * @param balance - Starting balance for the default player.
 * @returns Mock database backing the client.
 * @throws Never.
 */
function installMockSupabase(balance: number): MockDatabase {
  const database = buildMockDatabase(balance);
  setSupabaseAdminForTesting(new MockSupabaseClient(database));
  return database;
}

Deno.test("T1.3.1 normal debit succeeds and creates transaction", async () => {
  const database = installMockSupabase(500);
  const result = await debitCoins(
    "player-001",
    100,
    "SEED_PURCHASE",
    "key-001",
    {
      itemId: "seed_wheat",
    },
  );

  assertEquals(result, {
    success: true,
    transactionId: "txn-001",
    balanceBefore: 500,
    balanceAfter: 400,
    idempotencyKey: "key-001",
  }, "debit result");
  assertEquals(database.players[0].coins, 400, "player balance");
  assertEquals(database.coin_transactions.length, 1, "transaction count");
});

Deno.test("T1.3.2 exact balance debit succeeds", async () => {
  const database = installMockSupabase(500);
  const result = await debitCoins(
    "player-001",
    500,
    "SEED_PURCHASE",
    "key-002",
    {},
  );

  assertEquals(result.balanceAfter, 0, "balance after");
  assertEquals(database.players[0].coins, 0, "player balance");
});

Deno.test("T1.3.3 insufficient funds throws and leaves balance unchanged", async () => {
  const database = installMockSupabase(500);

  await assertRejectsWithMessage(
    () => debitCoins("player-001", 501, "SEED_PURCHASE", "key-003", {}),
    "INSUFFICIENT_FUNDS:500:501",
  );

  assertEquals(database.players[0].coins, 500, "player balance");
  assertEquals(database.coin_transactions.length, 0, "transaction count");
});

Deno.test("T1.3.4 same idempotency key returns same result and debits once", async () => {
  const database = installMockSupabase(500);

  const first = await debitCoins(
    "player-001",
    100,
    "SEED_PURCHASE",
    "key-004",
    {},
  );
  const second = await debitCoins(
    "player-001",
    100,
    "SEED_PURCHASE",
    "key-004",
    {},
  );

  assertEquals(second, first, "idempotent result");
  assertEquals(database.players[0].coins, 400, "player balance");
  assertEquals(database.coin_transactions.length, 1, "transaction count");
  assertEquals(database.rpcCalls.length, 1, "rpc calls");
});

Deno.test("T1.3.5 amount zero throws INVALID_AMOUNT", async () => {
  const database = installMockSupabase(500);

  await assertRejectsWithMessage(
    () => debitCoins("player-001", 0, "SEED_PURCHASE", "key-005", {}),
    "INVALID_AMOUNT",
  );

  assertEquals(database.rpcCalls.length, 0, "rpc calls");
});

Deno.test("T1.3.6 negative amount throws INVALID_AMOUNT", async () => {
  const database = installMockSupabase(500);

  await assertRejectsWithMessage(
    () => debitCoins("player-001", -50, "SEED_PURCHASE", "key-006", {}),
    "INVALID_AMOUNT",
  );

  assertEquals(database.rpcCalls.length, 0, "rpc calls");
});

Deno.test("T1.3.7 decimal amount throws INVALID_AMOUNT", async () => {
  const database = installMockSupabase(500);

  await assertRejectsWithMessage(
    () => debitCoins("player-001", 10.5, "SEED_PURCHASE", "key-007", {}),
    "INVALID_AMOUNT",
  );

  assertEquals(database.rpcCalls.length, 0, "rpc calls");
});

Deno.test("T1.3.8 fake type throws INVALID_TRANSACTION_TYPE", async () => {
  const database = installMockSupabase(500);

  await assertRejectsWithMessage(
    () => debitCoins("player-001", 10, "FAKE_TYPE", "key-008", {}),
    "INVALID_TRANSACTION_TYPE",
  );

  assertEquals(database.rpcCalls.length, 0, "rpc calls");
});

Deno.test("T1.3.9 successful debit records complete coin transaction row", async () => {
  const database = installMockSupabase(500);

  await debitCoins("player-001", 125, "STRANGER_STEAL", "key-009", {
    targetPlayerId: "player-002",
  });

  assertEquals(database.coin_transactions[0], {
    id: "txn-001",
    player_id: "player-001",
    direction: "DEBIT",
    amount: 125,
    transaction_type: "STRANGER_STEAL",
    balance_before: 500,
    balance_after: 375,
    idempotency_key: "key-009",
    metadata: { targetPlayerId: "player-002" },
  }, "coin transaction row");
});

Deno.test("T1.3.10 balance one amount one debits to zero", async () => {
  const database = installMockSupabase(1);
  const result = await debitCoins(
    "player-001",
    1,
    "SEED_PURCHASE",
    "key-010",
    {},
  );

  assertEquals(result.balanceAfter, 0, "balance after");
  assertEquals(database.players[0].coins, 0, "player balance");
});

Deno.test("T1.3.11 empty idempotency key throws INVALID_IDEMPOTENCY_KEY", async () => {
  const database = installMockSupabase(500);

  await assertRejectsWithMessage(
    () => debitCoins("player-001", 10, "SEED_PURCHASE", "", {}),
    "INVALID_IDEMPOTENCY_KEY",
  );

  assertEquals(database.rpcCalls.length, 0, "rpc calls");
});

Deno.test("T1.4.1 normal credit succeeds", async () => {
  const database = installMockSupabase(300);
  const result = await creditCoins(
    "player-001",
    200,
    "RESTAURANT_EARNINGS",
    "credit-key-001",
    { restaurantId: "restaurant-001" },
  );

  assertEquals(result, {
    success: true,
    transactionId: "txn-001",
    balanceBefore: 300,
    balanceAfter: 500,
    idempotencyKey: "credit-key-001",
  }, "credit result");
  assertEquals(database.players[0].coins, 500, "player balance");
});

Deno.test("T1.4.2 credit from zero succeeds", async () => {
  const database = installMockSupabase(0);
  const result = await creditCoins(
    "player-001",
    100,
    "DAILY_LOGIN_BONUS",
    "credit-key-002",
    {},
  );

  assertEquals(result.balanceAfter, 100, "balance after");
  assertEquals(database.players[0].coins, 100, "player balance");
});

Deno.test("T1.4.3 same idempotency key returns same result and credits once", async () => {
  const database = installMockSupabase(300);

  const first = await creditCoins(
    "player-001",
    200,
    "RESTAURANT_EARNINGS",
    "credit-key-003",
    {},
  );
  const second = await creditCoins(
    "player-001",
    200,
    "RESTAURANT_EARNINGS",
    "credit-key-003",
    {},
  );

  assertEquals(second, first, "idempotent result");
  assertEquals(database.players[0].coins, 500, "player balance");
  assertEquals(database.coin_transactions.length, 1, "transaction count");
  assertEquals(database.rpcCalls.length, 1, "rpc calls");
});

Deno.test("T1.4.4 successful credit records credit transaction row", async () => {
  const database = installMockSupabase(300);

  await creditCoins("player-001", 75, "HELP_REWARD", "credit-key-004", {
    helpedPlayerId: "player-002",
  });

  assertEquals(database.coin_transactions[0], {
    id: "txn-001",
    player_id: "player-001",
    direction: "CREDIT",
    amount: 75,
    transaction_type: "HELP_REWARD",
    balance_before: 300,
    balance_after: 375,
    idempotency_key: "credit-key-004",
    metadata: { helpedPlayerId: "player-002" },
  }, "coin transaction row");
});

Deno.test("T1.4.5 amount zero throws INVALID_AMOUNT", async () => {
  const database = installMockSupabase(300);

  await assertRejectsWithMessage(
    () =>
      creditCoins(
        "player-001",
        0,
        "RESTAURANT_EARNINGS",
        "credit-key-005",
        {},
      ),
    "INVALID_AMOUNT",
  );

  assertEquals(database.rpcCalls.length, 0, "rpc calls");
});

Deno.test("T1.4.6 invalid type throws INVALID_TRANSACTION_TYPE", async () => {
  const database = installMockSupabase(300);

  await assertRejectsWithMessage(
    () =>
      creditCoins(
        "player-001",
        100,
        "HARVEST_REWARD",
        "credit-key-006",
        {},
      ),
    "INVALID_TRANSACTION_TYPE",
  );

  assertEquals(database.rpcCalls.length, 0, "rpc calls");
});

Deno.test("T1.4.7 large credit has no maximum cap", async () => {
  const database = installMockSupabase(0);
  const result = await creditCoins(
    "player-001",
    1000000,
    "ADMIN_GRANT",
    "credit-key-007",
    {},
  );

  assertEquals(result.balanceAfter, 1000000, "balance after");
  assertEquals(database.players[0].coins, 1000000, "player balance");
});

Deno.test("T1.5.1 getBalance returns correct value", async () => {
  installMockSupabase(1500);

  const result = await getBalance("player-001");

  assertEquals(result, {
    balance: 1500,
    playerId: "player-001",
  }, "balance result");
});

Deno.test("T1.5.2 validateCanAfford returns true when balance covers amount", async () => {
  installMockSupabase(1000);

  const result = await validateCanAfford("player-001", 500);

  assertEquals(result, {
    canAfford: true,
    balance: 1000,
    required: 500,
  }, "affordability result");
});

Deno.test("T1.5.3 validateCanAfford returns false when balance is too low", async () => {
  installMockSupabase(100);

  const result = await validateCanAfford("player-001", 200);

  assertEquals(result, {
    canAfford: false,
    balance: 100,
    required: 200,
  }, "affordability result");
});

Deno.test("T1.5.4 validateCanAfford exact boundary returns true", async () => {
  installMockSupabase(500);

  const result = await validateCanAfford("player-001", 500);

  assertEquals(result.canAfford, true, "can afford");
});

Deno.test("T1.5.5 validateCanAfford one over returns false", async () => {
  installMockSupabase(500);

  const result = await validateCanAfford("player-001", 501);

  assertEquals(result.canAfford, false, "can afford");
});

Deno.test("T1.5.6 getBalance and validateCanAfford do not change balance", async () => {
  const database = installMockSupabase(725);

  const before = await getBalance("player-001");
  await validateCanAfford("player-001", 300);
  await getBalance("player-001");
  const after = await getBalance("player-001");

  assertEquals(before.balance, 725, "balance before");
  assertEquals(after.balance, 725, "balance after");
  assertEquals(database.players[0].coins, 725, "stored player balance");
  assertEquals(database.coin_transactions.length, 0, "transaction count");
  assertEquals(database.rpcCalls.length, 0, "rpc calls");
});

Deno.test("T1.5.7 validateCanAfford zero amount throws INVALID_AMOUNT", async () => {
  const database = installMockSupabase(500);

  await assertRejectsWithMessage(
    () => validateCanAfford("player-001", 0),
    "INVALID_AMOUNT",
  );

  assertEquals(database.rpcCalls.length, 0, "rpc calls");
});

Deno.test("T1.5.8 validateCanAfford negative amount throws INVALID_AMOUNT", async () => {
  const database = installMockSupabase(500);

  await assertRejectsWithMessage(
    () => validateCanAfford("player-001", -1),
    "INVALID_AMOUNT",
  );

  assertEquals(database.rpcCalls.length, 0, "rpc calls");
});
