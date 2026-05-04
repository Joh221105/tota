import {
  type AnimalHappiness,
  type AnimalRecord,
  calculateAnimalHappiness,
  getAnimalConfig,
} from "../lib/animals.ts";
import { getConfig, getConfigs } from "../lib/config.ts";
import { debitCoins } from "../lib/economy.ts";
import {
  type BaseRates,
  type Grade,
  rollGrade,
} from "../harvest-plot/index.ts";
import {
  addItemToInventory,
  removeItemFromInventory,
} from "../lib/inventory.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export interface FeedResult {
  success: true;
  newHappiness: "HAPPY";
  feederRewarded: boolean;
}

export interface CollectItem {
  itemId: string;
  grade: string;
  quantity: number;
}

export interface CollectResult {
  success: true;
  itemsCollected: CollectItem[];
  feathersDropped: number;
  xpAwarded: number;
  cycles: number;
  happiness: AnimalHappiness;
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

export interface NotificationCall {
  playerId: string;
  type: string;
  data: Record<string, unknown>;
}

interface PlayerAnimalRow {
  animals?: Record<string, AnimalRecord>;
  skills?: {
    ranching?: {
      level?: number;
    };
  };
}

interface PlayerAnimalQuery {
  select(columns: string): PlayerAnimalQuery;
  eq(column: string, value: string): PlayerAnimalQuery;
  single(): Promise<
    { data: PlayerAnimalRow | null; error: { message: string } | null }
  >;
  update(values: Record<string, unknown>): PlayerAnimalQuery;
  then<
    TResult1 = {
      data: PlayerAnimalRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: PlayerAnimalRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

const xpAwardCalls: XpAwardCall[] = [];
const skillXpAwardCalls: SkillXpAwardCall[] = [];
const notificationCalls: NotificationCall[] = [];
const helpActionCalls: string[] = [];
const mutualFriendChecks: Array<{ id1: string; id2: string }> = [];

/**
 * Parses grade base rates from game_config values.
 * @param configs - Parsed game_config values keyed by config key.
 * @returns Base grade rates for rollGrade.
 * @throws Never.
 */
function parseBaseRates(configs: Record<string, unknown>): BaseRates {
  return {
    normal: Number(configs["GRADE_NORMAL_RATE"]),
    bronze: Number(configs["GRADE_BRONZE_RATE"]),
    silver: Number(configs["GRADE_SILVER_RATE"]),
    gold: Number(configs["GRADE_GOLD_RATE"]),
    diamond: Number(configs["GRADE_DIAMOND_RATE"]),
    legendary: Number(configs["GRADE_LEGENDARY_RATE"]),
  };
}

/**
 * Fetches base grade rates from game_config for animal produce rolls.
 * @returns Base grade rates for rollGrade.
 * @throws CONFIG_KEY_NOT_FOUND when a grade config row is missing.
 * @throws DB_ERROR when the config query fails.
 */
export async function fetchBaseRates(): Promise<BaseRates> {
  const configs = await getConfigs([
    "GRADE_NORMAL_RATE",
    "GRADE_BRONZE_RATE",
    "GRADE_SILVER_RATE",
    "GRADE_GOLD_RATE",
    "GRADE_DIAMOND_RATE",
    "GRADE_LEGENDARY_RATE",
  ]);
  return parseBaseRates(configs);
}

/**
 * Returns a random integer in the inclusive range.
 * @param min - Inclusive minimum.
 * @param max - Inclusive maximum.
 * @returns Random integer from min through max.
 * @throws Never.
 */
export function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Checks whether two players are mutual friends.
 * STUB: replaced by Task 7.1 and always passes in V1.
 * @param id1 - First player ID.
 * @param id2 - Second player ID.
 * @returns Nothing.
 * @throws NOT_FRIENDS when future mutual friend validation fails.
 */
export async function isMutualFriend(id1: string, id2: string): Promise<void> {
  await Promise.resolve();
  mutualFriendChecks.push({ id1, id2 });
}

/**
 * Records one daily help action for a helper.
 * STUB: replaced by Task 7.3.
 * @param helperId - Player performing the help action.
 * @returns Nothing.
 * @throws HELP_ACTIONS_EXHAUSTED when the future daily limit is reached.
 */
export async function incrementDailyHelpActions(
  helperId: string,
): Promise<void> {
  await Promise.resolve();
  helpActionCalls.push(helperId);
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
 * Awards skill XP to a player.
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
 * Resets V1 animal action stub call records for tests.
 * @returns Nothing.
 * @throws Never.
 */
export function resetAnimalActionStubsForTesting(): void {
  xpAwardCalls.length = 0;
  skillXpAwardCalls.length = 0;
  notificationCalls.length = 0;
  helpActionCalls.length = 0;
  mutualFriendChecks.length = 0;
}

/**
 * Returns V1 animal action stub call records for tests.
 * @returns Copies of XP, skill XP, notification, help action, and friend check calls.
 * @throws Never.
 */
export function getAnimalActionStubCallsForTesting(): {
  xpAwards: XpAwardCall[];
  skillXpAwards: SkillXpAwardCall[];
  notifications: NotificationCall[];
  helpActions: string[];
  mutualFriendChecks: Array<{ id1: string; id2: string }>;
} {
  return {
    xpAwards: [...xpAwardCalls],
    skillXpAwards: [...skillXpAwardCalls],
    notifications: notificationCalls.map((call) => ({
      ...call,
      data: { ...call.data },
    })),
    helpActions: [...helpActionCalls],
    mutualFriendChecks: mutualFriendChecks.map((call) => ({ ...call })),
  };
}

/**
 * Feeds an animal owned by ownerPlayerId.
 * @param feederPlayerId - Player performing the feed action.
 * @param ownerPlayerId - Owner of the animal.
 * @param animalId - Animal instance ID in players.animals.
 * @returns Feed result with happiness and friend reward status.
 * @throws ANIMAL_NOT_FOUND:{animalId} when the animal ID is missing from owner state.
 * @throws ANIMAL_NOT_FOUND:{animalType} when the animal config is missing.
 * @throws NOT_FRIENDS when future mutual friend validation fails.
 * @throws HELP_ACTIONS_EXHAUSTED when future daily help validation fails.
 * @throws DB_ERROR when a player query or update fails.
 */
export async function feedAnimal(
  feederPlayerId: string,
  ownerPlayerId: string,
  animalId: string,
): Promise<FeedResult> {
  const { data: owner, error: ownerError } =
    await (supabaseAdmin.from("players") as PlayerAnimalQuery)
      .select("animals")
      .eq("id", ownerPlayerId)
      .single();

  if (ownerError) throw new Error("DB_ERROR:" + ownerError.message);
  if (!owner) throw new Error("DB_ERROR:missing player");

  const animals: Record<string, AnimalRecord> = owner.animals ?? {};
  const animal = animals[animalId];
  if (!animal) throw new Error("ANIMAL_NOT_FOUND:" + animalId);

  const config = await getAnimalConfig(animal.animalType);
  const isFriendFeed = feederPlayerId !== ownerPlayerId;

  if (isFriendFeed) {
    await isMutualFriend(feederPlayerId, ownerPlayerId);
    await incrementDailyHelpActions(feederPlayerId);
  }

  if (isFriendFeed) {
    try {
      await removeItemFromInventory(
        ownerPlayerId,
        config.feedItemId,
        "Normal",
        1,
      );
    } catch {
      await debitCoins(
        feederPlayerId,
        config.feedCostCoins,
        "ANIMAL_FEED_PURCHASE",
        crypto.randomUUID(),
        { animalId },
      );
    }
  } else {
    await debitCoins(
      ownerPlayerId,
      config.feedCostCoins,
      "ANIMAL_FEED_PURCHASE",
      crypto.randomUUID(),
      { animalId },
    );
  }

  animal.lastFedTimestamp = Math.floor(Date.now() / 1000);
  const { error: updateError } =
    await (supabaseAdmin.from("players") as PlayerAnimalQuery)
      .update({ animals })
      .eq("id", ownerPlayerId);

  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  if (isFriendFeed) {
    await awardXP(feederPlayerId, 15, "FEED_ANIMAL");
    if (Math.random() < 0.25) {
      await addItemToInventory(
        feederPlayerId,
        config.products[0].itemId,
        "Normal",
        1,
      );
    }
    await sendNotification(ownerPlayerId, "FRIEND_FED_ANIMAL", { animalId });
  }

  return { success: true, newHappiness: "HAPPY", feederRewarded: isFriendFeed };
}

/**
 * Collects one animal product from a player's animal.
 * @param playerId - Player collecting produce.
 * @param animalId - Animal instance ID in players.animals.
 * @param productItemId - Product item ID to collect.
 * @returns Collect result with collected items, feather drops, XP, cycles, and happiness.
 * @throws ANIMAL_NOT_FOUND:{animalId} when the animal ID is missing from player state.
 * @throws ANIMAL_NOT_FOUND:{animalType} when the animal config is missing.
 * @throws INVALID_PRODUCT:{productItemId} when the animal does not produce that item.
 * @throws NEGLECTED_NO_PRODUCE:{animalId} when the animal is neglected.
 * @throws PRODUCE_NOT_READY:{seconds} when no production cycle is ready.
 * @throws DB_ERROR when a player query or update fails.
 * @throws CONFIG_KEY_NOT_FOUND when required config rows are missing.
 */
export async function collectAnimalProduce(
  playerId: string,
  animalId: string,
  productItemId: string,
): Promise<CollectResult> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerAnimalQuery)
      .select("animals, skills")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");

  const animals: Record<string, AnimalRecord> = player.animals ?? {};
  const animal = animals[animalId];
  if (!animal) throw new Error("ANIMAL_NOT_FOUND:" + animalId);

  const config = await getAnimalConfig(animal.animalType);
  const product = config.products.find((item) => item.itemId === productItemId);
  if (!product) throw new Error("INVALID_PRODUCT:" + productItemId);

  const now = Math.floor(Date.now() / 1000);
  const happiness = calculateAnimalHappiness(
    animal.lastFedTimestamp,
    now,
    config.feedIntervalSeconds,
  );
  if (happiness === "NEGLECTED") {
    throw new Error("NEGLECTED_NO_PRODUCE:" + animalId);
  }

  const offlineCap = Number(await getConfig("OFFLINE_CAP_SECONDS"));
  const lastCollect = (animal.lastCollectTimestamps ?? {})[productItemId] ?? 0;
  const elapsed = Math.min(now - lastCollect, offlineCap);
  const cycles = Math.floor(elapsed / product.produceTimerSeconds);
  if (cycles === 0) {
    const remaining = product.produceTimerSeconds - (now - lastCollect);
    throw new Error("PRODUCE_NOT_READY:" + remaining);
  }

  const ranchingSkillLevel = player.skills?.ranching?.level ?? 0;
  const baseRates = await fetchBaseRates();
  const itemsCollected: CollectItem[] = [];
  let feathersDropped = 0;
  // SPEC_AMBIGUITY: collectAnimalProduce hardcodes 0.15 for egg feather side drops, but AnimalProduct also defines dropChance in the animal config.
  const eggFeatherDropChance = Number(
    config.products.find((item) => item.itemId === "animal_feather")
      ?.dropChance ?? 0.15,
  );

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    let quantity: number;
    let grade: Grade;
    if (happiness === "SAD") {
      quantity = Math.max(
        1,
        Math.floor(
          randomIntInclusive(product.yieldMin, product.yieldMax) * 0.5,
        ),
      );
      grade = Math.random() < 0.7 ? "Normal" : "Bronze";
    } else {
      quantity = randomIntInclusive(product.yieldMin, product.yieldMax);
      grade = rollGrade(
        productItemId,
        {
          fertiliserBronzeBoost: 0,
          fertiliserSilverBoost: 0,
          waterings: 0,
        },
        ranchingSkillLevel,
        baseRates,
      );
    }

    await addItemToInventory(playerId, productItemId, grade, quantity);
    itemsCollected.push({ itemId: productItemId, grade, quantity });
    if (
      productItemId === "animal_egg" && Math.random() < eggFeatherDropChance
    ) {
      feathersDropped += 1;
    }
  }

  if (feathersDropped > 0) {
    await addItemToInventory(
      playerId,
      "animal_feather",
      "Normal",
      feathersDropped,
    );
  }

  const xpAwarded = 15 * cycles;
  await awardXP(playerId, xpAwarded, "COLLECT_ANIMAL_PRODUCE");
  await awardSkillXP(playerId, "ranching", xpAwarded);

  if (!animal.lastCollectTimestamps) animal.lastCollectTimestamps = {};
  animal.lastCollectTimestamps[productItemId] = now;
  const { error: updateError } =
    await (supabaseAdmin.from("players") as PlayerAnimalQuery)
      .update({ animals })
      .eq("id", playerId);

  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  return {
    success: true,
    itemsCollected,
    feathersDropped,
    xpAwarded,
    cycles,
    happiness,
  };
}

/**
 * Handles HTTP requests for the animals Edge Function.
 * @param request - Incoming Edge Function request with action-specific JSON body.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const action = String(body.action ?? "");
    const result = action === "feed"
      ? await feedAnimal(
        String(body.feederPlayerId ?? ""),
        String(body.ownerPlayerId ?? ""),
        String(body.animalId ?? ""),
      )
      : await collectAnimalProduce(
        String(body.playerId ?? ""),
        String(body.animalId ?? ""),
        String(body.productItemId ?? ""),
      );
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
