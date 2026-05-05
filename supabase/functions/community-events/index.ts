import { getConfig, getConfigs } from "../lib/config.ts";
import { creditCoins } from "../lib/economy.ts";
import {
  addItemToInventory,
  removeItemFromInventory,
} from "../lib/inventory.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export interface ContributeResult {
  contributionValue: number;
  newEventTotal: number;
  xpAwarded: number;
}

export interface DailyChallenge {
  key: string;
  target: number;
  progress: number;
  complete: boolean;
}

export interface DailyChallengeSet {
  today: string;
  challenges: DailyChallenge[];
  bonusGiven: boolean;
}

export interface UpdateResult {
  updated: boolean;
  allComplete: boolean;
  bonusGiven: boolean;
}

export interface XpAwardCall {
  playerId: string;
  amount: number;
  source: string;
}

export interface RewardDistributionCall {
  playerId: string;
  reward: unknown;
}

interface CommunityEventRow {
  id: string;
  event_type: string;
  title: string;
  contribution_type: string;
  start_at: string;
  end_at: string;
  current_total: number;
  milestones: EventMilestone[];
  contributions: EventContribution[];
}

interface EventContribution {
  playerId: string;
  value: number;
  timestamp: number;
}

interface EventMilestone {
  threshold: number;
  rewardDistributed?: boolean;
  rewardTiers: {
    gold: unknown;
    silver: unknown;
    bronze: unknown;
    participation: unknown;
  };
}

interface PlayerDailyChallengeRow {
  daily_challenge_progress?: DailyChallengeProgress | null;
}

interface DailyChallengeProgress {
  [date: string]: DailyChallengeDay | undefined;
}

interface DailyChallengeDay {
  production?: ChallengeProgressEntry;
  social?: ChallengeProgressEntry;
  restaurant?: ChallengeProgressEntry;
  bonus_given?: boolean;
  [challengeKey: string]: unknown;
}

interface ChallengeProgressEntry {
  key: string;
  progress: number;
  complete?: boolean;
}

interface CommunityEventsQuery {
  select(columns: string): CommunityEventsQuery;
  eq(column: string, value: string): CommunityEventsQuery;
  update(values: Record<string, unknown>): CommunityEventsQuery;
  single(): Promise<
    { data: CommunityEventRow | null; error: { message: string } | null }
  >;
  then<
    TResult1 = {
      data: CommunityEventRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: CommunityEventRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface PlayersQuery {
  select(columns: string): PlayersQuery;
  eq(column: string, value: string): PlayersQuery;
  update(values: Record<string, unknown>): PlayersQuery;
  single(): Promise<
    { data: PlayerDailyChallengeRow | null; error: { message: string } | null }
  >;
  then<
    TResult1 = {
      data: PlayerDailyChallengeRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: PlayerDailyChallengeRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

const CHALLENGE_POOL = {
  PRODUCTION: [
    "harvest_4_crops",
    "collect_animal_3_times",
    "catch_3_fish",
    "complete_2_processing_jobs",
    "harvest_perpetual_crop_2_times",
    "recycle_junk_3_times",
  ],
  SOCIAL: [
    "steal_from_neighbour",
    "visit_2_friends",
    "help_a_neighbour",
    "fulfill_wishlist",
    "post_wishlist",
  ],
  RESTAURANT: [
    "list_5_dishes",
    "collect_restaurant_earnings",
    "sell_favoured_dish",
  ],
} as const;

const CHALLENGE_TARGETS: Record<string, number> = {
  harvest_4_crops: 4,
  collect_animal_3_times: 3,
  catch_3_fish: 3,
  complete_2_processing_jobs: 2,
  harvest_perpetual_crop_2_times: 2,
  recycle_junk_3_times: 3,
  steal_from_neighbour: 1,
  visit_2_friends: 2,
  help_a_neighbour: 1,
  fulfill_wishlist: 1,
  post_wishlist: 1,
  list_5_dishes: 5,
  collect_restaurant_earnings: 1,
  sell_favoured_dish: 1,
};

const ACTION_MAP: Record<string, string> = {
  harvest_crop: "harvest_4_crops",
  collect_animal: "collect_animal_3_times",
  catch_fish: "catch_3_fish",
  complete_processing: "complete_2_processing_jobs",
  harvest_perpetual: "harvest_perpetual_crop_2_times",
  recycle_junk: "recycle_junk_3_times",
  steal_success: "steal_from_neighbour",
  visit_friend: "visit_2_friends",
  help_neighbour: "help_a_neighbour",
  fulfill_wishlist: "fulfill_wishlist",
  post_wishlist: "post_wishlist",
  list_dish: "list_5_dishes",
  collect_restaurant: "collect_restaurant_earnings",
  sell_favoured: "sell_favoured_dish",
};

const xpAwardCalls: XpAwardCall[] = [];
const rewardDistributionCalls: RewardDistributionCall[] = [];

/**
 * Contributes an inventory item stack to an active community event.
 * @param playerId - Contributing player UUID.
 * @param eventId - Community event UUID.
 * @param itemId - Item identifier to contribute.
 * @param grade - Inventory grade for the contributed item.
 * @param quantity - Positive integer quantity to contribute.
 * @returns Contribution value, new event total, and XP awarded.
 * @throws EVENT_NOT_ACTIVE when the event is missing or outside its active window.
 * @throws INVALID_CONTRIBUTION_ITEM:{itemId} when itemId does not match the event contribution type.
 * @throws COOKED_DISHES_NOT_ALLOWED when the item is a cooked dish.
 * @throws INVALID_QUANTITY when quantity is not a positive integer.
 * @throws Helper errors from removeItemFromInventory, getConfig/getConfigs, awardXP, or Supabase writes.
 */
export async function contributeToEvent(
  playerId: string,
  eventId: string,
  itemId: string,
  grade: string,
  quantity: number,
): Promise<ContributeResult> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("INVALID_QUANTITY");
  }

  const { data: event, error } =
    await (supabaseAdmin.from("community_events") as CommunityEventsQuery)
      .select("*")
      .eq("id", eventId)
      .single();
  if (error) throw new Error("DB_ERROR:" + error.message);

  const currentTimestamp = nowSeconds();
  const now = new Date(currentTimestamp * 1000);
  if (
    !event || now < new Date(event.start_at) || now > new Date(event.end_at)
  ) {
    throw new Error("EVENT_NOT_ACTIVE");
  }

  if (itemId.startsWith("dish_")) throw new Error("COOKED_DISHES_NOT_ALLOWED");
  if (
    event.contribution_type !== "any_ingredient" &&
    !itemId.startsWith(event.contribution_type)
  ) {
    throw new Error("INVALID_CONTRIBUTION_ITEM:" + itemId);
  }

  await removeItemFromInventory(playerId, itemId, grade, quantity);

  const [gradeMultipliers, xpCap, baseValue] = await Promise.all([
    getConfig("EVENT_GRADE_MULTIPLIERS") as Promise<Record<string, number>>,
    getConfig("EVENT_CONTRIBUTION_XP_CAP") as Promise<number>,
    getItemBaseValue(itemId),
  ]);
  const contributionValue = Math.floor(
    baseValue * quantity * (gradeMultipliers[grade] ?? 1),
  );

  const contributions = [...(event.contributions ?? [])];
  const existing = contributions.find((entry) => entry.playerId === playerId);
  if (existing) {
    existing.value += contributionValue;
    existing.timestamp = currentTimestamp;
  } else {
    contributions.push({
      playerId,
      value: contributionValue,
      timestamp: currentTimestamp,
    });
  }

  const newTotal = event.current_total + contributionValue;
  await (supabaseAdmin.from("community_events") as CommunityEventsQuery)
    .update({ current_total: newTotal, contributions })
    .eq("id", eventId);

  const xpAwarded = Math.min(Math.floor(contributionValue / 10), xpCap);
  await awardXP(playerId, xpAwarded, "EVENT_CONTRIBUTION");
  await checkEventMilestones(eventId, newTotal, contributions);
  return { contributionValue, newEventTotal: newTotal, xpAwarded };
}

/**
 * Checks undistributed event milestones and distributes rewards for newly reached thresholds.
 * @param eventId - Community event UUID.
 * @param currentTotal - Current event contribution total.
 * @param contributions - Contributor value totals used to rank reward tiers.
 * @returns Nothing.
 * @throws DB_ERROR when event milestone reads fail.
 * @throws Helper errors from reward distribution or Supabase writes.
 */
export async function checkEventMilestones(
  eventId: string,
  currentTotal: number,
  contributions: EventContribution[],
): Promise<void> {
  const { data: event, error } =
    await (supabaseAdmin.from("community_events") as CommunityEventsQuery)
      .select("milestones")
      .eq("id", eventId)
      .single();
  if (error) throw new Error("DB_ERROR:" + error.message);
  const milestones = [...(event?.milestones ?? [])];

  for (const milestone of milestones) {
    if (currentTotal >= milestone.threshold && !milestone.rewardDistributed) {
      milestone.rewardDistributed = true;
      await distributeEventRewards(contributions, milestone);
    }
  }

  await (supabaseAdmin.from("community_events") as CommunityEventsQuery)
    .update({ milestones })
    .eq("id", eventId);
}

/**
 * Distributes a reached milestone's tiered rewards based on contributor rank.
 * @param contributions - Contributor value totals.
 * @param milestone - Reached milestone with reward tier payloads.
 * @returns Nothing.
 * @throws Helper errors from distributeReward.
 */
export async function distributeEventRewards(
  contributions: EventContribution[],
  milestone: EventMilestone,
): Promise<void> {
  const sorted = [...contributions].sort((a, b) => b.value - a.value);
  const n = sorted.length;
  const t10 = Math.ceil(n * 0.10);
  const t30 = Math.ceil(n * 0.30);
  const t60 = Math.ceil(n * 0.60);

  for (let i = 0; i < sorted.length; i++) {
    const reward = i < t10
      ? milestone.rewardTiers.gold
      : i < t30
      ? milestone.rewardTiers.silver
      : i < t60
      ? milestone.rewardTiers.bronze
      : milestone.rewardTiers.participation;
    await distributeReward(sorted[i].playerId, reward);
  }
}

/**
 * Applies a reward payload to a player.
 * @param playerId - Reward recipient UUID.
 * @param reward - Reward payload from a milestone tier.
 * @returns Nothing.
 * @throws Helper errors from creditCoins, addItemToInventory, or awardXP.
 */
export async function distributeReward(
  playerId: string,
  reward: unknown,
): Promise<void> {
  rewardDistributionCalls.push({ playerId, reward });
  if (!reward || typeof reward !== "object") return;

  const payload = reward as {
    coins?: number;
    xp?: number;
    items?: Array<
      { itemId: string; grade?: string; quantity?: number; qty?: number }
    >;
  };

  // SPEC_AMBIGUITY: Task 9.3 says to implement reward shape from a spec extension, but no extension was included. This accepts common coins/xp/items payload fields and records every distribution for tests.
  if (Number.isInteger(payload.coins) && Number(payload.coins) > 0) {
    await creditCoins(
      playerId,
      Number(payload.coins),
      "EVENT_REWARD",
      crypto.randomUUID(),
      { reward },
    );
  }
  if (Number.isInteger(payload.xp) && Number(payload.xp) > 0) {
    await awardXP(playerId, Number(payload.xp), "EVENT_REWARD");
  }
  for (const item of payload.items ?? []) {
    const quantity = Number(item.quantity ?? item.qty ?? 1);
    await addItemToInventory(
      playerId,
      item.itemId,
      item.grade ?? "Normal",
      quantity,
    );
  }
}

/**
 * Returns the deterministic daily challenge set for a player and date.
 * @param playerId - Player UUID used as part of the deterministic challenge seed.
 * @returns Today's challenge set with progress and bonus state.
 * @throws Helper errors from Supabase reads.
 */
export async function getDailyChallenges(
  playerId: string,
): Promise<DailyChallengeSet> {
  const today = todayDateString();
  const keys = dailyChallengeKeys(playerId, today);
  const { data: player, error } =
    await (supabaseAdmin.from("players") as PlayersQuery)
      .select("daily_challenge_progress")
      .eq("id", playerId)
      .single();
  if (error) throw new Error("DB_ERROR:" + error.message);

  const todayEntry = player?.daily_challenge_progress?.[today] ?? {};
  return {
    today,
    challenges: keys.map((key) => {
      const progress = getStoredChallengeProgress(todayEntry, key);
      const target = CHALLENGE_TARGETS[key];
      return {
        key,
        target,
        progress,
        complete: progress >= target,
      };
    }),
    bonusGiven: todayEntry.bonus_given ?? false,
  };
}

/**
 * Updates today's progress for the daily challenge matching an action type.
 * @param playerId - Player UUID.
 * @param actionType - Gameplay action type mapped to a challenge key.
 * @param incrementBy - Positive integer progress increment, defaulting to 1.
 * @returns Update status, all-complete state, and whether the completion bonus was just granted.
 * @throws INVALID_INCREMENT when incrementBy is not a positive integer.
 * @throws Helper errors from getDailyChallenges, creditCoins, addItemToInventory, awardXP, or Supabase writes.
 */
export async function updateChallengeProgress(
  playerId: string,
  actionType: string,
  incrementBy = 1,
): Promise<UpdateResult> {
  if (!Number.isInteger(incrementBy) || incrementBy <= 0) {
    throw new Error("INVALID_INCREMENT");
  }

  const challengeKey = ACTION_MAP[actionType];
  if (!challengeKey) {
    return { updated: false, allComplete: false, bonusGiven: false };
  }

  const today = todayDateString();
  const set = await getDailyChallenges(playerId);
  if (!set.challenges.find((challenge) => challenge.key === challengeKey)) {
    return { updated: false, allComplete: false, bonusGiven: false };
  }

  const { data: player, error } =
    await (supabaseAdmin.from("players") as PlayersQuery)
      .select("daily_challenge_progress")
      .eq("id", playerId)
      .single();
  if (error) throw new Error("DB_ERROR:" + error.message);

  const dp = player?.daily_challenge_progress ?? {};
  const todayEntry = dp[today] ?? {};
  dp[today] = todayEntry;
  const category = categoryForChallengeKey(challengeKey);
  const current = getStoredChallengeProgress(todayEntry, challengeKey);
  todayEntry[category] = {
    key: challengeKey,
    progress: current + incrementBy,
    complete: current + incrementBy >= CHALLENGE_TARGETS[challengeKey],
  };

  const allComplete = set.challenges.every((challenge) => {
    const progress = challenge.key === challengeKey
      ? current + incrementBy
      : getStoredChallengeProgress(todayEntry, challenge.key);
    return progress >= challenge.target;
  });

  let bonusGiven = false;
  if (allComplete && !todayEntry.bonus_given) {
    const cfg = await getConfigs([
      "DAILY_CHALLENGE_COIN_REWARD",
      "DAILY_CHALLENGE_XP_REWARD",
    ]);
    todayEntry.bonus_given = true;
    bonusGiven = true;
    await creditCoins(
      playerId,
      Number(cfg.DAILY_CHALLENGE_COIN_REWARD),
      "DAILY_CHALLENGE_REWARD",
      crypto.randomUUID(),
      {},
    );
    await addItemToInventory(playerId, "timeskip_5min", "Normal", 1);
    await awardXP(
      playerId,
      Number(cfg.DAILY_CHALLENGE_XP_REWARD),
      "DAILY_CHALLENGE_COMPLETE",
    );
  }

  await (supabaseAdmin.from("players") as PlayersQuery)
    .update({ daily_challenge_progress: dp })
    .eq("id", playerId);
  return { updated: true, allComplete, bonusGiven };
}

/**
 * Records XP awards until the Task 10 XP system is implemented.
 * @param playerId - Player UUID.
 * @param amount - XP amount to award.
 * @param source - XP source identifier.
 * @returns Nothing.
 * @throws Never.
 */
export async function awardXP(
  playerId: string,
  amount: number,
  source: string,
): Promise<void> {
  xpAwardCalls.push({ playerId, amount, source });
}

/**
 * Returns recorded Task 9.3 stub calls for tests.
 * @returns XP and reward distribution call arrays.
 * @throws Never.
 */
export function getCommunityEventStubCallsForTesting(): {
  xpAwards: XpAwardCall[];
  rewardDistributions: RewardDistributionCall[];
} {
  return {
    xpAwards: [...xpAwardCalls],
    rewardDistributions: [...rewardDistributionCalls],
  };
}

/**
 * Clears recorded Task 9.3 stub calls for tests.
 * @returns Nothing.
 * @throws Never.
 */
export function resetCommunityEventStubsForTesting(): void {
  xpAwardCalls.length = 0;
  rewardDistributionCalls.length = 0;
}

/**
 * Handles HTTP requests for community event and daily challenge operations.
 * @param request - Incoming Edge Function request.
 * @returns JSON response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    if (body.action === "contributeToEvent") {
      const result = await contributeToEvent(
        String(body.playerId ?? ""),
        String(body.eventId ?? ""),
        String(body.itemId ?? ""),
        String(body.grade ?? ""),
        Number(body.quantity ?? 0),
      );
      return Response.json(result);
    }
    if (body.action === "getDailyChallenges") {
      return Response.json(
        await getDailyChallenges(String(body.playerId ?? "")),
      );
    }
    if (body.action === "updateChallengeProgress") {
      return Response.json(
        await updateChallengeProgress(
          String(body.playerId ?? ""),
          String(body.actionType ?? ""),
          body.incrementBy === undefined ? 1 : Number(body.incrementBy),
        ),
      );
    }
    throw new Error("UNKNOWN_ACTION");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

/**
 * Reads an item's configured base contribution value.
 * @param itemId - Item config key.
 * @returns Positive integer base value.
 * @throws ITEM_BASE_VALUE_MISSING:{itemId} when no supported value field exists.
 */
async function getItemBaseValue(itemId: string): Promise<number> {
  const config = await getConfig(itemId) as Record<string, unknown>;
  // SPEC_AMBIGUITY: Task 9.3 references getItemBaseValue but no shared helper or canonical config shape exists; this reads baseValue first, then existing recipe-style baseGoldValue/goldValue/value/price fields.
  const value = config.baseValue ?? config.baseGoldValue ?? config.goldValue ??
    config.value ?? config.price;
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error("ITEM_BASE_VALUE_MISSING:" + itemId);
  }
  return Number(value);
}

/**
 * Returns the current UTC date string using integer unix-second time.
 * @returns ISO calendar date string.
 * @throws Never.
 */
function todayDateString(): string {
  return new Date(nowSeconds() * 1000).toISOString().slice(0, 10);
}

/**
 * Returns the current unix timestamp in whole seconds.
 * @returns Integer unix seconds.
 * @throws Never.
 */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Selects one challenge from each category for a player and date.
 * @param playerId - Player UUID.
 * @param today - ISO calendar date string.
 * @returns Production, social, and restaurant challenge keys.
 * @throws Never.
 */
function dailyChallengeKeys(playerId: string, today: string): string[] {
  let hash = 7;
  for (const c of playerId + today) hash = hash * 31 + c.charCodeAt(0);
  hash = Math.abs(hash);
  const p = CHALLENGE_POOL.PRODUCTION[hash % CHALLENGE_POOL.PRODUCTION.length];
  const s = CHALLENGE_POOL.SOCIAL[
    (hash * 7) % CHALLENGE_POOL.SOCIAL.length
  ];
  const r = CHALLENGE_POOL.RESTAURANT[
    (hash * 13) % CHALLENGE_POOL.RESTAURANT.length
  ];
  return [p, s, r];
}

/**
 * Reads progress from documented category objects or legacy flat challenge-key fields.
 * @param day - Stored daily challenge progress for one date.
 * @param challengeKey - Challenge key to read.
 * @returns Stored progress, or 0 when absent.
 * @throws Never.
 */
function getStoredChallengeProgress(
  day: DailyChallengeDay,
  challengeKey: string,
): number {
  // SPEC_AMBIGUITY: The schema notes specify category objects, while pseudocode stores numeric values under challenge keys. This supports both and writes category objects.
  for (const category of ["production", "social", "restaurant"] as const) {
    const entry = day[category];
    if (entry?.key === challengeKey) return entry.progress;
  }
  const legacyProgress = day[challengeKey];
  return Number.isInteger(legacyProgress) ? Number(legacyProgress) : 0;
}

/**
 * Maps a challenge key to its daily progress category.
 * @param challengeKey - Challenge key.
 * @returns Category field name.
 * @throws UNKNOWN_CHALLENGE:{challengeKey} when the key is not in a challenge pool.
 */
function categoryForChallengeKey(
  challengeKey: string,
): "production" | "social" | "restaurant" {
  if ((CHALLENGE_POOL.PRODUCTION as readonly string[]).includes(challengeKey)) {
    return "production";
  }
  if ((CHALLENGE_POOL.SOCIAL as readonly string[]).includes(challengeKey)) {
    return "social";
  }
  if ((CHALLENGE_POOL.RESTAURANT as readonly string[]).includes(challengeKey)) {
    return "restaurant";
  }
  throw new Error("UNKNOWN_CHALLENGE:" + challengeKey);
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
