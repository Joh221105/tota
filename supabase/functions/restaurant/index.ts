import { getConfig, getConfigs } from "../lib/config.ts";
import { creditCoins, debitCoins } from "../lib/economy.ts";
import {
  addItemToInventory,
  removeItemFromInventory,
} from "../lib/inventory.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export interface MenuListing {
  dishId: string;
  grade: string;
  quantity: number;
  listedAt: number;
}

export interface RestaurantJson {
  tier: number;
  listings: MenuListing[];
  staff: RestaurantStaffMap | RestaurantStaffMember[];
  lastCollectionTimestamp: number;
  openedAt: number;
  menuLastChangedAt: number;
  reputation: number;
  decorScore: number;
  xpAwardedDate?: string;
}

export interface RestaurantStaffMember {
  role?: string;
  type?: string;
  staffType?: string;
  tier?: number;
  level?: number;
  hiredAt?: number;
}

export interface StaffRecord {
  staffType: string;
  tier: number;
  hiredAt?: number;
}

export type RestaurantStaffMap = Record<string, StaffRecord>;

export interface StaffTierConfig {
  t: number;
  bonus?: string;
  revMult?: number;
  custMult?: number;
  repDecayReduce?: number;
  repGainMult?: number;
  preventsDecorDecay?: boolean;
  passiveDecorGain?: number;
  stealReduc?: number;
  alerts?: boolean;
  special?: string;
  upgCost?: number;
}

export interface StaffConfig {
  hireCost: number;
  tiers: StaffTierConfig[];
}

export interface ListResult {
  success: true;
  listing: MenuListing;
}

export interface UnlistResult {
  success: true;
  quantityReturned: number;
}

export interface RestaurantState {
  tier: number;
  listings: MenuListing[];
  staff: RestaurantStaffMap | RestaurantStaffMember[];
  decorScore: number;
  reputation: number;
  currentMultiplier: number;
  menuSlotsUsed: number;
  menuSlotMax: number;
}

export interface EarningsBreakdownItem {
  dishId: string;
  grade: string;
  sold: number;
  revenue: number;
}

export interface EarningsResult {
  totalRevenue: number;
  breakdown: EarningsBreakdownItem[];
  multipliersApplied: {
    time: number;
    favoured: string[];
  };
}

export interface StaffBonuses {
  headChefRevenueMult: number;
  maitreDCustomerMult: number;
  guardStealReduction: number;
  guardAlertsOnSteal: boolean;
  hasPromoter: boolean;
  promoterTier: number;
  hasCleaner: boolean;
}

export interface HireResult {
  success: true;
  staffType: string;
  tier: number;
  hireCost: number;
}

export interface UpgradeResult {
  success: true;
  staffType: string;
  newTier: number;
  upgradeCost: number;
}

interface PlayerRestaurantRow {
  restaurant: RestaurantJson;
}

interface RestaurantQuery {
  select(columns: string): RestaurantQuery;
  eq(column: string, value: string): RestaurantQuery;
  single(): Promise<
    { data: PlayerRestaurantRow | null; error: { message: string } | null }
  >;
  update(values: Record<string, unknown>): RestaurantQuery;
  then<
    TResult1 = {
      data: PlayerRestaurantRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: PlayerRestaurantRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

/**
 * Calculates the active restaurant time multiplier from opening and menu-change timestamps.
 * @param restaurant - Restaurant timestamps used for multiplier buildup.
 * @param currentTimestamp - Current unix timestamp in seconds.
 * @param multiplierMax - Maximum multiplier loaded from game_config.
 * @param buildupSeconds - Seconds required to reach the maximum multiplier.
 * @returns Multiplier rounded to two decimal places.
 * @throws Never.
 */
export function calculateTimeMultiplier(
  restaurant: { openedAt: number; menuLastChangedAt: number },
  currentTimestamp: number,
  multiplierMax: number,
  buildupSeconds: number,
): number {
  const effectiveOpenTime = Math.max(
    restaurant.openedAt,
    restaurant.menuLastChangedAt,
  );
  const elapsed = currentTimestamp - effectiveOpenTime;
  const progress = Math.min(1.0, elapsed / buildupSeconds);
  const multiplier = 1.0 + (progress * (multiplierMax - 1.0));
  return Math.round(multiplier * 100) / 100;
}

/**
 * Returns deterministic favoured dish categories for a UTC date string.
 * @param dateString - UTC date in YYYY-MM-DD format.
 * @returns One or two favoured category IDs.
 * @throws Never.
 */
export function getFavouredDish(dateString: string): string[] {
  let hash = 7;
  for (let i = 0; i < dateString.length; i++) {
    hash = hash * 31 + dateString.charCodeAt(i) + i;
  }
  hash = Math.abs(hash);

  const categories = [
    "burger",
    "seafood_burger",
    "side_dish",
    "burger",
    "burger",
  ];
  const primary = categories[hash % categories.length];

  if (hash % 7 === 0) {
    const secondary = categories[(hash + 3) % categories.length];
    if (secondary !== primary) return [primary, secondary];
  }
  return [primary];
}

/**
 * Returns the V1 restaurant category for a dish item ID.
 * // SPEC_AMBIGUITY: Task 5.2 maps side_dish to dish_onion_rings_dish, while Task 4.2 cooking output and demand config use dish_onion_rings.
 * @param dishId - Dish item ID.
 * @returns Dish category, or unknown for unmapped dishes.
 * @throws Never.
 */
export function getDishCategory(dishId: string): string {
  if (
    [
      "dish_classic_burger",
      "dish_cheeseburger",
      "dish_egg_burger",
      "dish_bacon_burger",
      "dish_spicy_burger",
    ].includes(dishId)
  ) return "burger";
  if (
    [
      "dish_fish_fillet",
      "dish_shrimp_burger",
      "dish_crab_burger",
      "dish_tuna_melt",
    ].includes(dishId)
  ) return "seafood_burger";
  if (
    [
      "dish_fries",
      "dish_onion_rings",
      "dish_onion_rings_dish",
      "dish_strawberry_milkshake",
    ].includes(dishId)
  ) return "side_dish";
  return "unknown";
}

/**
 * Calculates restaurant staff bonuses from staff records.
 * PURE FUNCTION - zero DB calls.
 * // SPEC_AMBIGUITY: Task 5.2 accepted unspecified staff JSON while Task 5.3 defines Record<staffType, StaffRecord>; this function tolerates legacy array-shaped staff but emits 5.3 bonuses.
 * @param staff - Staff records keyed by staff type.
 * @returns Staff bonus multipliers and flags.
 * @throws Never.
 */
export function calculateStaffBonuses(
  staff: RestaurantStaffMap | RestaurantStaffMember[] = {},
): StaffBonuses {
  const staffMap = normalizeStaffMap(staff);
  const out: StaffBonuses = {
    headChefRevenueMult: 1.0,
    maitreDCustomerMult: 1.0,
    guardStealReduction: 0,
    guardAlertsOnSteal: false,
    hasPromoter: false,
    promoterTier: 0,
    hasCleaner: false,
  };

  const headChef = staffMap.head_chef;
  if (headChef) {
    out.headChefRevenueMult = headChef.tier === 1
      ? 1.15
      : headChef.tier === 2
      ? 1.25
      : 1.40;
  }

  const maitreD = staffMap.maitre_d;
  if (maitreD) out.maitreDCustomerMult = 1.20;

  const guard = staffMap.guard;
  if (guard) {
    out.guardStealReduction = guard.tier === 1 ? 0.30 : 0.50;
    out.guardAlertsOnSteal = guard.tier >= 2;
  }

  const promoter = staffMap.promoter;
  if (promoter) {
    out.hasPromoter = true;
    out.promoterTier = promoter.tier;
  }

  if (staffMap.cleaner) out.hasCleaner = true;
  return out;
}

/**
 * Lists cooked dishes on the player's restaurant menu.
 * // SPEC_AMBIGUITY: removeItemFromInventory reports short stacks as INSUFFICIENT_QUANTITY:{have}:{requested}, while Task 5.1 expects the exact bare error INSUFFICIENT_QUANTITY for listing more than owned.
 * @param playerId - Player whose restaurant menu is being updated.
 * @param dishId - Cooked dish item ID, which must start with dish_.
 * @param grade - Dish grade being listed.
 * @param quantity - Quantity to list.
 * @returns Listing result with the new or updated menu listing.
 * @throws INVALID_DISH_ID:{dishId} when the item ID is not a dish.
 * @throws MENU_FULL:{limit} when a new dish type would exceed tier slots.
 * @throws INSUFFICIENT_QUANTITY when inventory has a short stack.
 * @throws DB_ERROR when restaurant reads or writes fail.
 */
export async function listDishOnMenu(
  playerId: string,
  dishId: string,
  grade: string,
  quantity: number,
): Promise<ListResult> {
  if (!dishId.startsWith("dish_")) {
    throw new Error("INVALID_DISH_ID:" + dishId);
  }

  const restaurant = await loadRestaurant(playerId);
  const slotLimits = await getConfig("RESTAURANT_TIER_SLOT_LIMITS") as Record<
    string,
    number
  >;
  const menuSlotLimit = slotLimits[String(restaurant.tier)];
  const activeDishTypes = countActiveDishTypes(restaurant.listings);
  const existing = restaurant.listings.find((listing) =>
    listing.dishId === dishId && listing.grade === grade
  );

  if (!existing && activeDishTypes >= menuSlotLimit) {
    throw new Error("MENU_FULL:" + menuSlotLimit);
  }

  try {
    await removeItemFromInventory(playerId, dishId, grade, quantity);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("INSUFFICIENT_QUANTITY")) {
      throw new Error("INSUFFICIENT_QUANTITY");
    }
    throw error;
  }

  const now = Math.floor(Date.now() / 1000);
  let listing: MenuListing;
  if (existing) {
    existing.quantity += quantity;
    listing = existing;
  } else {
    listing = { dishId, grade, quantity, listedAt: now };
    restaurant.listings.push(listing);
  }
  restaurant.menuLastChangedAt = now;

  await saveRestaurant(playerId, restaurant);
  return { success: true, listing };
}

/**
 * Removes a dish listing from the menu and returns its quantity to inventory.
 * @param playerId - Player whose restaurant menu is being updated.
 * @param dishId - Listed dish item ID.
 * @param grade - Listed dish grade.
 * @returns Unlist result with quantity returned to inventory.
 * @throws LISTING_NOT_FOUND:{dishId}:{grade} when the listing is absent.
 * @throws DB_ERROR when restaurant reads or writes fail.
 */
export async function unlistDishFromMenu(
  playerId: string,
  dishId: string,
  grade: string,
): Promise<UnlistResult> {
  const restaurant = await loadRestaurant(playerId);
  const idx = restaurant.listings.findIndex((listing) =>
    listing.dishId === dishId && listing.grade === grade
  );
  if (idx === -1) throw new Error("LISTING_NOT_FOUND:" + dishId + ":" + grade);

  const listing = restaurant.listings[idx];
  await addItemToInventory(playerId, dishId, grade, listing.quantity);
  restaurant.listings.splice(idx, 1);
  restaurant.menuLastChangedAt = Math.floor(Date.now() / 1000);
  await saveRestaurant(playerId, restaurant);

  return { success: true, quantityReturned: listing.quantity };
}

/**
 * Returns current restaurant state enriched with menu slots and time multiplier.
 * @param playerId - Player whose restaurant state is requested.
 * @returns Restaurant state for the client.
 * @throws DB_ERROR when restaurant reads fail.
 * @throws CONFIG_KEY_NOT_FOUND when restaurant configs are missing.
 */
export async function getRestaurantState(
  playerId: string,
): Promise<RestaurantState> {
  const restaurant = await loadRestaurant(playerId);
  const cfg = await getConfigs([
    "RESTAURANT_MULTIPLIER_MAX",
    "RESTAURANT_MULTIPLIER_BUILDUP_SECONDS",
    "RESTAURANT_TIER_SLOT_LIMITS",
  ]);
  const now = Math.floor(Date.now() / 1000);
  const multiplier = calculateTimeMultiplier(
    restaurant,
    now,
    Number(cfg["RESTAURANT_MULTIPLIER_MAX"]),
    Number(cfg["RESTAURANT_MULTIPLIER_BUILDUP_SECONDS"]),
  );
  const slotLimits = cfg["RESTAURANT_TIER_SLOT_LIMITS"] as Record<
    string,
    number
  >;

  return {
    tier: restaurant.tier,
    listings: restaurant.listings,
    staff: restaurant.staff,
    decorScore: restaurant.decorScore,
    reputation: restaurant.reputation,
    currentMultiplier: multiplier,
    menuSlotsUsed: countActiveDishTypes(restaurant.listings),
    menuSlotMax: slotLimits[String(restaurant.tier)],
  };
}

/**
 * Hires a restaurant staff member and stores the staff record in players.restaurant.
 * @param playerId - Player hiring staff.
 * @param staffType - Staff type identifier, such as head_chef.
 * @returns Hire result with tier and cost.
 * @throws INVALID_STAFF_TYPE:{staffType} when no staff config exists.
 * @throws STAFF_ALREADY_HIRED:{staffType} when this staff type is already hired.
 * @throws INVALID_AMOUNT, INVALID_TRANSACTION_TYPE, INVALID_IDEMPOTENCY_KEY, INSUFFICIENT_FUNDS, PLAYER_NOT_FOUND, or DB_ERROR from debitCoins.
 */
export async function hireStaff(
  playerId: string,
  staffType: string,
): Promise<HireResult> {
  const config = await getStaffConfig(staffType, true);
  const restaurant = await loadRestaurant(playerId);
  const staff = normalizeStaffMap(restaurant.staff ?? {});
  if (staff[staffType]) throw new Error("STAFF_ALREADY_HIRED:" + staffType);

  await debitCoins(
    playerId,
    config.hireCost,
    "STAFF_HIRE",
    crypto.randomUUID(),
    { staffType },
  );

  const now = Math.floor(Date.now() / 1000);
  staff[staffType] = { staffType, tier: 1, hiredAt: now };
  restaurant.staff = staff;
  await saveRestaurant(playerId, restaurant);

  return { success: true, staffType, tier: 1, hireCost: config.hireCost };
}

/**
 * Upgrades a hired restaurant staff member by one tier.
 * @param playerId - Player upgrading staff.
 * @param staffType - Staff type identifier.
 * @returns Upgrade result with new tier and cost.
 * @throws STAFF_NOT_HIRED:{staffType} when the staff member is absent.
 * @throws STAFF_AT_MAX_TIER:{staffType} when no higher tier exists.
 * @throws CONFIG_KEY_NOT_FOUND when staff config is missing after hire.
 * @throws INVALID_AMOUNT, INVALID_TRANSACTION_TYPE, INVALID_IDEMPOTENCY_KEY, INSUFFICIENT_FUNDS, PLAYER_NOT_FOUND, or DB_ERROR from debitCoins.
 */
export async function upgradeStaff(
  playerId: string,
  staffType: string,
): Promise<UpgradeResult> {
  const restaurant = await loadRestaurant(playerId);
  const staff = normalizeStaffMap(restaurant.staff ?? {});
  const record = staff[staffType];
  if (!record) throw new Error("STAFF_NOT_HIRED:" + staffType);

  const config = await getStaffConfig(staffType, false);
  const currentTier = record.tier;
  if (currentTier >= config.tiers.length) {
    throw new Error("STAFF_AT_MAX_TIER:" + staffType);
  }
  const nextTier = config.tiers[currentTier];
  const upgradeCost = Number(nextTier.upgCost);

  await debitCoins(
    playerId,
    upgradeCost,
    "STAFF_UPGRADE",
    crypto.randomUUID(),
    { staffType, newTier: currentTier + 1 },
  );

  record.tier = currentTier + 1;
  restaurant.staff = staff;
  await saveRestaurant(playerId, restaurant);

  return {
    success: true,
    staffType,
    newTier: currentTier + 1,
    upgradeCost,
  };
}

/**
 * Collects restaurant earnings, credits coins through the economy helper, and advances restaurant state.
 * // SPEC_AMBIGUITY: Task 5.2 recipe pseudocode reads baseGoldValue, but existing cooking recipe configs use goldValue; this supports baseGoldValue first and falls back to goldValue.
 * @param playerId - Player collecting restaurant earnings.
 * @returns Earnings result with total revenue, per-listing breakdown, and applied multipliers.
 * @throws DB_ERROR when restaurant reads or writes fail.
 * @throws CONFIG_KEY_NOT_FOUND when required configs are missing.
 */
export async function collectRestaurantEarnings(
  playerId: string,
): Promise<EarningsResult> {
  const restaurant = await loadRestaurant(playerId);
  const now = Math.floor(Date.now() / 1000);
  const offlineCap = await getConfig("OFFLINE_CAP_SECONDS") as number;
  const elapsed = Math.max(
    0,
    Math.min(now - restaurant.lastCollectionTimestamp, Number(offlineCap)),
  );

  const cfg = await getConfigs([
    "RESTAURANT_MULTIPLIER_MAX",
    "RESTAURANT_MULTIPLIER_BUILDUP_SECONDS",
    "RESTAURANT_BASE_CUSTOMERS_RATE",
    "DISH_DEMAND_WEIGHT",
    "FAVOURED_DISH_BONUS",
  ]);
  const multiplier = calculateTimeMultiplier(
    restaurant,
    now,
    Number(cfg["RESTAURANT_MULTIPLIER_MAX"]),
    Number(cfg["RESTAURANT_MULTIPLIER_BUILDUP_SECONDS"]),
  );

  const todayUTC = new Date(now * 1000).toISOString().slice(0, 10);
  const favouredCategories = getFavouredDish(todayUTC);
  const staffBonuses = calculateStaffBonuses(restaurant.staff ?? []);
  const decorMult = 1 + (restaurant.decorScore / 1000);
  const baseRates = cfg["RESTAURANT_BASE_CUSTOMERS_RATE"] as Record<
    string,
    number
  >;
  const demandWeights = cfg["DISH_DEMAND_WEIGHT"] as Record<string, number>;
  const favouredBonus = Number(cfg["FAVOURED_DISH_BONUS"]);
  const customersServed = Math.floor(
    Number(baseRates[String(restaurant.tier)] ?? 0) *
      staffBonuses.maitreDCustomerMult * elapsed,
  );

  let totalRevenue = 0;
  const breakdown: EarningsBreakdownItem[] = [];
  for (const listing of restaurant.listings) {
    const recipe = await getDishRecipe(listing.dishId);
    const gradeMult = GRADE_MULT[listing.grade] ?? 1;
    const category = getDishCategory(listing.dishId);
    const favouredMult = favouredCategories.includes(category)
      ? favouredBonus
      : 1;
    const revenuePerUnit = Math.floor(
      getRecipeBaseGoldValue(recipe) * gradeMult * favouredMult * multiplier *
        staffBonuses.headChefRevenueMult * decorMult,
    );
    const demand = Number(demandWeights[listing.dishId] ?? 0.05);
    const sold = Math.min(
      listing.quantity,
      Math.floor(customersServed * demand),
    );
    listing.quantity -= sold;
    const listingRevenue = revenuePerUnit * sold;
    totalRevenue += listingRevenue;
    breakdown.push({
      dishId: listing.dishId,
      grade: listing.grade,
      sold,
      revenue: listingRevenue,
    });
  }

  restaurant.listings = restaurant.listings.filter((listing) =>
    listing.quantity > 0
  );
  if (totalRevenue > 0) {
    await creditCoins(
      playerId,
      totalRevenue,
      "RESTAURANT_EARNINGS",
      crypto.randomUUID(),
      { breakdown },
    );
  }

  if (restaurant.xpAwardedDate !== todayUTC) {
    await awardXP(playerId, 50, "RESTAURANT_DAY");
    await awardSkillXP(playerId, "commerce", 50);
    restaurant.xpAwardedDate = todayUTC;
  }

  restaurant.lastCollectionTimestamp = now;
  await saveRestaurant(playerId, restaurant);
  return {
    totalRevenue,
    breakdown,
    multipliersApplied: { time: multiplier, favoured: favouredCategories },
  };
}

/**
 * Handles HTTP requests for the restaurant Edge Function.
 * @param request - Incoming Edge Function request with action-specific JSON.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const action = String(body.action ?? "");
    const playerId = String(body.playerId ?? "");
    let result:
      | ListResult
      | UnlistResult
      | RestaurantState
      | EarningsResult
      | HireResult
      | UpgradeResult;

    if (action === "list") {
      result = await listDishOnMenu(
        playerId,
        String(body.dishId ?? ""),
        String(body.grade ?? ""),
        Number(body.quantity ?? 0),
      );
    } else if (action === "unlist") {
      result = await unlistDishFromMenu(
        playerId,
        String(body.dishId ?? ""),
        String(body.grade ?? ""),
      );
    } else if (action === "collect") {
      result = await collectRestaurantEarnings(playerId);
    } else if (action === "hire_staff") {
      result = await hireStaff(playerId, String(body.staffType ?? ""));
    } else if (action === "upgrade_staff") {
      result = await upgradeStaff(playerId, String(body.staffType ?? ""));
    } else {
      result = await getRestaurantState(playerId);
    }

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

/**
 * Loads the restaurant JSONB state for a player.
 * @param playerId - Player ID.
 * @returns Restaurant JSON state.
 * @throws DB_ERROR when the player query fails or no player is found.
 */
async function loadRestaurant(playerId: string): Promise<RestaurantJson> {
  const { data: player, error } =
    await (supabaseAdmin.from("players") as RestaurantQuery)
      .select("restaurant")
      .eq("id", playerId)
      .single();

  if (error) throw new Error("DB_ERROR:" + error.message);
  if (!player) throw new Error("DB_ERROR:missing player");
  return player.restaurant;
}

/**
 * Persists the restaurant JSONB state for a player.
 * @param playerId - Player ID.
 * @param restaurant - Updated restaurant JSON state.
 * @returns Nothing.
 * @throws DB_ERROR when the update fails.
 */
async function saveRestaurant(
  playerId: string,
  restaurant: RestaurantJson,
): Promise<void> {
  const { error } = await (supabaseAdmin.from("players") as RestaurantQuery)
    .update({ restaurant })
    .eq("id", playerId);
  if (error) throw new Error("DB_ERROR:" + error.message);
}

/**
 * Counts unique dish IDs currently listed on the menu.
 * @param listings - Menu listings.
 * @returns Count of unique dish IDs.
 * @throws Never.
 */
function countActiveDishTypes(listings: MenuListing[]): number {
  return new Set(listings.map((listing) => listing.dishId)).size;
}

export interface RestaurantRecipeValue {
  baseGoldValue?: number;
  goldValue?: number;
}

export interface XpAwardCall {
  playerId: string;
  amount: number;
  source: string;
}

export interface SkillXpAwardCall {
  playerId: string;
  skillTrack: string;
  amount: number;
}

const GRADE_MULT: Record<string, number> = {
  Normal: 1,
  Bronze: 1.25,
  Silver: 1.5,
  Gold: 2,
  Diamond: 3,
  Legendary: 5,
};
const DISH_TO_RECIPE: Record<string, string> = {
  dish_classic_burger: "recipe_classic_burger",
  dish_cheeseburger: "recipe_cheeseburger",
  dish_egg_burger: "recipe_egg_burger",
  dish_bacon_burger: "recipe_bacon_burger",
  dish_fish_fillet: "recipe_fish_fillet",
  dish_spicy_burger: "recipe_spicy_burger",
  dish_shrimp_burger: "recipe_shrimp_burger",
  dish_crab_burger: "recipe_crab_burger",
  dish_tuna_melt: "recipe_tuna_melt",
  dish_fries: "recipe_fries_dish",
  dish_onion_rings: "recipe_onion_rings_dish",
  dish_onion_rings_dish: "recipe_onion_rings_dish",
  dish_strawberry_milkshake: "recipe_strawberry_milkshake",
};
const xpAwardCalls: XpAwardCall[] = [];
const skillXpAwardCalls: SkillXpAwardCall[] = [];

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
 * Awards commerce skill XP to a player.
 * STUB: replaced by Task 10.2.
 * @param playerId - Player receiving skill XP.
 * @param skillTrack - Skill track to award.
 * @param amount - XP amount.
 * @returns Nothing.
 * @throws Never.
 */
export async function awardSkillXP(
  playerId: string,
  skillTrack: string,
  amount: number,
): Promise<void> {
  await Promise.resolve();
  skillXpAwardCalls.push({ playerId, skillTrack, amount });
}

/**
 * Resets V1 restaurant stub call records for tests.
 * @returns Nothing.
 * @throws Never.
 */
export function resetRestaurantStubsForTesting(): void {
  xpAwardCalls.length = 0;
  skillXpAwardCalls.length = 0;
}

/**
 * Returns V1 restaurant stub call records for tests.
 * @returns Copies of XP and skill XP calls.
 * @throws Never.
 */
export function getRestaurantStubCallsForTesting(): {
  xpAwards: XpAwardCall[];
  skillXpAwards: SkillXpAwardCall[];
} {
  return {
    xpAwards: [...xpAwardCalls],
    skillXpAwards: [...skillXpAwardCalls],
  };
}

/**
 * Fetches a dish recipe config for restaurant revenue calculations.
 * @param dishId - Dish item ID.
 * @returns Recipe value from game_config.
 * @throws CONFIG_KEY_NOT_FOUND when the recipe config is missing.
 */
async function getDishRecipe(dishId: string): Promise<RestaurantRecipeValue> {
  const recipeId = DISH_TO_RECIPE[dishId] ?? dishId.replace("dish_", "recipe_");
  return await getConfig(recipeId) as RestaurantRecipeValue;
}

/**
 * Returns the configured base gold value from a recipe.
 * @param recipe - Recipe config value.
 * @returns Base gold value.
 * @throws Never.
 */
function getRecipeBaseGoldValue(recipe: RestaurantRecipeValue): number {
  return Number(recipe.baseGoldValue ?? recipe.goldValue ?? 0);
}

/**
 * Fetches staff config and maps missing hire configs to the requested staff error.
 * @param staffType - Staff type identifier.
 * @param invalidTypeOnMissing - Whether missing config should map to INVALID_STAFF_TYPE.
 * @returns Staff config from game_config.
 * @throws INVALID_STAFF_TYPE:{staffType} when requested and config is missing.
 * @throws CONFIG_KEY_NOT_FOUND when config is missing without remapping.
 */
async function getStaffConfig(
  staffType: string,
  invalidTypeOnMissing: boolean,
): Promise<StaffConfig> {
  try {
    return await getConfig("staff_" + staffType) as StaffConfig;
  } catch (error) {
    if (
      invalidTypeOnMissing && String(error).includes("CONFIG_KEY_NOT_FOUND")
    ) {
      throw new Error("INVALID_STAFF_TYPE:" + staffType);
    }
    throw error;
  }
}

/**
 * Normalizes current and legacy staff JSON into a record keyed by staff type.
 * @param staff - Staff JSON from restaurant state.
 * @returns Staff map keyed by staff type.
 * @throws Never.
 */
function normalizeStaffMap(
  staff: RestaurantStaffMap | RestaurantStaffMember[] | Record<string, unknown>,
): RestaurantStaffMap {
  if (Array.isArray(staff)) {
    return Object.fromEntries(
      staff.map((member) => {
        const staffType = normalizeStaffType(
          member.staffType ?? member.role ?? member.type ?? "",
        );
        return [staffType, {
          staffType,
          tier: Number(member.tier ?? member.level ?? 1),
          hiredAt: member.hiredAt,
        }];
      }).filter(([staffType]) => staffType),
    ) as RestaurantStaffMap;
  }

  const out: RestaurantStaffMap = {};
  for (const [key, value] of Object.entries(staff)) {
    const staffType = normalizeStaffType(key);
    if (typeof value === "object" && value !== null) {
      const record = value as Partial<StaffRecord> & RestaurantStaffMember;
      out[staffType] = {
        staffType,
        tier: Number(record.tier ?? record.level ?? 1),
        hiredAt: record.hiredAt,
      };
    } else {
      out[staffType] = { staffType, tier: Number(value) };
    }
  }
  return out;
}

/**
 * Normalizes staff type aliases to storage keys.
 * @param value - Staff type or role value.
 * @returns Normalized staff type.
 * @throws Never.
 */
function normalizeStaffType(value: unknown): string {
  return String(value).toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
