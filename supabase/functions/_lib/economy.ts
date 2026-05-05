import { supabaseAdmin } from "./supabase.ts";

export type DebitTransactionType =
  | "SEED_PURCHASE"
  | "ANIMAL_FEED_PURCHASE"
  | "PET_FOOD"
  | "STAFF_HIRE"
  | "STAFF_UPGRADE"
  | "RESTAURANT_UPGRADE"
  | "SABOTAGE_BUG"
  | "SABOTAGE_WEED"
  | "STRANGER_STEAL"
  | "SUNDAY_MARKET_STALL_FEE"
  | "SUNDAY_MARKET_STALL_UPGRADE"
  | "SUNDAY_MARKET_PURCHASE"
  | "WISHLIST_FULFILLMENT_BUYER"
  | "PLOT_EXPANSION"
  | "MICHELIN_DEPOSIT"
  | "LOTTERY_ENTRY"
  | "NPC_MARKET_PURCHASE"
  | "FISH_BAIT_NPC";

export type CreditTransactionType =
  | "RESTAURANT_EARNINGS"
  | "STRANGER_STEAL_REFUND"
  | "STEAL_REFUND_RACE_CONDITION"
  | "HELP_REWARD"
  | "EVENT_REWARD"
  | "DAILY_CHALLENGE_REWARD"
  | "WISHLIST_FULFILLMENT_SELLER"
  | "SUNDAY_MARKET_SALE"
  | "DAILY_LOGIN_BONUS"
  | "STARTER_GRANT"
  | "ADMIN_GRANT"
  | "LOTTERY_WIN";

export interface DebitResult {
  success: true;
  transactionId: string;
  balanceBefore: number;
  balanceAfter: number;
  idempotencyKey: string;
}

export interface CreditResult {
  success: true;
  transactionId: string;
  balanceBefore: number;
  balanceAfter: number;
  idempotencyKey: string;
}

export interface BalanceResult {
  balance: number;
  playerId: string;
}

export interface AffordabilityCheck {
  canAfford: boolean;
  balance: number;
  required: number;
}

interface CoinTransactionRow {
  id: string;
  balance_before: number;
  balance_after: number;
}

interface CoinTransactionQuery {
  select(columns: string): CoinTransactionQuery;
  eq(column: string, value: string): CoinTransactionQuery;
  maybeSingle(): Promise<
    { data: CoinTransactionRow | null; error: { message: string } | null }
  >;
}

interface PlayerBalanceRow {
  coins: number;
}

interface PlayerBalanceQuery {
  select(columns: string): PlayerBalanceQuery;
  eq(column: string, value: string): PlayerBalanceQuery;
  maybeSingle(): Promise<
    { data: PlayerBalanceRow | null; error: { message: string } | null }
  >;
}

interface RpcClient {
  rpc(functionName: string, params: Record<string, unknown>): Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

export const VALID_DEBIT_TYPES: DebitTransactionType[] = [
  "SEED_PURCHASE",
  "ANIMAL_FEED_PURCHASE",
  "PET_FOOD",
  "STAFF_HIRE",
  "STAFF_UPGRADE",
  "RESTAURANT_UPGRADE",
  "SABOTAGE_BUG",
  "SABOTAGE_WEED",
  "STRANGER_STEAL",
  "SUNDAY_MARKET_STALL_FEE",
  "SUNDAY_MARKET_STALL_UPGRADE",
  "SUNDAY_MARKET_PURCHASE",
  "WISHLIST_FULFILLMENT_BUYER",
  "PLOT_EXPANSION",
  "MICHELIN_DEPOSIT",
  "LOTTERY_ENTRY",
  "NPC_MARKET_PURCHASE",
  "FISH_BAIT_NPC",
];

export const VALID_CREDIT_TYPES: CreditTransactionType[] = [
  "RESTAURANT_EARNINGS",
  "STRANGER_STEAL_REFUND",
  "STEAL_REFUND_RACE_CONDITION",
  "HELP_REWARD",
  "EVENT_REWARD",
  "DAILY_CHALLENGE_REWARD",
  "WISHLIST_FULFILLMENT_SELLER",
  "SUNDAY_MARKET_SALE",
  "DAILY_LOGIN_BONUS",
  "STARTER_GRANT",
  "ADMIN_GRANT",
  "LOTTERY_WIN",
];

/**
 * Atomically deducts coins from a player's balance using a PostgreSQL transaction.
 * Uses SELECT ... FOR UPDATE in the debit_coins RPC to prevent race conditions.
 * The ONLY TypeScript helper that may request an outgoing coin transaction.
 * @param playerId - Target player UUID.
 * @param amount - Positive integer coins to deduct.
 * @param transactionType - Must be a DebitTransactionType value.
 * @param idempotencyKey - Unique string per transaction.
 * @param metadata - Arbitrary JSON for logging context.
 * @returns Debit result including transaction ID and balances before and after.
 * @throws INVALID_AMOUNT if amount is not a positive integer.
 * @throws INVALID_TRANSACTION_TYPE if transactionType is not valid.
 * @throws INVALID_IDEMPOTENCY_KEY if idempotencyKey is empty.
 * @throws DB_ERROR when the idempotency query fails.
 * @throws INSUFFICIENT_FUNDS:{balance}:{amount} when the player cannot afford the debit.
 * @throws PLAYER_NOT_FOUND:{playerId} when the target player does not exist.
 */
export async function debitCoins(
  playerId: string,
  amount: number,
  transactionType: string,
  idempotencyKey: string,
  metadata: Record<string, unknown>,
): Promise<DebitResult> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("INVALID_AMOUNT");
  }
  if (!VALID_DEBIT_TYPES.includes(transactionType as DebitTransactionType)) {
    throw new Error("INVALID_TRANSACTION_TYPE");
  }
  if (!idempotencyKey) throw new Error("INVALID_IDEMPOTENCY_KEY");

  const { data: existing, error: existingError } =
    await (supabaseAdmin.from("coin_transactions") as CoinTransactionQuery)
      .select("balance_before, balance_after, id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

  if (existingError) throw new Error("DB_ERROR:" + existingError.message);
  if (existing) {
    return {
      success: true,
      transactionId: existing.id,
      balanceBefore: existing.balance_before,
      balanceAfter: existing.balance_after,
      idempotencyKey,
    };
  }

  const { data, error } = await (supabaseAdmin as unknown as RpcClient).rpc(
    "debit_coins",
    {
      p_player_id: playerId,
      p_amount: amount,
      p_transaction_type: transactionType,
      p_idempotency_key: idempotencyKey,
      p_metadata: metadata,
    },
  );
  if (error) throw new Error(error.message);
  return data as DebitResult;
}

/**
 * Atomically adds coins to a player's balance using a PostgreSQL transaction.
 * Uses SELECT ... FOR UPDATE in the credit_coins RPC to prevent race conditions.
 * The ONLY TypeScript helper that may request an incoming coin transaction.
 * No balance cap exists in V1.
 * @param playerId - Target player UUID.
 * @param amount - Positive integer coins to credit.
 * @param transactionType - Must be a CreditTransactionType value.
 * @param idempotencyKey - Unique string per transaction.
 * @param metadata - Arbitrary JSON for logging context.
 * @returns Credit result including transaction ID and balances before and after.
 * @throws INVALID_AMOUNT if amount is not a positive integer.
 * @throws INVALID_TRANSACTION_TYPE if transactionType is not valid.
 * @throws INVALID_IDEMPOTENCY_KEY if idempotencyKey is empty.
 * @throws DB_ERROR when the idempotency query fails.
 * @throws PLAYER_NOT_FOUND:{playerId} when the target player does not exist.
 */
export async function creditCoins(
  playerId: string,
  amount: number,
  transactionType: string,
  idempotencyKey: string,
  metadata: Record<string, unknown>,
): Promise<CreditResult> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("INVALID_AMOUNT");
  }
  if (!VALID_CREDIT_TYPES.includes(transactionType as CreditTransactionType)) {
    throw new Error("INVALID_TRANSACTION_TYPE");
  }
  if (!idempotencyKey) throw new Error("INVALID_IDEMPOTENCY_KEY");

  const { data: existing, error: existingError } =
    await (supabaseAdmin.from("coin_transactions") as CoinTransactionQuery)
      .select("balance_before, balance_after, id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

  if (existingError) throw new Error("DB_ERROR:" + existingError.message);
  if (existing) {
    return {
      success: true,
      transactionId: existing.id,
      balanceBefore: existing.balance_before,
      balanceAfter: existing.balance_after,
      idempotencyKey,
    };
  }

  const { data, error } = await (supabaseAdmin as unknown as RpcClient).rpc(
    "credit_coins",
    {
      p_player_id: playerId,
      p_amount: amount,
      p_transaction_type: transactionType,
      p_idempotency_key: idempotencyKey,
      p_metadata: metadata,
    },
  );
  if (error) throw new Error(error.message);
  return data as CreditResult;
}

/**
 * Returns the current coin balance for a player without mutating state.
 * @param playerId - Target player UUID.
 * @returns Current balance and player ID.
 * @throws DB_ERROR when the player query fails.
 * @throws PLAYER_NOT_FOUND:{playerId} when the target player does not exist.
 */
export async function getBalance(playerId: string): Promise<BalanceResult> {
  const { data, error } =
    await (supabaseAdmin.from("players") as PlayerBalanceQuery)
      .select("coins")
      .eq("id", playerId)
      .maybeSingle();

  if (error) throw new Error("DB_ERROR:" + error.message);
  if (!data) throw new Error("PLAYER_NOT_FOUND:" + playerId);

  return { balance: data.coins, playerId };
}

/**
 * Checks whether a player has enough coins for an amount without mutating state.
 * @param playerId - Target player UUID.
 * @param amount - Positive coin amount to check.
 * @returns Affordability result with current balance and required amount.
 * @throws INVALID_AMOUNT if amount is less than or equal to zero.
 * @throws DB_ERROR when the balance query fails.
 * @throws PLAYER_NOT_FOUND:{playerId} when the target player does not exist.
 */
export async function validateCanAfford(
  playerId: string,
  amount: number,
): Promise<AffordabilityCheck> {
  if (amount <= 0) throw new Error("INVALID_AMOUNT");

  const { balance } = await getBalance(playerId);
  return { canAfford: balance >= amount, balance, required: amount };
}
