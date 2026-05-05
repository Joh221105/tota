import { getConfig } from "../_lib/config.ts";
import {
  addItemToInventory,
  type InventoryGrade,
  removeItemFromInventory,
} from "../_lib/inventory.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../_lib/supabase.ts";

export interface SessionResult {
  sessionToken: string;
  progressDurationSeconds: number;
  baitType: string;
}

export interface FishCaught {
  itemId: string;
  grade: InventoryGrade;
}

export interface FishResult {
  success: true;
  fishCaught: FishCaught;
  xpAwarded: number;
  isLegendary: boolean;
}

export interface FishingPoolEntry {
  itemId: string;
  weight: number;
}

export interface ActiveFishingSession {
  token: string;
  baitType: string;
  startedAt: number;
  expiresAt: number;
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

interface PlayerFishingRow {
  active_fishing_session?: ActiveFishingSession | null;
}

interface PlayerFishingQuery {
  select(columns: string): PlayerFishingQuery;
  eq(column: string, value: string): PlayerFishingQuery;
  single(): Promise<
    { data: PlayerFishingRow | null; error: { message: string } | null }
  >;
  update(values: Record<string, unknown>): PlayerFishingQuery;
  then<
    TResult1 = {
      data: PlayerFishingRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: PlayerFishingRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

const VALID_BAITS = ["bait_basic", "bait_fly", "bait_special"];
const FISH_RARITY: Record<string, string> = {
  fish_catfish: "common",
  fish_shrimp: "common",
  fish_crab: "uncommon",
  fish_tuna: "uncommon",
  fish_salmon: "uncommon",
  fish_pufferfish: "rare",
  fish_oarfish: "legendary",
  fish_ghostcarp: "legendary",
  fish_gildedtuna: "legendary",
};
const FISH_XP: Record<string, number> = {
  common: 10,
  uncommon: 20,
  rare: 40,
  legendary: 500,
};
const FISHING_GRADES: InventoryGrade[] = [
  "Normal",
  "Bronze",
  "Silver",
  "Gold",
  "Diamond",
  "Legendary",
];
const STANDARD_GRADE_RATES = [0.55, 0.28, 0.12, 0.04, 0.01, 0];
const xpAwardCalls: XpAwardCall[] = [];
const skillXpAwardCalls: SkillXpAwardCall[] = [];
const notificationCalls: NotificationCall[] = [];

/**
 * Rolls one item ID from a weighted fishing pool.
 * @param table - Weighted pool entries.
 * @returns Rolled item ID.
 * @throws EMPTY_WEIGHT_TABLE when the table is empty.
 */
export function rollFromWeightTable(table: FishingPoolEntry[]): string {
  if (table.length === 0) throw new Error("EMPTY_WEIGHT_TABLE");
  const totalWeight = table.reduce((sum, entry) => sum + entry.weight, 0);
  const roll = Math.random() * totalWeight;
  let cumulative = 0;
  for (const entry of table) {
    cumulative += entry.weight;
    if (roll < cumulative) return entry.itemId;
  }
  return table[table.length - 1].itemId;
}

/**
 * Rolls the caught fish grade from completion quality.
 * // SPEC_AMBIGUITY: The impatient adjustment creates negative Gold and Diamond rates; this implementation follows the literal additive table and normalises without clamping so T3.4.4 can exceed 70% Normal.
 * @param completionPercent - Client-reported completion percentage from 0 through 1.
 * @returns Rolled fish grade.
 * @throws INVALID_COMPLETION_PERCENT when completionPercent is outside 0 through 1.
 */
export function rollFishingGrade(completionPercent: number): InventoryGrade {
  if (completionPercent < 0 || completionPercent > 1) {
    throw new Error("INVALID_COMPLETION_PERCENT");
  }

  let rates = [...STANDARD_GRADE_RATES];
  if (completionPercent < 0.5) {
    rates = [
      rates[0] + 0.15,
      rates[1] + 0.05,
      rates[2] - 0.05,
      rates[3] - 0.10,
      rates[4] - 0.05,
      rates[5],
    ];
  } else if (completionPercent === 1) {
    rates = [
      rates[0] - 0.10,
      rates[1],
      rates[2] + 0.05,
      rates[3] + 0.04,
      rates[4] + 0.01,
      rates[5],
    ];
  }

  const total = rates.reduce((sum, rate) => sum + rate, 0);
  const roll = Math.random() * total;
  let cumulative = 0;
  for (let index = 0; index < rates.length; index += 1) {
    cumulative += rates[index];
    if (roll < cumulative) return FISHING_GRADES[index];
  }
  return "Diamond";
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
 * Resets V1 fishing stub call records for tests.
 * @returns Nothing.
 * @throws Never.
 */
export function resetFishingStubsForTesting(): void {
  xpAwardCalls.length = 0;
  skillXpAwardCalls.length = 0;
  notificationCalls.length = 0;
}

/**
 * Returns V1 fishing stub call records for tests.
 * @returns Copies of XP, skill XP, and notification calls.
 * @throws Never.
 */
export function getFishingStubCallsForTesting(): {
  xpAwards: XpAwardCall[];
  skillXpAwards: SkillXpAwardCall[];
  notifications: NotificationCall[];
} {
  return {
    xpAwards: [...xpAwardCalls],
    skillXpAwards: [...skillXpAwardCalls],
    notifications: notificationCalls.map((call) => ({
      ...call,
      data: { ...call.data },
    })),
  };
}

/**
 * Starts an active fishing session by consuming one bait item and writing players.active_fishing_session.
 * // SPEC_AMBIGUITY: Task 3.4 expects no bait to throw exactly INSUFFICIENT_QUANTITY, but removeItemFromInventory throws ITEM_NOT_FOUND:item:grade for a missing stack and INSUFFICIENT_QUANTITY:have:requested for a short stack.
 * @param playerId - Player starting the session.
 * @param baitItemId - Bait item ID, one of bait_basic, bait_fly, or bait_special.
 * @returns Session token, bait type, and progress duration.
 * @throws INVALID_BAIT_TYPE when baitItemId is not a V1 bait.
 * @throws FISHING_SESSION_ACTIVE when the player already has an active session.
 * @throws INSUFFICIENT_QUANTITY when bait cannot be consumed.
 * @throws CONFIG_KEY_NOT_FOUND when required config is missing.
 * @throws DB_ERROR when player reads or writes fail.
 */
export async function startFishingSession(
  playerId: string,
  baitItemId: string,
): Promise<SessionResult> {
  if (!VALID_BAITS.includes(baitItemId)) {
    throw new Error("INVALID_BAIT_TYPE");
  }

  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerFishingQuery)
      .select("active_fishing_session")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");
  if (player.active_fishing_session !== null) {
    throw new Error("FISHING_SESSION_ACTIVE");
  }

  try {
    await removeItemFromInventory(playerId, baitItemId, "Normal", 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.startsWith("ITEM_NOT_FOUND:") ||
      message.startsWith("INSUFFICIENT_QUANTITY")
    ) {
      throw new Error("INSUFFICIENT_QUANTITY");
    }
    throw error;
  }

  const durations = await getConfig("FISHING_PROGRESS_DURATION") as Record<
    string,
    number
  >;
  const expiry = await getConfig("FISHING_SESSION_EXPIRY_SECONDS") as number;
  const now = Math.floor(Date.now() / 1000);
  const session = {
    token: crypto.randomUUID(),
    baitType: baitItemId,
    startedAt: now,
    expiresAt: now + expiry,
  };

  const { error: updateError } =
    await (supabaseAdmin.from("players") as PlayerFishingQuery)
      .update({ active_fishing_session: session })
      .eq("id", playerId);

  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  return {
    sessionToken: session.token,
    progressDurationSeconds: durations[baitItemId],
    baitType: baitItemId,
  };
}

/**
 * Submits one fishing result, awards the caught fish and XP, and clears the active session.
 * @param playerId - Player submitting a completed fishing session.
 * @param sessionToken - Session token returned by startFishingSession.
 * @param completionPercent - Completion percentage from 0 through 1.
 * @returns Fish result with caught item, grade, XP, and legendary flag.
 * @throws NO_ACTIVE_SESSION when players.active_fishing_session is null.
 * @throws INVALID_SESSION_TOKEN when the token does not match the active session.
 * @throws SESSION_EXPIRED when now is after the session expiry.
 * @throws INVALID_COMPLETION_PERCENT when completionPercent is outside 0 through 1.
 * @throws CONFIG_KEY_NOT_FOUND when required config is missing.
 * @throws DB_ERROR when player reads or writes fail.
 */
export async function submitFishingResult(
  playerId: string,
  sessionToken: string,
  completionPercent: number,
): Promise<FishResult> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerFishingQuery)
      .select("active_fishing_session")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");

  const session = player.active_fishing_session;
  if (!session) throw new Error("NO_ACTIVE_SESSION");
  if (session.token !== sessionToken) throw new Error("INVALID_SESSION_TOKEN");

  const now = Math.floor(Date.now() / 1000);
  if (now > session.expiresAt) throw new Error("SESSION_EXPIRED");
  if (completionPercent < 0 || completionPercent > 1) {
    throw new Error("INVALID_COMPLETION_PERCENT");
  }

  const legendaryChance = await getConfig("LEGENDARY_CHANCE_SPECIAL") as number;
  let fishItemId: string;
  let isLegendary = false;
  if (
    session.baitType === "bait_special" &&
    Math.random() < legendaryChance
  ) {
    fishItemId = "fish_ghostcarp";
    isLegendary = true;
  } else {
    const pool = await getConfig(
      "fishing_pool_" + session.baitType,
    ) as FishingPoolEntry[];
    fishItemId = rollFromWeightTable(pool);
  }

  const grade = rollFishingGrade(completionPercent);
  await addItemToInventory(playerId, fishItemId, grade, 1);

  const xp = FISH_XP[FISH_RARITY[fishItemId] ?? "common"];
  await awardXP(playerId, xp, "CATCH_FISH");
  await awardSkillXP(playerId, "fishing", xp);

  if (isLegendary) {
    await sendNotification(playerId, "LEGENDARY_CATCH", {
      fishName: fishItemId,
    });
  }

  const { error: updateError } =
    await (supabaseAdmin.from("players") as PlayerFishingQuery)
      .update({ active_fishing_session: null })
      .eq("id", playerId);

  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  return {
    success: true,
    fishCaught: { itemId: fishItemId, grade },
    xpAwarded: xp,
    isLegendary,
  };
}

/**
 * Handles HTTP requests for the fishing Edge Function.
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
    const result = action === "start"
      ? await startFishingSession(playerId, String(body.baitItemId ?? ""))
      : await submitFishingResult(
        playerId,
        String(body.sessionToken ?? ""),
        Number(body.completionPercent),
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
