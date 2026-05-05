import { getFarmState } from "../get-farm-state/index.ts";
import { calculateNeighbourScoreTier } from "../get-player-profile/index.ts";
import { getConfig, getConfigs } from "../lib/config.ts";
import { debitCoins, validateCanAfford } from "../lib/economy.ts";
import { addItemToInventory } from "../lib/inventory.ts";
import type { FarmPlot } from "../lib/farm.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export { calculateNeighbourScoreTier } from "../get-player-profile/index.ts";

export interface StealableItem {
  plotId: string;
  cropId: string | null;
  stealPoolRemaining: number;
  stealCost: number;
  gradeVisible: string;
}

export interface StealableItemsResult {
  stealableItems: StealableItem[];
  isFriend?: boolean;
  targetProtected: boolean;
  reason?: string;
}

export interface PublicThiefStats {
  totalAttemptsLifetime: number;
  totalSuccessesLifetime: number;
  successRatePercent: number;
  nemesisDisplayName: string | null;
  timesStorenFrom: number;
}

export interface ValidationResult {
  valid: boolean;
  error: string | null;
  isFriend: boolean;
  stealCost: number;
}

export interface StolenItem {
  itemId: string;
  grade: string;
  quantity: number;
}

export interface StealResult {
  success: boolean;
  itemsStolen?: StolenItem[];
  stealCost?: number;
  stealPoolRemainingAfter?: number;
  poolExhausted?: boolean;
  reason?: string;
  refund?: number;
  message?: string;
}

export interface NotificationCall {
  playerId: string;
  type: string;
  data: Record<string, unknown>;
}

interface StrangerStealsToday {
  count: number;
  resetDate: string;
}

interface ThiefStats {
  totalAttemptsLifetime?: number;
  totalSuccessesLifetime?: number;
  nemesisPlayerId?: string | null;
  nemesisDisplayName?: string | null;
  timesStorenFrom?: number;
}

interface StealLogEntry {
  targetId: string;
  timestamp: number;
}

interface PlayerLevelRow {
  level: number;
  neighbourhood_id?: string | null;
  stranger_steals_today?: StrangerStealsToday | null;
  coins?: number;
  farm_plots?: FarmPlot[];
  thief_stats?: ThiefStats | null;
  steal_log?: StealLogEntry[] | null;
  neighbour_score?: number | null;
}

interface PlayerLevelQuery {
  select(columns: string): PlayerLevelQuery;
  eq(column: string, value: string): PlayerLevelQuery;
  update(values: Record<string, unknown>): PlayerLevelQuery;
  single(): Promise<
    { data: PlayerLevelRow | null; error: { message: string } | null }
  >;
  maybeSingle(): Promise<
    { data: PlayerLevelRow | null; error: { message: string } | null }
  >;
}

let mutualFriendResultForTesting = true;
let randomIntInclusiveOverrideForTesting:
  | ((min: number, max: number) => number)
  | null = null;
const notificationCalls: NotificationCall[] = [];

/**
 * Checks whether two players are mutual friends.
 * STUB: replaced by Task 7.1 and returns true in V1 unless overridden by tests.
 * @param id1 - First player ID.
 * @param id2 - Second player ID.
 * @returns Whether the players are mutual friends.
 * @throws Never.
 */
export async function isMutualFriend(
  id1: string,
  id2: string,
): Promise<boolean> {
  await Promise.resolve();
  void id1;
  void id2;
  return mutualFriendResultForTesting;
}

/**
 * Sets the V1 mutual-friend stub result for tests.
 * @param value - Result returned by isMutualFriend.
 * @returns Nothing.
 * @throws Never.
 */
export function setMutualFriendResultForTesting(value: boolean): void {
  mutualFriendResultForTesting = value;
}

/**
 * Resets steal module stubs to their V1 defaults for tests.
 * @returns Nothing.
 * @throws Never.
 */
export function resetStealStubsForTesting(): void {
  mutualFriendResultForTesting = true;
  randomIntInclusiveOverrideForTesting = null;
  notificationCalls.length = 0;
}

/**
 * Sets the random integer generator used by attemptSteal for tests.
 * @param fn - Override returning an integer in the requested range, or null for Math.random.
 * @returns Nothing.
 * @throws Never.
 */
export function setStealRandomIntForTesting(
  fn: ((min: number, max: number) => number) | null,
): void {
  randomIntInclusiveOverrideForTesting = fn;
}

/**
 * Returns recorded notification stub calls for tests.
 * @returns Copies of notification calls.
 * @throws Never.
 */
export function getStealStubCallsForTesting(): {
  notifications: NotificationCall[];
} {
  return {
    notifications: notificationCalls.map((call) => ({
      ...call,
      data: { ...call.data },
    })),
  };
}

/**
 * Returns a random integer in an inclusive range.
 * @param min - Inclusive minimum.
 * @param max - Inclusive maximum.
 * @returns Random integer between min and max.
 * @throws Never.
 */
export function randomIntInclusive(min: number, max: number): number {
  if (randomIntInclusiveOverrideForTesting) {
    return randomIntInclusiveOverrideForTesting(min, max);
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
  notificationCalls.push({ playerId, type, data: { ...data } });
}

/**
 * Returns all stealable plots visible to the thief on the target's farm.
 * @param thiefPlayerId - Player opening the steal UI.
 * @param targetPlayerId - Farm owner being inspected.
 * @returns Structured stealable item result for protected, missing, and normal targets.
 * @throws Never.
 */
export async function getStealableItems(
  thiefPlayerId: string,
  targetPlayerId: string,
): Promise<StealableItemsResult> {
  try {
    const { data: target } =
      await (supabaseAdmin.from("players") as PlayerLevelQuery)
        .select("level")
        .eq("id", targetPlayerId)
        .single();

    if (!target) {
      return {
        stealableItems: [],
        targetProtected: true,
        reason: "TARGET_NOT_FOUND",
      };
    }

    const protectionLevel = Number(
      await getConfig("NEW_PLAYER_PROTECTION_LEVEL"),
    );
    if (target.level <= protectionLevel) {
      return {
        stealableItems: [],
        targetProtected: true,
        reason: "TARGET_PROTECTED",
      };
    }

    const isFriend = await isMutualFriend(thiefPlayerId, targetPlayerId);
    const farmState = await getFarmState(targetPlayerId);
    const stealablePlots = farmState.plots.filter((plot) =>
      plot.state === "STEALABLE" && plot.stealPoolRemaining > 0
    );

    const hasFoxPet = false;
    const costCfg = await getConfigs([
      "STEAL_COST_NORMAL",
      "STEAL_COST_BRONZE",
      "STEAL_COST_SILVER",
      "STEAL_COST_GOLD",
      "STEAL_COST_DIAMOND",
      "STEAL_COST_LEGENDARY",
    ]);
    const stealCosts: Record<string, number> = {
      Normal: Number(costCfg["STEAL_COST_NORMAL"]),
      Bronze: Number(costCfg["STEAL_COST_BRONZE"]),
      Silver: Number(costCfg["STEAL_COST_SILVER"]),
      Gold: Number(costCfg["STEAL_COST_GOLD"]),
      Diamond: Number(costCfg["STEAL_COST_DIAMOND"]),
      Legendary: Number(costCfg["STEAL_COST_LEGENDARY"]),
    };

    const stealableItems = stealablePlots.map((plot) => ({
      plotId: plot.plotId,
      cropId: plot.cropId,
      stealPoolRemaining: plot.stealPoolRemaining,
      stealCost: isFriend ? 0 : stealCosts.Normal,
      gradeVisible: hasFoxPet ? plot.cropId ?? "Unknown" : "Unknown",
    }));

    return { stealableItems, isFriend, targetProtected: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stealableItems: [], targetProtected: true, reason: message };
  }
}

/**
 * Validates whether a steal attempt may proceed without modifying any state.
 * This pre-flight check performs database reads only and leaves coins, inventory,
 * farm JSONB, and daily counters untouched.
 * @param thiefId - Player attempting the steal.
 * @param targetId - Farm owner being stolen from.
 * @param plotId - Target farm plot ID.
 * @returns Validation result with connection status and required steal cost.
 * @throws DB_ERROR, CONFIG_KEY_NOT_FOUND, PLAYER_NOT_FOUND, or INVALID_AMOUNT from read-only helpers when backing reads fail.
 */
export async function validateStealAttempt(
  thiefId: string,
  targetId: string,
  plotId: string,
): Promise<ValidationResult> {
  const { data: target } =
    await (supabaseAdmin.from("players") as PlayerLevelQuery)
      .select("level, neighbourhood_id")
      .eq("id", targetId)
      .maybeSingle();
  if (!target) {
    return {
      valid: false,
      error: "TARGET_NOT_FOUND",
      isFriend: false,
      stealCost: 0,
    };
  }

  const protectionLevel = Number(
    await getConfig("NEW_PLAYER_PROTECTION_LEVEL"),
  );
  if (target.level <= protectionLevel) {
    return {
      valid: false,
      error: "TARGET_PROTECTED_NEW_PLAYER",
      isFriend: false,
      stealCost: 0,
    };
  }

  const isFriend = await isMutualFriend(thiefId, targetId);
  if (!isFriend) {
    const { data: thief } =
      await (supabaseAdmin.from("players") as PlayerLevelQuery)
        .select("neighbourhood_id")
        .eq("id", thiefId)
        .single();
    const isNeighbour = thief?.neighbourhood_id != null &&
      thief.neighbourhood_id === target.neighbourhood_id;
    if (!isNeighbour) {
      return {
        valid: false,
        error: "NOT_CONNECTED",
        isFriend: false,
        stealCost: 0,
      };
    }
  }

  const farmState = await getFarmState(targetId);
  const plot = farmState.plots.find((candidate) => candidate.plotId === plotId);
  if (!plot) {
    return { valid: false, error: "PLOT_NOT_FOUND", isFriend, stealCost: 0 };
  }
  // SPEC_AMBIGUITY: calculatePlotState converts exhausted steal pools to RIPE, but T6.2.7 expects STEAL_POOL_EXHAUSTED for a target plot with stealPoolRemaining:0.
  if (plot.stealPoolRemaining <= 0) {
    return {
      valid: false,
      error: "STEAL_POOL_EXHAUSTED",
      isFriend,
      stealCost: 0,
    };
  }
  if (plot.state !== "STEALABLE") {
    return {
      valid: false,
      error: "PLOT_NOT_STEALABLE:" + plot.state,
      isFriend,
      stealCost: 0,
    };
  }

  if (!isFriend) {
    const { data: thiefData } =
      await (supabaseAdmin.from("players") as PlayerLevelQuery)
        .select("stranger_steals_today")
        .eq("id", thiefId)
        .single();
    const storedSteals = thiefData?.stranger_steals_today ?? {
      count: 0,
      resetDate: "",
    };
    const todayUTC = new Date().toISOString().slice(0, 10);
    const dailyCount = storedSteals.resetDate === todayUTC
      ? storedSteals.count
      : 0;
    const dailyLimit = Number(await getConfig("STRANGER_DAILY_STEAL_LIMIT"));
    if (dailyCount >= dailyLimit) {
      return {
        valid: false,
        error: "STRANGER_DAILY_LIMIT_REACHED",
        isFriend: false,
        stealCost: 0,
      };
    }

    const stealCosts = await getConfigs([
      "STEAL_COST_NORMAL",
      "STEAL_COST_BRONZE",
      "STEAL_COST_SILVER",
      "STEAL_COST_GOLD",
      "STEAL_COST_DIAMOND",
      "STEAL_COST_LEGENDARY",
    ]);
    const stealCost = Number(stealCosts["STEAL_COST_NORMAL"]);
    const afford = await validateCanAfford(thiefId, stealCost);
    if (!afford.canAfford) {
      return {
        valid: false,
        error: "INSUFFICIENT_FUNDS",
        isFriend: false,
        stealCost,
      };
    }
    return { valid: true, error: null, isFriend: false, stealCost };
  }

  return { valid: true, error: null, isFriend: true, stealCost: 0 };
}

/**
 * Executes a steal attempt and commits farm, economy, inventory, stat, and notification effects.
 * Writes are ordered as validation, fresh race guard, stranger charge, farm pool decrement,
 * inventory award, stats updates, anonymous notification, and result return.
 * @param thiefPlayerId - Player attempting the steal.
 * @param targetPlayerId - Farm owner being stolen from.
 * @param plotId - Target farm plot ID.
 * @returns Steal result, or a non-throwing race-condition failure result.
 * @throws TARGET_NOT_FOUND, TARGET_PROTECTED_NEW_PLAYER, NOT_CONNECTED, PLOT_NOT_FOUND, PLOT_NOT_STEALABLE:{state}, STEAL_POOL_EXHAUSTED, STRANGER_DAILY_LIMIT_REACHED, INSUFFICIENT_FUNDS, or helper errors from debitCoins/addItemToInventory.
 */
export async function attemptSteal(
  thiefPlayerId: string,
  targetPlayerId: string,
  plotId: string,
): Promise<StealResult> {
  const validation = await validateStealAttempt(
    thiefPlayerId,
    targetPlayerId,
    plotId,
  );
  if (!validation.valid) throw new Error(validation.error!);

  const { data: targetPlayer } =
    await (supabaseAdmin.from("players") as PlayerLevelQuery)
      .select("farm_plots, thief_stats")
      .eq("id", targetPlayerId)
      .single();
  const plots = targetPlayer!.farm_plots as FarmPlot[];
  const plotIdx = plots.findIndex((plot) => plot.plotId === plotId);
  if (plots[plotIdx].stealPoolRemaining <= 0) {
    return {
      success: false,
      reason: "STEAL_POOL_EMPTY_RACE_CONDITION",
      refund: 0,
      message: "Another player just claimed the last items.",
    };
  }

  if (!validation.isFriend) {
    await debitCoins(
      thiefPlayerId,
      validation.stealCost,
      "STRANGER_STEAL",
      crypto.randomUUID(),
      { targetId: targetPlayerId, plotId },
    );
  }

  const cfg = await getConfigs(["STEAL_UNITS_MIN", "STEAL_UNITS_MAX"]);
  let unitsToSteal = randomIntInclusive(
    Number(cfg["STEAL_UNITS_MIN"]),
    Number(cfg["STEAL_UNITS_MAX"]),
  );
  unitsToSteal = Math.min(unitsToSteal, plots[plotIdx].stealPoolRemaining);

  plots[plotIdx].stealPoolRemaining -= unitsToSteal;
  if (plots[plotIdx].stealPoolRemaining < 0) {
    plots[plotIdx].stealPoolRemaining = 0;
  }
  await (supabaseAdmin.from("players") as PlayerLevelQuery)
    .update({ farm_plots: plots })
    .eq("id", targetPlayerId);

  const cropId = plots[plotIdx].cropId!;
  await addItemToInventory(thiefPlayerId, cropId, "Normal", unitsToSteal);

  const { data: thiefData } =
    await (supabaseAdmin.from("players") as PlayerLevelQuery)
      .select("thief_stats, steal_log, neighbour_score, stranger_steals_today")
      .eq("id", thiefPlayerId)
      .single();
  const thiefStats: ThiefStats = thiefData!.thief_stats ?? {
    totalAttemptsLifetime: 0,
    totalSuccessesLifetime: 0,
    nemesisPlayerId: null,
    nemesisDisplayName: null,
    timesStorenFrom: 0,
  };
  thiefStats.totalAttemptsLifetime = (thiefStats.totalAttemptsLifetime ?? 0) +
    1;
  thiefStats.totalSuccessesLifetime = (thiefStats.totalSuccessesLifetime ?? 0) +
    1;

  const stealLog: StealLogEntry[] = [
    ...(thiefData!.steal_log ?? []),
    { targetId: targetPlayerId, timestamp: Math.floor(Date.now() / 1000) },
  ];
  const tally = stealLog.reduce((acc: Record<string, number>, entry) => {
    acc[entry.targetId] = (acc[entry.targetId] ?? 0) + 1;
    return acc;
  }, {});
  const nemesisId = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    null;
  if (nemesisId) thiefStats.nemesisPlayerId = nemesisId;

  const updates: Record<string, unknown> = {
    thief_stats: thiefStats,
    steal_log: stealLog,
  };
  if (!validation.isFriend) {
    const scorePenalty = Number(
      await getConfig("NEIGHBOUR_SCORE_STRANGER_STEAL"),
    );
    updates.neighbour_score = Math.max(
      0,
      (thiefData!.neighbour_score ?? 50) + scorePenalty,
    );
    const todayUTC = new Date().toISOString().slice(0, 10);
    const sst = thiefData!.stranger_steals_today ?? {
      count: 0,
      resetDate: "",
    };
    if (sst.resetDate !== todayUTC) {
      sst.count = 0;
      sst.resetDate = todayUTC;
    }
    sst.count += 1;
    updates.stranger_steals_today = sst;
  }
  await (supabaseAdmin.from("players") as PlayerLevelQuery)
    .update(updates)
    .eq("id", thiefPlayerId);

  const targetStats: ThiefStats = targetPlayer!.thief_stats ?? {
    timesStorenFrom: 0,
  };
  targetStats.timesStorenFrom = (targetStats.timesStorenFrom ?? 0) + 1;
  await (supabaseAdmin.from("players") as PlayerLevelQuery)
    .update({ thief_stats: targetStats })
    .eq("id", targetPlayerId);

  await sendNotification(targetPlayerId, "STOLEN_FROM", {
    cropId,
    unitsStolen: unitsToSteal,
    anonymous: true,
  });
  // SPEC_AMBIGUITY: Task 6.3 requires an addNeighbourhoodFeedEvent stub but does not define its signature, payload, or anonymity requirements.

  return {
    success: true,
    itemsStolen: [{ itemId: cropId, grade: "Normal", quantity: unitsToSteal }],
    stealCost: validation.stealCost,
    stealPoolRemainingAfter: plots[plotIdx].stealPoolRemaining,
    poolExhausted: plots[plotIdx].stealPoolRemaining === 0,
  };
}

/**
 * Returns a public steal profile without private economy, inventory, or timestamp data.
 * @param playerId - Player whose public thief stats are requested.
 * @returns Public thief stats with one-decimal success rate.
 * @throws Never.
 */
export async function getPublicThiefStats(
  playerId: string,
): Promise<PublicThiefStats> {
  const { data } = await (supabaseAdmin.from("players") as PlayerLevelQuery)
    .select("thief_stats")
    .eq("id", playerId)
    .single();
  const ts = data?.thief_stats ?? {};
  const attempts = ts.totalAttemptsLifetime ?? 0;
  const successes = ts.totalSuccessesLifetime ?? 0;
  const successRatePercent = attempts > 0
    ? Math.round((successes / attempts) * 1000) / 10
    : 0;

  return {
    totalAttemptsLifetime: attempts,
    totalSuccessesLifetime: successes,
    successRatePercent,
    nemesisDisplayName: ts.nemesisDisplayName ?? null,
    timesStorenFrom: ts.timesStorenFrom ?? 0,
  };
}

/**
 * Updates a player's neighbour score and clamps the result to the public 0-100 range.
 * @param playerId - Player whose score is changing.
 * @param delta - Score delta, positive or negative.
 * @returns New clamped score and public tier.
 * @throws Never.
 */
export async function updateNeighbourScore(
  playerId: string,
  delta: number,
): Promise<{ newScore: number; tier: string }> {
  const { data } = await (supabaseAdmin.from("players") as PlayerLevelQuery)
    .select("neighbour_score")
    .eq("id", playerId)
    .single();
  const current = data?.neighbour_score ?? 50;
  const newScore = Math.min(100, Math.max(0, current + delta));
  await (supabaseAdmin.from("players") as PlayerLevelQuery)
    .update({ neighbour_score: newScore })
    .eq("id", playerId);
  return { newScore, tier: calculateNeighbourScoreTier(newScore) };
}

/**
 * Returns today's stranger steal count, resetting stale days on read without writing.
 * @param thiefPlayerId - Thief player ID.
 * @returns Current UTC-day stranger steal count and reset date.
 * @throws Never.
 */
export async function getDailyStrangerStealCount(
  thiefPlayerId: string,
): Promise<{ count: number; resetDate: string }> {
  const { data } = await (supabaseAdmin.from("players") as PlayerLevelQuery)
    .select("stranger_steals_today")
    .eq("id", thiefPlayerId)
    .single();
  const stored = data?.stranger_steals_today ?? { count: 0, resetDate: "" };
  const today = new Date().toISOString().slice(0, 10);
  if (stored.resetDate !== today) return { count: 0, resetDate: today };
  return { count: stored.count, resetDate: stored.resetDate };
}

/**
 * Resets a thief's stranger steal counter for the current UTC day.
 * @param thiefPlayerId - Thief player ID.
 * @returns Nothing.
 * @throws Never.
 */
export async function resetDailyStrangerSteals(
  thiefPlayerId: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await (supabaseAdmin.from("players") as PlayerLevelQuery)
    .update({ stranger_steals_today: { count: 0, resetDate: today } })
    .eq("id", thiefPlayerId);
}

/**
 * Handles HTTP requests for the steal Edge Function.
 * @param request - Incoming Edge Function request with thiefPlayerId and targetPlayerId.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const action = String(body.action ?? "getStealableItems");
    const result = action === "validateStealAttempt"
      ? await validateStealAttempt(
        String(body.thiefPlayerId ?? body.thiefId ?? ""),
        String(body.targetPlayerId ?? body.targetId ?? ""),
        String(body.plotId ?? ""),
      )
      : action === "attemptSteal"
      ? await attemptSteal(
        String(body.thiefPlayerId ?? body.thiefId ?? ""),
        String(body.targetPlayerId ?? body.targetId ?? ""),
        String(body.plotId ?? ""),
      )
      : action === "getPublicThiefStats"
      ? await getPublicThiefStats(
        String(body.playerId ?? body.thiefPlayerId ?? ""),
      )
      : action === "updateNeighbourScore"
      ? await updateNeighbourScore(
        String(body.playerId ?? ""),
        Number(body.delta ?? 0),
      )
      : action === "getDailyStrangerStealCount"
      ? await getDailyStrangerStealCount(
        String(body.thiefPlayerId ?? body.thiefId ?? ""),
      )
      : action === "resetDailyStrangerSteals"
      ? await resetDailyStrangerSteals(
        String(body.thiefPlayerId ?? body.thiefId ?? ""),
      )
      : await getStealableItems(
        String(body.thiefPlayerId ?? ""),
        String(body.targetPlayerId ?? ""),
      );
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({
      stealableItems: [],
      targetProtected: true,
      reason: message,
    });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
