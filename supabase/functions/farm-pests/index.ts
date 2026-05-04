import { getConfig, getConfigs } from "../lib/config.ts";
import { getCropConfig } from "../lib/crops.ts";
import { debitCoins } from "../lib/economy.ts";
import {
  calculatePlotState,
  type FarmPlot,
  type PlotConstants,
} from "../lib/farm.ts";
import { addItemToInventory } from "../lib/inventory.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export interface PestCheckResult {
  pestSpawned: boolean;
  reason?: "PLOT_NOT_GROWING" | "RATE_LIMITED";
  pestType?: "bugs" | "weeds";
}

export interface RemovePestResult {
  success: true;
  bugsCleared: boolean;
  weedsCleared: boolean;
}

export interface SabotageResult {
  success: true;
  pestApplied: "bugs" | "weeds";
  saboteurScoreChange: number;
}

export interface RegrowResult {
  success: true;
  newYield: number;
  newStealPool: number;
  regrowTimeSeconds: number | null;
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

interface PlayerFarmRow {
  farm_plots: FarmPlot[];
}

interface SaboteurRow {
  sabotage_log?: SabotageLogEntry[] | null;
  neighbour_score?: number | null;
  coins?: number;
}

interface SabotageLogEntry {
  targetId: string;
  pestType: string;
  timestamp: number;
}

interface PlayerQuery {
  select(columns: string): PlayerQuery;
  eq(column: string, value: string): PlayerQuery;
  single(): Promise<
    {
      data: (PlayerFarmRow & SaboteurRow) | null;
      error: { message: string } | null;
    }
  >;
  update(values: Record<string, unknown>): PlayerQuery;
  then<
    TResult1 = {
      data: Array<PlayerFarmRow & SaboteurRow> | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: Array<PlayerFarmRow & SaboteurRow> | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

const xpAwardCalls: XpAwardCall[] = [];
const notificationCalls: NotificationCall[] = [];
const helpActionCalls: string[] = [];

/**
 * Fetches farm constants required by calculatePlotState from game_config.
 * @returns Plot constants for derived farm state calculation.
 * @throws CONFIG_KEY_NOT_FOUND when a required config row is missing.
 * @throws DB_ERROR when the config query fails.
 */
export async function fetchPlotConstants(): Promise<PlotConstants> {
  const configs = await getConfigs([
    "STEAL_WINDOW_SECONDS",
    "OFFLINE_CAP_SECONDS",
    "WITHER_TIME_MULTIPLIER",
    "MAX_WATERINGS_PER_CYCLE",
  ]);
  return {
    STEAL_WINDOW_SECONDS: Number(configs["STEAL_WINDOW_SECONDS"]),
    OFFLINE_CAP_SECONDS: Number(configs["OFFLINE_CAP_SECONDS"]),
    WITHER_TIME_MULTIPLIER: Number(configs["WITHER_TIME_MULTIPLIER"]),
    MAX_WATERINGS_PER_CYCLE: Number(configs["MAX_WATERINGS_PER_CYCLE"]),
  };
}

/**
 * Awards XP to a player.
 * STUB: replaced by Task 10.1.
 * @param playerId - Player receiving XP.
 * @param amount - XP amount.
 * @param source - Source label for the award.
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
 * Records one daily help action for a player.
 * STUB: replaced by Task 7.3.
 * @param helperId - Player performing the help action.
 * @returns Nothing.
 * @throws Never.
 */
export async function incrementDailyHelpActions(
  helperId: string,
): Promise<void> {
  await Promise.resolve();
  helpActionCalls.push(helperId);
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
 * Resets Task 2.9 stub call records for tests.
 * @returns Nothing.
 * @throws Never.
 */
export function resetFarmPestStubsForTesting(): void {
  xpAwardCalls.length = 0;
  notificationCalls.length = 0;
  helpActionCalls.length = 0;
}

/**
 * Returns Task 2.9 stub call records for tests.
 * @returns Copies of XP, notification, and help-action calls.
 * @throws Never.
 */
export function getFarmPestStubCallsForTesting(): {
  xpAwards: XpAwardCall[];
  notifications: NotificationCall[];
  helpActions: string[];
} {
  return {
    xpAwards: [...xpAwardCalls],
    notifications: notificationCalls.map((call) => ({
      ...call,
      data: { ...call.data },
    })),
    helpActions: [...helpActionCalls],
  };
}

/**
 * Returns a random integer in a closed inclusive range.
 * @param min - Minimum integer value.
 * @param max - Maximum integer value.
 * @returns Random integer where min <= value <= max.
 * @throws Never.
 */
export function randomIntInclusive(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Rate-limited pest spawn roll for one GROWING plot.
 * @param playerId - Owner of the farm plot.
 * @param plotId - Plot ID to check.
 * @returns Pest spawn outcome and optional reason or pest type.
 * @throws PLOT_NOT_FOUND:{plotId} if the plot is not in player's farm_plots.
 * @throws DB_ERROR when player queries or updates fail.
 * @throws CONFIG_KEY_NOT_FOUND when required config rows are missing.
 * @throws CROP_NOT_FOUND:{cropId} when the plot's crop config is missing.
 */
export async function spawnPestCheck(
  playerId: string,
  plotId: string,
): Promise<PestCheckResult> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .select("farm_plots")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");

  const plots = player.farm_plots;
  const plotIdx = plots.findIndex((plot) => plot.plotId === plotId);
  if (plotIdx === -1) throw new Error("PLOT_NOT_FOUND:" + plotId);

  const plot = plots[plotIdx];
  const cropConfig = await getCropConfig(plot.cropId!);
  const consts = await fetchPlotConstants();
  const now = Math.floor(Date.now() / 1000);
  const state = calculatePlotState(plot, now, cropConfig, consts);
  if (state.state !== "GROWING") {
    return { pestSpawned: false, reason: "PLOT_NOT_GROWING" };
  }

  if (now - plot.lastPestCheck < 1_800) {
    return { pestSpawned: false, reason: "RATE_LIMITED" };
  }

  const pestSpawnChance = await getConfig("PEST_SPAWN_CHANCE") as number;
  plots[plotIdx].lastPestCheck = now;
  if (Math.random() >= pestSpawnChance) {
    await updateFarmPlots(playerId, plots);
    return { pestSpawned: false };
  }

  const pestType = Math.random() < 0.5 ? "bugs" : "weeds";
  if (pestType === "bugs") plots[plotIdx].hasBugs = true;
  else plots[plotIdx].hasWeeds = true;
  await updateFarmPlots(playerId, plots);
  return { pestSpawned: true, pestType };
}

/**
 * Clears bugs and weeds from a plot, awarding friend-help side effects when applicable.
 * @param removerPlayerId - Player removing the pest.
 * @param ownerPlayerId - Owner of the affected plot.
 * @param plotId - Plot ID to clear.
 * @returns Pest removal result with the pest flags that were cleared.
 * @throws PLOT_NOT_FOUND:{plotId} if the plot is not in owner's farm_plots.
 * @throws NO_PEST_PRESENT:{plotId} if the plot has no bugs or weeds.
 * @throws DB_ERROR when player queries or updates fail.
 */
export async function removePest(
  removerPlayerId: string,
  ownerPlayerId: string,
  plotId: string,
): Promise<RemovePestResult> {
  const { data: owner, error: ownerError } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .select("farm_plots")
      .eq("id", ownerPlayerId)
      .single();

  if (ownerError) throw new Error("DB_ERROR:" + ownerError.message);
  if (!owner) throw new Error("DB_ERROR:missing player");

  const plots = owner.farm_plots;
  const plotIdx = plots.findIndex((plot) => plot.plotId === plotId);
  if (plotIdx === -1) throw new Error("PLOT_NOT_FOUND:" + plotId);

  const plot = plots[plotIdx];
  if (!plot.hasBugs && !plot.hasWeeds) {
    throw new Error("NO_PEST_PRESENT:" + plotId);
  }

  const bugsCleared = plot.hasBugs;
  const weedsCleared = plot.hasWeeds;
  plots[plotIdx].hasBugs = false;
  plots[plotIdx].hasWeeds = false;
  await updateFarmPlots(ownerPlayerId, plots);

  if (removerPlayerId !== ownerPlayerId) {
    await awardXP(removerPlayerId, 20, "REMOVE_PEST");
    if (Math.random() < 0.5) {
      await addItemToInventory(removerPlayerId, "junk_boot", "Normal", 1);
    }
    await incrementDailyHelpActions(removerPlayerId);
    await sendNotification(ownerPlayerId, "FRIEND_REMOVED_PEST", { plotId });
  }

  return { success: true, bugsCleared, weedsCleared };
}

/**
 * Applies a sabotage pest to another player's GROWING plot with cost, cooldown, and score penalty.
 * @param saboteurId - Player paying for and applying sabotage.
 * @param ownerId - Owner of the target plot.
 * @param plotId - Plot ID to sabotage.
 * @param pestType - Pest type to apply.
 * @returns Sabotage result with applied pest and score delta.
 * @throws INVALID_PEST_TYPE if pestType is not bugs or weeds.
 * @throws PLOT_NOT_FOUND:{plotId} if the target plot is missing.
 * @throws PLOT_NOT_GROWING:{state} if the target plot is not GROWING.
 * @throws PEST_ALREADY_PRESENT:{pestType} if that pest is already present.
 * @throws COOLDOWN_ACTIVE:{N}min if the saboteur recently applied the same pest to this owner.
 * @throws DB_ERROR when player queries or updates fail.
 * @throws CONFIG_KEY_NOT_FOUND when required config rows are missing.
 * @throws CROP_NOT_FOUND:{cropId} when the plot's crop config is missing.
 */
export async function plantPestBySabotage(
  saboteurId: string,
  ownerId: string,
  plotId: string,
  pestType: "bugs" | "weeds",
): Promise<SabotageResult> {
  if (pestType !== "bugs" && pestType !== "weeds") {
    throw new Error("INVALID_PEST_TYPE");
  }

  const cfg = await getConfigs([
    "SABOTAGE_COST",
    "SABOTAGE_COOLDOWN",
    "SCORE_SABOTAGE_PENALTY",
  ]);
  const cost = Number(cfg["SABOTAGE_COST"]);
  const cooldown = Number(cfg["SABOTAGE_COOLDOWN"]);
  const penalty = Number(cfg["SCORE_SABOTAGE_PENALTY"]);

  const { data: owner, error: ownerError } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .select("farm_plots")
      .eq("id", ownerId)
      .single();

  if (ownerError) throw new Error("DB_ERROR:" + ownerError.message);
  if (!owner) throw new Error("DB_ERROR:missing player");

  const plots = owner.farm_plots;
  const plotIdx = plots.findIndex((plot) => plot.plotId === plotId);
  if (plotIdx === -1) throw new Error("PLOT_NOT_FOUND:" + plotId);

  const plot = plots[plotIdx];
  const cropConfig = await getCropConfig(plot.cropId!);
  const consts = await fetchPlotConstants();
  const now = Math.floor(Date.now() / 1000);
  const state = calculatePlotState(plot, now, cropConfig, consts);
  if (state.state !== "GROWING") {
    throw new Error("PLOT_NOT_GROWING:" + state.state);
  }

  if (pestType === "bugs" && plot.hasBugs) {
    throw new Error("PEST_ALREADY_PRESENT:bugs");
  }
  if (pestType === "weeds" && plot.hasWeeds) {
    throw new Error("PEST_ALREADY_PRESENT:weeds");
  }

  const { data: saboteur, error: saboteurError } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .select("sabotage_log, neighbour_score, coins")
      .eq("id", saboteurId)
      .single();

  if (saboteurError) throw new Error("DB_ERROR:" + saboteurError.message);
  if (!saboteur) throw new Error("DB_ERROR:missing player");

  const log = saboteur.sabotage_log ?? [];
  const existing = log.find((entry) =>
    entry.targetId === ownerId && entry.pestType === pestType &&
    now - entry.timestamp < cooldown
  );
  if (existing) {
    const remaining = Math.ceil((cooldown - (now - existing.timestamp)) / 60);
    throw new Error("COOLDOWN_ACTIVE:" + remaining + "min");
  }

  const txType = pestType === "bugs" ? "SABOTAGE_BUG" : "SABOTAGE_WEED";
  await debitCoins(saboteurId, cost, txType, crypto.randomUUID(), {
    plotId,
    ownerId,
  });

  if (pestType === "bugs") plots[plotIdx].hasBugs = true;
  else plots[plotIdx].hasWeeds = true;
  await updateFarmPlots(ownerId, plots);

  log.push({ targetId: ownerId, pestType, timestamp: now });
  const newScore = Math.max(0, (saboteur.neighbour_score ?? 50) + penalty);
  const { error: updateError } = await (supabaseAdmin.from(
    "players",
  ) as PlayerQuery)
    .update({ sabotage_log: log, neighbour_score: newScore })
    .eq("id", saboteurId);

  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  await sendNotification(ownerId, "SABOTAGE_APPLIED", {
    plotId,
    pestType,
    anonymous: true,
  });
  return { success: true, pestApplied: pestType, saboteurScoreChange: penalty };
}

/**
 * Starts the regrow cycle on a watered perpetual crop after harvest.
 * @param playerId - Owner of the plot.
 * @param plotId - Plot ID to start regrowing.
 * @returns Regrow result with newly locked yield and steal pool.
 * @throws PLOT_NOT_FOUND:{plotId} if the plot is not in player's farm_plots.
 * @throws PLOT_EMPTY if the plot has no crop.
 * @throws PLOT_NOT_NEEDS_WATER:{plotId} if the plot does not need water.
 * @throws PLOT_NOT_PERPETUAL if the crop is not perpetual.
 * @throws DB_ERROR when player queries or updates fail.
 * @throws CONFIG_KEY_NOT_FOUND when required config rows are missing.
 * @throws CROP_NOT_FOUND:{cropId} when the plot's crop config is missing.
 */
export async function waterForRegrow(
  playerId: string,
  plotId: string,
): Promise<RegrowResult> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .select("farm_plots")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");

  const plots = player.farm_plots;
  const plotIdx = plots.findIndex((plot) => plot.plotId === plotId);
  if (plotIdx === -1) throw new Error("PLOT_NOT_FOUND:" + plotId);

  const plot = plots[plotIdx];
  if (plot.cropId === null) throw new Error("PLOT_EMPTY");
  if (!plot.needsWater) throw new Error("PLOT_NOT_NEEDS_WATER:" + plotId);

  const cropConfig = await getCropConfig(plot.cropId);
  // SPEC_AMBIGUITY: isPerpetual check is called out but not resolved by the spec. This implementation throws PLOT_NOT_PERPETUAL for non-perpetual crops.
  if (!cropConfig.isPerpetual) throw new Error("PLOT_NOT_PERPETUAL");

  const stealPoolPercent = await getConfig("STEAL_POOL_PERCENT") as number;
  const newYield = randomIntInclusive(
    cropConfig.baseYieldMin,
    cropConfig.baseYieldMax,
  );
  const newStealPool = Math.max(1, Math.floor(newYield * stealPoolPercent));
  const now = Math.floor(Date.now() / 1000);

  Object.assign(plots[plotIdx], {
    regrowStartedAt: now,
    isPerpetualRegrowing: true,
    needsWater: false,
    yield: newYield,
    stealPool: newStealPool,
    stealPoolRemaining: newStealPool,
    waterings: 0,
  });
  await updateFarmPlots(playerId, plots);

  return {
    success: true,
    newYield,
    newStealPool,
    regrowTimeSeconds: cropConfig.regrowTimeSeconds,
  };
}

/**
 * Handles HTTP requests for the farm-pests Edge Function.
 * @param request - Incoming Edge Function request with action-specific JSON body.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const action = String(body.action ?? "");
    let result: unknown;

    if (action === "spawnPestCheck") {
      result = await spawnPestCheck(
        String(body.playerId ?? ""),
        String(body.plotId ?? ""),
      );
    } else if (action === "removePest") {
      result = await removePest(
        String(body.removerPlayerId ?? ""),
        String(body.ownerPlayerId ?? ""),
        String(body.plotId ?? ""),
      );
    } else if (action === "plantPestBySabotage") {
      result = await plantPestBySabotage(
        String(body.saboteurId ?? ""),
        String(body.ownerId ?? ""),
        String(body.plotId ?? ""),
        String(body.pestType ?? "") as "bugs" | "weeds",
      );
    } else if (action === "waterForRegrow") {
      result = await waterForRegrow(
        String(body.playerId ?? ""),
        String(body.plotId ?? ""),
      );
    } else {
      throw new Error("INVALID_ACTION");
    }

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

/**
 * Persists a player's farm_plots JSONB column.
 * @param playerId - Player whose farm_plots should be updated.
 * @param plots - Updated plot array.
 * @returns Nothing.
 * @throws DB_ERROR when the update fails.
 */
async function updateFarmPlots(
  playerId: string,
  plots: FarmPlot[],
): Promise<void> {
  const { error } = await (supabaseAdmin.from("players") as PlayerQuery)
    .update({ farm_plots: plots })
    .eq("id", playerId);

  if (error) throw new Error("DB_ERROR:" + error.message);
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
