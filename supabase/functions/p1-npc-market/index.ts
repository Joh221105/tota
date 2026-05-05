import { getConfig } from "../_lib/config.ts";
import { debitCoins } from "../_lib/economy.ts";
import { addItemToInventory } from "../_lib/inventory.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../_lib/supabase.ts";

export type RotationGrade = "Bronze" | "Silver";

export interface RotationSlot {
  slotId: number;
  itemId: string;
  grade: RotationGrade;
  price: number;
  stockPerPlayer: number;
}

export interface RotationStockSlot {
  slotId: number;
  itemId?: string;
  remaining: number;
}

export interface PlayerRotationStock {
  date: string;
  slots: RotationStockSlot[];
}

export interface PurchaseResult {
  success: true;
  itemId: string;
  grade: string;
  quantity: number;
  totalCost: number;
}

interface PlayerMarketRow {
  npc_rotation_stock?: PlayerRotationStock | null;
}

interface PlayerMarketQuery {
  select(columns: string): PlayerMarketQuery;
  eq(column: string, value: string): PlayerMarketQuery;
  single(): Promise<
    { data: PlayerMarketRow | null; error: { message: string } | null }
  >;
  update(values: Record<string, unknown>): PlayerMarketQuery;
  then<
    TResult1 = {
      data: PlayerMarketRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: PlayerMarketRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

/**
 * Determines the five daily NPC market rotation slots from the configured pool.
 * The same date and pool always produce the same item ordering, grades, prices, and stock.
 * @param dateString - ISO calendar date string, for example 2026-05-04.
 * @returns Daily rotation slots.
 * @throws CONFIG_KEY_NOT_FOUND:NPC_ROTATION_POOL when the pool config is missing.
 * @throws INVALID_NPC_ROTATION_POOL when the pool cannot provide five unique items.
 * @throws CONFIG_KEY_NOT_FOUND:{itemId} or ITEM_BASE_VALUE_MISSING:{itemId} when an item's base value cannot be read.
 */
export async function determineNPCRotation(
  dateString: string,
): Promise<RotationSlot[]> {
  const pool = await getConfig("NPC_ROTATION_POOL") as string[];
  if (!Array.isArray(pool) || new Set(pool).size < 5) {
    throw new Error("INVALID_NPC_ROTATION_POOL");
  }

  let hash = 7;
  for (let i = 0; i < dateString.length; i++) {
    hash = hash * 31 + dateString.charCodeAt(i) + i;
  }
  hash = Math.abs(hash);

  const selected: string[] = [];
  for (let i = 0; i < 5; i++) {
    let idx = (hash + i * 7) % pool.length;
    while (selected.includes(pool[idx])) idx = (idx + 1) % pool.length;
    selected.push(pool[idx]);
  }

  return await Promise.all(selected.map(async (itemId, i) => ({
    slotId: i,
    itemId,
    grade: (["Bronze", "Silver"] as RotationGrade[])[(hash + i * 3) % 2],
    price: await getItemBaseValue(itemId) * 2,
    stockPerPlayer: 5,
  })));
}

/**
 * Buys items from the NPC market and adds them to the player's inventory after debiting coins.
 * Always-available items are bought as Normal grade; rotation items use their configured daily grade and per-player stock.
 * @param playerId - Player UUID.
 * @param itemId - Item ID to buy.
 * @param grade - Requested grade for rotation items, or null for Normal.
 * @param quantity - Quantity to purchase.
 * @returns Purchase result with total cost.
 * @throws INVALID_QUANTITY when quantity is not an integer from 1 through 999.
 * @throws ITEM_NOT_IN_NPC_MARKET:{itemId} when the item is absent from always-available and rotation stock.
 * @throws ROTATION_ITEM_SOLD_OUT:{itemId} when a rotation slot has no remaining stock.
 * @throws ROTATION_INSUFFICIENT_STOCK:{remaining}:{quantity} when the requested quantity exceeds remaining stock.
 * @throws INSUFFICIENT_FUNDS from debitCoins when balance is too low.
 * @throws Helper errors from getConfig, debitCoins, addItemToInventory, or Supabase writes.
 */
export async function buyFromNPCMarket(
  playerId: string,
  itemId: string,
  grade: string | null,
  quantity: number,
): Promise<PurchaseResult> {
  // SPEC_AMBIGUITY: Quantity validation order is not specified; this validates before debiting so invalid or unaddable quantities cannot spend coins without inventory delivery.
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    throw new Error("INVALID_QUANTITY");
  }

  const always = await getConfig("NPC_ALWAYS_AVAILABLE") as Record<
    string,
    number
  >;
  let price: number;
  let effectiveGrade = "Normal";

  if (Object.hasOwn(always, itemId)) {
    price = Number(always[itemId]);
  } else {
    const today = todayDateString();
    const rotation = await determineNPCRotation(today);
    const requestedGrade = grade ?? "Normal";
    const slot = rotation.find((entry) =>
      entry.itemId === itemId && entry.grade === requestedGrade
    );
    if (!slot) throw new Error("ITEM_NOT_IN_NPC_MARKET:" + itemId);

    effectiveGrade = slot.grade;
    price = slot.price;

    const { data: player, error } = await (supabaseAdmin.from(
      "players",
    ) as PlayerMarketQuery)
      .select("npc_rotation_stock")
      .eq("id", playerId)
      .single();
    if (error) throw new Error("DB_ERROR:" + error.message);

    let stock = player?.npc_rotation_stock ?? { date: "", slots: [] };
    if (stock.date !== today) {
      stock = {
        date: today,
        slots: rotation.map((entry) => ({
          slotId: entry.slotId,
          itemId: entry.itemId,
          remaining: entry.stockPerPlayer,
        })),
      };
    }

    const slotStock = stock.slots.find((entry) => entry.slotId === slot.slotId);
    if (!slotStock || slotStock.remaining <= 0) {
      throw new Error("ROTATION_ITEM_SOLD_OUT:" + itemId);
    }
    if (quantity > slotStock.remaining) {
      throw new Error(
        `ROTATION_INSUFFICIENT_STOCK:${slotStock.remaining}:${quantity}`,
      );
    }

    slotStock.remaining -= quantity;
    const updateResult = await (supabaseAdmin.from(
      "players",
    ) as PlayerMarketQuery)
      .update({ npc_rotation_stock: stock })
      .eq("id", playerId);
    if (updateResult.error) {
      throw new Error("DB_ERROR:" + updateResult.error.message);
    }
  }

  const totalCost = price * quantity;
  await debitCoins(
    playerId,
    totalCost,
    "NPC_MARKET_PURCHASE",
    crypto.randomUUID(),
    { itemId, quantity },
  );
  await addItemToInventory(playerId, itemId, effectiveGrade, quantity);
  return { success: true, itemId, grade: effectiveGrade, quantity, totalCost };
}

/**
 * Handles HTTP requests for the NPC market Edge Function.
 * @param request - Incoming request with action and purchase fields in JSON.
 * @returns JSON response for rotation or purchase requests.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    if (body.action === "determineRotation") {
      const dateString = String(body.dateString ?? todayDateString());
      return Response.json(await determineNPCRotation(dateString));
    }
    const result = await buyFromNPCMarket(
      String(body.playerId ?? ""),
      String(body.itemId ?? ""),
      body.grade === undefined || body.grade === null
        ? null
        : String(body.grade),
      Number(body.quantity ?? 0),
    );
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

/**
 * Reads an item's configured base value for NPC rotation pricing.
 * @param itemId - Item config key.
 * @returns Positive integer base value.
 * @throws ITEM_BASE_VALUE_MISSING:{itemId} when no supported value field exists.
 */
async function getItemBaseValue(itemId: string): Promise<number> {
  const config = await getConfig(itemId) as Record<string, unknown>;
  // SPEC_AMBIGUITY: Task 8.1 references getItemBaseValue but no such helper or config shape exists; this reads baseValue first, then existing recipe-style baseGoldValue/goldValue/value/price fields.
  const value = config.baseValue ?? config.baseGoldValue ?? config.goldValue ??
    config.value ?? config.price;
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error("ITEM_BASE_VALUE_MISSING:" + itemId);
  }
  return Number(value);
}

/**
 * Returns today's UTC date string using integer unix-second time.
 * @returns ISO calendar date string.
 * @throws Never.
 */
function todayDateString(): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return new Date(nowSeconds * 1000).toISOString().slice(0, 10);
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
