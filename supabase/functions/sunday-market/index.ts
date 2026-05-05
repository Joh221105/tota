import { getConfig } from "../lib/config.ts";
import { creditCoins, debitCoins, validateCanAfford } from "../lib/economy.ts";
import {
  addItemToInventory,
  removeItemFromInventory,
} from "../lib/inventory.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";
import { addNeighbourhoodFeedEvent } from "../neighbourhood-feed/index.ts";

export interface SundayMarketStall {
  paidThisWeek: boolean;
  paidWeekId: string;
  stallSize: number;
}

export interface ListResult {
  success: true;
  listingId: string;
  stallSlotsUsed: number;
}

export interface BuyResult {
  success: true;
  itemId: string;
  grade: string;
  quantity: number;
  totalCost: number;
}

export interface ClosureResult {
  playersRefunded: number;
  itemsReturned: number;
}

export interface ListingsResult {
  listings: MarketListingRow[];
  totalListings: number;
}

export interface WishlistEntry {
  id: string;
  poster_id: string;
  item_id: string;
  grade: string;
  quantity_wanted: number;
  quantity_fulfilled: number;
  price_per_unit: number;
  posted_at?: string;
  expires_at: string;
}

export interface WishlistResult {
  wishlistId: string;
  expiresAt: string;
}

export interface FulfillResult {
  fulfilled: number;
  totalPaid: number;
  wishlistComplete: boolean;
}

export interface XpAwardCall {
  playerId: string;
  amount: number;
  source: string;
}

export interface NotificationCall {
  playerId: string;
  type: string;
  data: Record<string, unknown>;
}

interface PlayerStallRow {
  sunday_market_stall?: SundayMarketStall | null;
  wishlist_posts_today?: WishlistPostsToday | null;
}

interface WishlistPostsToday {
  count: number;
  date: string;
}

interface MarketListingRow {
  id: string;
  seller_id: string;
  item_id: string;
  grade: string;
  quantity: number;
  price_per_unit: number;
  listed_at?: string;
  week_id: string;
}

interface PlayerStallQuery {
  select(columns: string): PlayerStallQuery;
  eq(column: string, value: string): PlayerStallQuery;
  single(): Promise<
    { data: PlayerStallRow | null; error: { message: string } | null }
  >;
  update(values: Record<string, unknown>): PlayerStallQuery;
  then<
    TResult1 = {
      data: PlayerStallRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: PlayerStallRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface MarketListingQuery {
  select(
    columns: string,
    options?: { count?: "exact"; head?: boolean },
  ): MarketListingQuery;
  eq(column: string, value: string): MarketListingQuery;
  like(column: string, pattern: string): MarketListingQuery;
  order(
    column: string,
    options: { ascending: boolean },
  ): MarketListingQuery;
  maybeSingle(): Promise<
    { data: MarketListingRow | null; error: { message: string } | null }
  >;
  single(): Promise<
    {
      data: Partial<MarketListingRow> | null;
      error: { message: string } | null;
    }
  >;
  insert(values: Record<string, unknown>): MarketListingQuery;
  delete(): MarketListingQuery;
  then<
    TResult1 = {
      data: MarketListingRow[] | null;
      error: { message: string } | null;
      count?: number | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: MarketListingRow[] | null;
          error: { message: string } | null;
          count?: number | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface WishlistBoardQuery {
  select(columns: string): WishlistBoardQuery;
  eq(column: string, value: string): WishlistBoardQuery;
  gt(column: string, value: string): WishlistBoardQuery;
  maybeSingle(): Promise<
    { data: WishlistEntry | null; error: { message: string } | null }
  >;
  single(): Promise<
    { data: Partial<WishlistEntry> | null; error: { message: string } | null }
  >;
  insert(values: Record<string, unknown>): WishlistBoardQuery;
  update(values: Record<string, unknown>): WishlistBoardQuery;
  delete(): WishlistBoardQuery;
  then<
    TResult1 = {
      data: WishlistEntry[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: WishlistEntry[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

const xpAwardCalls: XpAwardCall[] = [];
const notificationCalls: NotificationCall[] = [];

/**
 * Returns whether the Sunday market is open at a unix timestamp.
 * @param currentTimestamp - Unix timestamp in seconds.
 * @returns True when the timestamp is Sunday in UTC.
 * @throws Never.
 */
export function isSundayMarketOpen(currentTimestamp: number): boolean {
  return new Date(currentTimestamp * 1000).getUTCDay() === 0;
}

/**
 * Computes an ISO week identifier in YYYY-WW format.
 * @param currentTimestamp - Optional unix timestamp in seconds; defaults to current server time.
 * @returns ISO week identifier.
 * @throws Never.
 */
export function getISOWeekId(currentTimestamp?: number): string {
  const seconds = currentTimestamp ?? Math.floor(Date.now() / 1000);
  const date = new Date(seconds * 1000);
  const utcDate = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((utcDate.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${utcDate.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

/**
 * Awards XP to a player.
 * STUB: replaced by Task 10.1.
 * @param playerId - Player receiving XP.
 * @param amount - XP amount.
 * @param source - XP source.
 * @returns Nothing.
 * @throws Never.
 */
export async function awardXP(
  playerId: string,
  amount: number,
  source: string,
): Promise<void> {
  await Promise.resolve();
  xpAwardCalls.push({ playerId, amount, source });
}

/**
 * Sends a notification to a player.
 * STUB: replaced by Task 12.1.
 * @param playerId - Player receiving the notification.
 * @param type - Notification type.
 * @param data - Notification payload.
 * @returns Nothing.
 * @throws Never.
 */
export async function sendNotification(
  playerId: string,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  await Promise.resolve();
  notificationCalls.push({ playerId, type, data });
}

/**
 * Returns recorded XP and notification stub calls for tests.
 * @returns Stub call records.
 * @throws Never.
 */
export function getSundayMarketStubCallsForTesting(): {
  xpAwards: XpAwardCall[];
  notifications: NotificationCall[];
} {
  return {
    xpAwards: [...xpAwardCalls],
    notifications: [...notificationCalls],
  };
}

/**
 * Clears Sunday market stub call records for tests.
 * @returns Nothing.
 * @throws Never.
 */
export function resetSundayMarketStubsForTesting(): void {
  xpAwardCalls.length = 0;
  notificationCalls.length = 0;
}

/**
 * Returns active Sunday market listings for the current week while the market is open.
 * @param playerId - Player requesting listings; unused in V1 filtering.
 * @param filters - Optional item type, grade, and sort filters.
 * @returns Matching listing rows and total count.
 * @throws DB_ERROR when the listing query fails.
 */
export async function getMarketListings(
  playerId: string,
  filters?: { itemType?: string; grade?: string; sortBy?: string },
): Promise<ListingsResult> {
  void playerId;
  const now = Math.floor(Date.now() / 1000);
  if (!isSundayMarketOpen(now)) return { listings: [], totalListings: 0 };

  let query = (supabaseAdmin.from("market_listings") as MarketListingQuery)
    .select("*")
    .eq("week_id", getISOWeekId(now));
  if (filters?.grade) query = query.eq("grade", filters.grade);
  if (filters?.itemType) query = query.like("item_id", filters.itemType + "%");
  if (filters?.sortBy === "price_asc") {
    query = query.order("price_per_unit", { ascending: true });
  } else if (filters?.sortBy === "price_desc") {
    query = query.order("price_per_unit", { ascending: false });
  } else {
    query = query.order("listed_at", { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw new Error("DB_ERROR:" + error.message);
  return { listings: data ?? [], totalListings: data?.length ?? 0 };
}

/**
 * Pays the player's Sunday market stall fee for the current ISO week.
 * The operation is idempotent for a player within the same week.
 * @param playerId - Player UUID.
 * @returns Whether the fee had already been paid and the fee charged now.
 * @throws INSUFFICIENT_FUNDS from debitCoins when the player cannot afford the fee.
 * @throws DB_ERROR when player stall reads or writes fail.
 */
export async function paySundayMarketFee(
  playerId: string,
): Promise<{ alreadyPaid: boolean; feeCharged: number }> {
  const weekId = getISOWeekId();
  const stall = await getSundayMarketStall(playerId);
  if (stall.paidThisWeek && stall.paidWeekId === weekId) {
    return { alreadyPaid: true, feeCharged: 0 };
  }

  const fee = await getConfig("SUNDAY_MARKET_FEE") as number;
  await debitCoins(
    playerId,
    fee,
    "SUNDAY_MARKET_STALL_FEE",
    crypto.randomUUID(),
    {},
  );
  stall.paidThisWeek = true;
  stall.paidWeekId = weekId;

  const updateResult = await (supabaseAdmin.from(
    "players",
  ) as PlayerStallQuery)
    .update({ sunday_market_stall: stall })
    .eq("id", playerId);
  if (updateResult.error) {
    throw new Error("DB_ERROR:" + updateResult.error.message);
  }

  return { alreadyPaid: false, feeCharged: fee };
}

/**
 * Reads the player's Sunday market stall state and resets stale weekly paid status.
 * @param playerId - Player UUID.
 * @returns Current stall state for this ISO week.
 * @throws DB_ERROR when player stall reads or writes fail.
 */
export async function getSundayMarketStall(
  playerId: string,
): Promise<SundayMarketStall> {
  const weekId = getISOWeekId();
  const { data, error } = await (supabaseAdmin.from(
    "players",
  ) as PlayerStallQuery)
    .select("sunday_market_stall")
    .eq("id", playerId)
    .single();
  if (error) throw new Error("DB_ERROR:" + error.message);

  const stall = await normalizeStall(data?.sunday_market_stall);
  const shouldPersistDefault = !data?.sunday_market_stall;
  const shouldResetStale = stall.paidThisWeek && stall.paidWeekId !== weekId;
  if (shouldResetStale) stall.paidThisWeek = false;

  if (shouldPersistDefault || shouldResetStale) {
    const updateResult = await (supabaseAdmin.from(
      "players",
    ) as PlayerStallQuery)
      .update({ sunday_market_stall: stall })
      .eq("id", playerId);
    if (updateResult.error) {
      throw new Error("DB_ERROR:" + updateResult.error.message);
    }
  }

  return stall;
}

/**
 * Lists a non-cooked inventory item in the player's Sunday market stall.
 * @param playerId - Seller player UUID.
 * @param itemId - Item ID to list.
 * @param grade - Item grade.
 * @param quantity - Quantity to list.
 * @param pricePerUnit - Listing price per unit in coins.
 * @returns Listing result with the new listing ID and used stall slots.
 * @throws MARKET_NOT_OPEN when current server time is not Sunday UTC.
 * @throws COOKED_DISHES_NOT_ALLOWED when itemId begins with dish_.
 * @throws STALL_FULL:{stallSize} when the player has no free stall slots.
 * @throws Helper errors from paySundayMarketFee, removeItemFromInventory, or Supabase writes.
 */
export async function listItemAtStall(
  playerId: string,
  itemId: string,
  grade: string,
  quantity: number,
  pricePerUnit: number,
): Promise<ListResult> {
  const now = Math.floor(Date.now() / 1000);
  if (!isSundayMarketOpen(now)) throw new Error("MARKET_NOT_OPEN");
  if (itemId.startsWith("dish_")) {
    throw new Error("COOKED_DISHES_NOT_ALLOWED");
  }
  // SPEC_AMBIGUITY: The prompt does not define validation errors for quantity or price, so helper/database validation is allowed to surface.

  await paySundayMarketFee(playerId);

  const weekId = getISOWeekId(now);
  const { data: player, error: playerError } = await (supabaseAdmin.from(
    "players",
  ) as PlayerStallQuery)
    .select("sunday_market_stall")
    .eq("id", playerId)
    .single();
  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  const stall = await normalizeStall(player?.sunday_market_stall);

  const { count, error: countError } = await (supabaseAdmin.from(
    "market_listings",
  ) as MarketListingQuery)
    .select("id", { count: "exact", head: true })
    .eq("seller_id", playerId)
    .eq("week_id", weekId);
  if (countError) throw new Error("DB_ERROR:" + countError.message);

  if ((count ?? 0) >= stall.stallSize) {
    throw new Error("STALL_FULL:" + stall.stallSize);
  }

  await removeItemFromInventory(playerId, itemId, grade, quantity);
  const { data: row, error: insertError } = await (supabaseAdmin.from(
    "market_listings",
  ) as MarketListingQuery)
    .insert({
      seller_id: playerId,
      item_id: itemId,
      grade,
      quantity,
      price_per_unit: pricePerUnit,
      week_id: weekId,
    })
    .select("id")
    .single();
  if (insertError) throw new Error("DB_ERROR:" + insertError.message);
  if (!row?.id) throw new Error("DB_ERROR:missing listing id");

  if (grade === "Legendary") {
    // SPEC_AMBIGUITY: Task 9.2 requires a neighbourhood feed event for Legendary listings but does not specify event type or payload; V1 uses LEGENDARY_MARKET_LISTING with listing and item details.
    await addNeighbourhoodFeedEvent(playerId, "LEGENDARY_MARKET_LISTING", {
      listingId: row.id,
      itemId,
      grade,
      quantity,
      pricePerUnit,
    });
  }

  return {
    success: true,
    listingId: row.id,
    stallSlotsUsed: (count ?? 0) + 1,
  };
}

/**
 * Buys an active Sunday market listing and transfers coins and inventory.
 * @param buyerPlayerId - Buyer player UUID.
 * @param listingId - Market listing UUID.
 * @returns Purchase result.
 * @throws MARKET_NOT_OPEN when current server time is not Sunday UTC.
 * @throws LISTING_NOT_FOUND when the listing does not exist.
 * @throws ITEM_SOLD_OUT_RACE_CONDITION when the listing disappears after buyer debit; buyer is refunded.
 * @throws Helper errors from debitCoins, creditCoins, addItemToInventory, or Supabase deletes.
 */
export async function buyFromMarket(
  buyerPlayerId: string,
  listingId: string,
): Promise<BuyResult> {
  const now = Math.floor(Date.now() / 1000);
  if (!isSundayMarketOpen(now)) throw new Error("MARKET_NOT_OPEN");

  const { data: listing, error: listingError } = await (supabaseAdmin.from(
    "market_listings",
  ) as MarketListingQuery)
    .select("*")
    .eq("id", listingId)
    .maybeSingle();
  if (listingError) throw new Error("DB_ERROR:" + listingError.message);
  if (!listing) throw new Error("LISTING_NOT_FOUND");

  const totalCost = listing.price_per_unit * listing.quantity;
  await debitCoins(
    buyerPlayerId,
    totalCost,
    "SUNDAY_MARKET_PURCHASE",
    crypto.randomUUID(),
    { listingId },
  );

  const { data: recheck, error: recheckError } = await (supabaseAdmin.from(
    "market_listings",
  ) as MarketListingQuery)
    .select("id")
    .eq("id", listingId)
    .maybeSingle();
  if (recheckError) throw new Error("DB_ERROR:" + recheckError.message);
  if (!recheck) {
    await creditCoins(
      buyerPlayerId,
      totalCost,
      "STEAL_REFUND_RACE_CONDITION",
      crypto.randomUUID(),
      { listingId },
    );
    throw new Error("ITEM_SOLD_OUT_RACE_CONDITION");
  }

  await creditCoins(
    listing.seller_id,
    totalCost,
    "SUNDAY_MARKET_SALE",
    crypto.randomUUID(),
    { listingId },
  );
  await addItemToInventory(
    buyerPlayerId,
    listing.item_id,
    listing.grade,
    listing.quantity,
  );

  const deleteResult = await (supabaseAdmin.from(
    "market_listings",
  ) as MarketListingQuery)
    .delete()
    .eq("id", listingId);
  if (deleteResult.error) {
    throw new Error("DB_ERROR:" + deleteResult.error.message);
  }

  return {
    success: true,
    itemId: listing.item_id,
    grade: listing.grade,
    quantity: listing.quantity,
    totalCost,
  };
}

/**
 * Closes the current Sunday market by returning unsold listings and clearing them.
 * Sellers with returned items have their weekly paid status reset.
 * @returns Number of sellers reset and listing rows returned.
 * @throws Helper errors from addItemToInventory or Supabase reads/writes/deletes.
 */
export async function closeSundayMarket(): Promise<ClosureResult> {
  const weekId = getISOWeekId();
  const { data: listings, error: listingsError } = await (supabaseAdmin.from(
    "market_listings",
  ) as MarketListingQuery)
    .select("*")
    .eq("week_id", weekId);
  if (listingsError) throw new Error("DB_ERROR:" + listingsError.message);

  let itemsReturned = 0;
  const sellers = new Set<string>();
  for (const listing of listings ?? []) {
    await addItemToInventory(
      listing.seller_id,
      listing.item_id,
      listing.grade,
      listing.quantity,
    );
    sellers.add(listing.seller_id);
    itemsReturned++;
  }

  const deleteResult = await (supabaseAdmin.from(
    "market_listings",
  ) as MarketListingQuery)
    .delete()
    .eq("week_id", weekId);
  if (deleteResult.error) {
    throw new Error("DB_ERROR:" + deleteResult.error.message);
  }

  for (const sellerId of sellers) {
    const { data: player, error } = await (supabaseAdmin.from(
      "players",
    ) as PlayerStallQuery)
      .select("sunday_market_stall")
      .eq("id", sellerId)
      .single();
    if (error) throw new Error("DB_ERROR:" + error.message);
    const stall = await normalizeStall(player?.sunday_market_stall);
    stall.paidThisWeek = false;
    const updateResult = await (supabaseAdmin.from(
      "players",
    ) as PlayerStallQuery)
      .update({ sunday_market_stall: stall })
      .eq("id", sellerId);
    if (updateResult.error) {
      throw new Error("DB_ERROR:" + updateResult.error.message);
    }
  }

  return { playersRefunded: sellers.size, itemsReturned };
}

/**
 * Posts a wishlist request for non-cooked items, limited to three posts per UTC day.
 * @param playerId - Wishlist poster player UUID.
 * @param itemId - Wanted item ID.
 * @param grade - Wanted item grade.
 * @param quantityWanted - Wanted quantity.
 * @param pricePerUnit - Offered price per unit in coins.
 * @returns Wishlist ID and expiry timestamp.
 * @throws COOKED_DISHES_NOT_ALLOWED when itemId begins with dish_.
 * @throws DAILY_LIMIT_REACHED when the player has already posted three wishlists today.
 * @throws DB_ERROR when wishlist or player writes fail.
 */
export async function postWishlist(
  playerId: string,
  itemId: string,
  grade: string,
  quantityWanted: number,
  pricePerUnit: number,
): Promise<WishlistResult> {
  if (itemId.startsWith("dish_")) {
    throw new Error("COOKED_DISHES_NOT_ALLOWED");
  }
  // SPEC_AMBIGUITY: The prompt does not define validation errors for wishlist quantity or price, so database/helper validation is allowed to surface.
  const now = Math.floor(Date.now() / 1000);
  const today = new Date(now * 1000).toISOString().slice(0, 10);
  const { data: player, error: playerError } = await (supabaseAdmin.from(
    "players",
  ) as PlayerStallQuery)
    .select("wishlist_posts_today")
    .eq("id", playerId)
    .single();
  if (playerError) throw new Error("DB_ERROR:" + playerError.message);

  const wpt = normalizeWishlistPostsToday(player?.wishlist_posts_today);
  if (wpt.date !== today) wpt.count = 0;
  if (wpt.count >= 3) throw new Error("DAILY_LIMIT_REACHED");

  const { data: entry, error: insertError } = await (supabaseAdmin.from(
    "wishlist_board",
  ) as WishlistBoardQuery)
    .insert({
      poster_id: playerId,
      item_id: itemId,
      grade,
      quantity_wanted: quantityWanted,
      price_per_unit: pricePerUnit,
      expires_at: new Date((now + 86_400) * 1000).toISOString(),
    })
    .select("id,expires_at")
    .single();
  if (insertError) throw new Error("DB_ERROR:" + insertError.message);
  if (!entry?.id || !entry.expires_at) {
    throw new Error("DB_ERROR:missing wishlist id");
  }

  wpt.count += 1;
  wpt.date = today;
  const updateResult = await (supabaseAdmin.from(
    "players",
  ) as PlayerStallQuery)
    .update({ wishlist_posts_today: wpt })
    .eq("id", playerId);
  if (updateResult.error) {
    throw new Error("DB_ERROR:" + updateResult.error.message);
  }

  return { wishlistId: entry.id, expiresAt: entry.expires_at };
}

/**
 * Returns currently active, unexpired wishlist board entries.
 * @returns Active wishlist rows.
 * @throws DB_ERROR when the wishlist query fails.
 */
export async function getActiveWishlists(): Promise<WishlistEntry[]> {
  const nowIso = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
  const { data, error } = await (supabaseAdmin.from(
    "wishlist_board",
  ) as WishlistBoardQuery)
    .select("*")
    .gt("expires_at", nowIso);
  if (error) throw new Error("DB_ERROR:" + error.message);
  return data ?? [];
}

/**
 * Fulfills all or part of a wishlist by transferring seller inventory to the poster for coins.
 * @param sellerPlayerId - Seller fulfilling the request.
 * @param wishlistId - Wishlist board entry ID.
 * @param quantity - Maximum quantity to fulfill.
 * @returns Fulfillment result.
 * @throws WISHLIST_NOT_FOUND when the wishlist entry does not exist.
 * @throws WISHLIST_EXPIRED when the entry has expired.
 * @throws WISHLIST_ALREADY_FULFILLED when no quantity remains.
 * @throws Helper errors from economy and inventory helpers.
 */
export async function fulfillWishlist(
  sellerPlayerId: string,
  wishlistId: string,
  quantity: number,
): Promise<FulfillResult> {
  const { data: entry, error: entryError } = await (supabaseAdmin.from(
    "wishlist_board",
  ) as WishlistBoardQuery)
    .select("*")
    .eq("id", wishlistId)
    .maybeSingle();
  if (entryError) throw new Error("DB_ERROR:" + entryError.message);
  if (!entry) throw new Error("WISHLIST_NOT_FOUND");
  if (
    new Date(entry.expires_at) < new Date(Math.floor(Date.now() / 1000) * 1000)
  ) {
    throw new Error("WISHLIST_EXPIRED");
  }

  const remaining = entry.quantity_wanted - entry.quantity_fulfilled;
  if (remaining <= 0) throw new Error("WISHLIST_ALREADY_FULFILLED");
  const actual = Math.min(quantity, remaining);
  const totalPayment = entry.price_per_unit * actual;

  await validateCanAfford(entry.poster_id, totalPayment);
  await removeItemFromInventory(
    sellerPlayerId,
    entry.item_id,
    entry.grade,
    actual,
  );
  await debitCoins(
    entry.poster_id,
    totalPayment,
    "WISHLIST_FULFILLMENT_BUYER",
    crypto.randomUUID(),
    { wishlistId },
  );
  await creditCoins(
    sellerPlayerId,
    totalPayment,
    "WISHLIST_FULFILLMENT_SELLER",
    crypto.randomUUID(),
    { wishlistId },
  );
  await addItemToInventory(entry.poster_id, entry.item_id, entry.grade, actual);

  const newFulfilled = entry.quantity_fulfilled + actual;
  if (newFulfilled >= entry.quantity_wanted) {
    const deleteResult = await (supabaseAdmin.from(
      "wishlist_board",
    ) as WishlistBoardQuery)
      .delete()
      .eq("id", wishlistId);
    if (deleteResult.error) {
      throw new Error("DB_ERROR:" + deleteResult.error.message);
    }
  } else {
    const updateResult = await (supabaseAdmin.from(
      "wishlist_board",
    ) as WishlistBoardQuery)
      .update({ quantity_fulfilled: newFulfilled })
      .eq("id", wishlistId);
    if (updateResult.error) {
      throw new Error("DB_ERROR:" + updateResult.error.message);
    }
  }

  await awardXP(sellerPlayerId, 15, "FULFILL_WISHLIST");
  await sendNotification(entry.poster_id, "WISHLIST_FULFILLED", {
    quantity: actual,
    totalPaid: totalPayment,
  });

  return {
    fulfilled: actual,
    totalPaid: totalPayment,
    wishlistComplete: newFulfilled >= entry.quantity_wanted,
  };
}

/**
 * Handles HTTP requests for the Sunday market Edge Function.
 * @param request - Incoming request with an action field and action-specific JSON.
 * @returns JSON response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const action = String(body.action ?? "");
    if (action === "listings") {
      return Response.json(
        await getMarketListings(
          String(body.playerId ?? ""),
          body.filters as
            | { itemType?: string; grade?: string; sortBy?: string }
            | undefined,
        ),
      );
    }
    if (action === "payFee") {
      return Response.json(
        await paySundayMarketFee(String(body.playerId ?? "")),
      );
    }
    if (action === "list") {
      return Response.json(
        await listItemAtStall(
          String(body.playerId ?? ""),
          String(body.itemId ?? ""),
          String(body.grade ?? ""),
          Number(body.quantity ?? 0),
          Number(body.pricePerUnit ?? 0),
        ),
      );
    }
    if (action === "buy") {
      return Response.json(
        await buyFromMarket(
          String(body.buyerPlayerId ?? ""),
          String(body.listingId ?? ""),
        ),
      );
    }
    if (action === "postWishlist") {
      return Response.json(
        await postWishlist(
          String(body.playerId ?? ""),
          String(body.itemId ?? ""),
          String(body.grade ?? ""),
          Number(body.quantityWanted ?? 0),
          Number(body.pricePerUnit ?? 0),
        ),
      );
    }
    if (action === "activeWishlists") {
      return Response.json(await getActiveWishlists());
    }
    if (action === "fulfillWishlist") {
      return Response.json(
        await fulfillWishlist(
          String(body.sellerPlayerId ?? ""),
          String(body.wishlistId ?? ""),
          Number(body.quantity ?? 0),
        ),
      );
    }
    if (action === "close") return Response.json(await closeSundayMarket());
    throw new Error("INVALID_ACTION");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

/**
 * Normalizes stored or missing stall JSON into the current shape.
 * @param stall - Stored stall JSON, if any.
 * @returns Stall JSON with defaults filled.
 * @throws CONFIG_KEY_NOT_FOUND:SUNDAY_MARKET_INITIAL_SIZE when a missing stall needs the initial size config.
 */
async function normalizeStall(
  stall: SundayMarketStall | null | undefined,
): Promise<SundayMarketStall> {
  const initialSize = await getConfig("SUNDAY_MARKET_INITIAL_SIZE") as number;
  if (stall) {
    return {
      paidThisWeek: Boolean(stall.paidThisWeek),
      paidWeekId: String(stall.paidWeekId ?? ""),
      stallSize: Number(stall.stallSize ?? initialSize),
    };
  }
  return { paidThisWeek: false, paidWeekId: "", stallSize: initialSize };
}

/**
 * Normalizes stored or missing per-day wishlist post counters.
 * @param value - Stored counter JSON.
 * @returns Counter with count and date fields.
 * @throws Never.
 */
function normalizeWishlistPostsToday(
  value: WishlistPostsToday | null | undefined,
): WishlistPostsToday {
  return {
    count: Number(value?.count ?? 0),
    date: String(value?.date ?? ""),
  };
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
