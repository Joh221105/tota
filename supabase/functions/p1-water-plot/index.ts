import { getConfigs } from "../_lib/config.ts";
import { parseCropConfig } from "../_lib/crops.ts";
import {
  calculatePlotState,
  type FarmPlot,
  type PlotConstants,
} from "../_lib/farm.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../_lib/supabase.ts";

export interface WaterResult {
  success: true;
  timeReductionSeconds: number;
  newTimeRemainingSeconds: number;
  newWateringsCount: number;
}

export interface XpAwardCall {
  playerId: string;
  amount: number;
  reason: string;
}

export interface NotificationCall {
  playerId: string;
  type: string;
  metadata: Record<string, unknown>;
}

interface PlayerFarmRow {
  farm_plots: FarmPlot[];
}

interface PlayerFarmQuery {
  select(columns: string): PlayerFarmQuery;
  eq(column: string, value: string): PlayerFarmQuery;
  single(): Promise<
    { data: PlayerFarmRow | null; error: { message: string } | null }
  >;
  update(values: Record<string, unknown>): PlayerFarmQuery;
  then<
    TResult1 = {
      data: PlayerFarmRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: PlayerFarmRow[] | null;
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
 * Parses farm constants from game_config values.
 * @param configs - Parsed game_config values keyed by config key.
 * @returns Plot constants for calculatePlotState.
 * @throws Never.
 */
function parseConstants(configs: Record<string, unknown>): PlotConstants {
  return {
    STEAL_WINDOW_SECONDS: Number(configs["STEAL_WINDOW_SECONDS"] ?? 60),
    OFFLINE_CAP_SECONDS: Number(configs["OFFLINE_CAP_SECONDS"] ?? 57_600),
    WITHER_TIME_MULTIPLIER: Number(configs["WITHER_TIME_MULTIPLIER"] ?? 2.0),
    MAX_WATERINGS_PER_CYCLE: Number(
      configs["MAX_WATERINGS_PER_CYCLE"] ?? 3,
    ),
  };
}

/**
 * Records one daily help action for a player.
 * STUB: replaced by Task 7.1.
 * @param playerId - Player performing the help action.
 * @returns Nothing.
 * @throws HELP_ACTIONS_EXHAUSTED when the future daily limit is reached.
 */
export async function incrementDailyHelpActions(
  playerId: string,
): Promise<void> {
  await Promise.resolve();
  helpActionCalls.push(playerId);
}

/**
 * Checks whether two players are mutual friends.
 * STUB: replaced by Task 7.1 and always passes in V1.
 * @param watererPlayerId - Player performing the watering action.
 * @param ownerPlayerId - Owner of the watered plot.
 * @returns Nothing.
 * @throws NOT_FRIENDS when future mutual friend validation fails.
 */
export async function checkMutualFriend(
  watererPlayerId: string,
  ownerPlayerId: string,
): Promise<void> {
  await Promise.resolve();
  void watererPlayerId;
  void ownerPlayerId;
}

/**
 * Awards XP to a player.
 * STUB: replaced by Task 7.1.
 * @param playerId - Player receiving XP.
 * @param amount - XP amount.
 * @param reason - XP reason.
 * @returns Nothing.
 * @throws Never.
 */
export async function awardXP(
  playerId: string,
  amount: number,
  reason: string,
): Promise<void> {
  await Promise.resolve();
  xpAwardCalls.push({ playerId, amount, reason });
}

/**
 * Sends a notification to a player.
 * STUB: replaced by Task 7.1.
 * @param playerId - Player receiving the notification.
 * @param type - Notification type.
 * @param metadata - Notification metadata.
 * @returns Nothing.
 * @throws Never.
 */
export async function sendNotification(
  playerId: string,
  type: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await Promise.resolve();
  notificationCalls.push({ playerId, type, metadata });
}

/**
 * Resets V1 stub call records for tests.
 * @returns Nothing.
 * @throws Never.
 */
export function resetWaterPlotStubsForTesting(): void {
  xpAwardCalls.length = 0;
  notificationCalls.length = 0;
  helpActionCalls.length = 0;
}

/**
 * Returns V1 stub call records for tests.
 * @returns Copies of XP, notification, and help action calls.
 * @throws Never.
 */
export function getWaterPlotStubCallsForTesting(): {
  xpAwards: XpAwardCall[];
  notifications: NotificationCall[];
  helpActions: string[];
} {
  return {
    xpAwards: [...xpAwardCalls],
    notifications: notificationCalls.map((call) => ({
      ...call,
      metadata: { ...call.metadata },
    })),
    helpActions: [...helpActionCalls],
  };
}

/**
 * Waters a GROWING plot to reduce its remaining grow timer by 15%.
 * @param watererPlayerId - Player performing the watering action.
 * @param ownerPlayerId - Owner of the plot being watered.
 * @param plotId - Plot ID to water.
 * @returns Water result with reduction, remaining time, and new watering count.
 * @throws PLOT_NOT_FOUND if plotId is not in owner's farm_plots.
 * @throws PLOT_NOT_GROWING if plot state is not GROWING.
 * @throws MAX_WATERINGS_REACHED if plot.waterings >= MAX_WATERINGS_PER_CYCLE.
 * @throws NOT_FRIENDS if waterer and owner are not mutual friends.
 * @throws HELP_ACTIONS_EXHAUSTED if waterer daily help limit is reached.
 * @throws DB_ERROR when a player query or update fails.
 * @throws CONFIG_KEY_NOT_FOUND when required config rows are missing.
 */
export async function waterPlot(
  watererPlayerId: string,
  ownerPlayerId: string,
  plotId: string,
): Promise<WaterResult> {
  const { data: owner, error: ownerError } =
    await (supabaseAdmin.from("players") as PlayerFarmQuery)
      .select("farm_plots")
      .eq("id", ownerPlayerId)
      .single();

  if (ownerError) throw new Error("DB_ERROR:" + ownerError.message);
  if (!owner) throw new Error("DB_ERROR:missing player");

  const plots = owner.farm_plots;
  const plotIdx = plots.findIndex((plot) => plot.plotId === plotId);
  if (plotIdx === -1) throw new Error("PLOT_NOT_FOUND:" + plotId);

  const plot = plots[plotIdx];
  const configKeys = [
    "STEAL_WINDOW_SECONDS",
    "OFFLINE_CAP_SECONDS",
    "WITHER_TIME_MULTIPLIER",
    "MAX_WATERINGS_PER_CYCLE",
    "WATER_REDUCTION_PERCENT",
    ...(plot.cropId ? [plot.cropId] : []),
  ];
  const configs = await getConfigs(configKeys);
  const cropConfig = plot.cropId
    ? parseCropConfig(plot.cropId, configs[plot.cropId])
    : null;
  const consts = parseConstants(configs);
  const waterReductionPercent = Number(configs["WATER_REDUCTION_PERCENT"]);

  const currentTs = Math.floor(Date.now() / 1000);
  const stateResult = calculatePlotState(plot, currentTs, cropConfig, consts);
  if (stateResult.state !== "GROWING") {
    throw new Error("PLOT_NOT_GROWING:" + stateResult.state);
  }

  if (plot.waterings >= consts.MAX_WATERINGS_PER_CYCLE) {
    throw new Error("MAX_WATERINGS_REACHED");
  }
  if (!cropConfig) throw new Error("PLOT_NOT_GROWING:" + stateResult.state);

  if (watererPlayerId !== ownerPlayerId) {
    await incrementDailyHelpActions(watererPlayerId);
    await checkMutualFriend(watererPlayerId, ownerPlayerId);
  }

  const growTime = plot.isPerpetualRegrowing
    ? cropConfig.regrowTimeSeconds!
    : cropConfig.growTimeSeconds;
  const startTs = plot.isPerpetualRegrowing
    ? plot.regrowStartedAt!
    : plot.plantedAt;
  const timeRemaining = stateResult.effectiveGrowTime - (currentTs - startTs);
  const reduction = Math.max(
    1,
    Math.floor(timeRemaining * waterReductionPercent),
  );

  let updatedStartTs: number;
  if (plot.isPerpetualRegrowing) {
    const minStart = currentTs - growTime + 1;
    updatedStartTs = Math.max(minStart, startTs - reduction);
    plots[plotIdx].regrowStartedAt = updatedStartTs;
  } else {
    const minPlanted = currentTs - growTime + 1;
    updatedStartTs = Math.max(minPlanted, startTs - reduction);
    plots[plotIdx].plantedAt = updatedStartTs;
  }
  plots[plotIdx].waterings += 1;

  const { error: updateError } = await (supabaseAdmin.from(
    "players",
  ) as PlayerFarmQuery)
    .update({ farm_plots: plots })
    .eq("id", ownerPlayerId);

  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  if (watererPlayerId !== ownerPlayerId) {
    await awardXP(watererPlayerId, 15, "WATER_CROP");
    await sendNotification(ownerPlayerId, "FRIEND_WATERED_CROP", { plotId });
  }

  // SPEC_AMBIGUITY: Spec sample computes newTimeRemaining from plantedAt even for perpetual regrow plots; perpetual tests require using regrowStartedAt.
  const newTimeRemaining = stateResult.effectiveGrowTime -
    (currentTs - updatedStartTs);
  return {
    success: true,
    timeReductionSeconds: reduction,
    newTimeRemainingSeconds: Math.max(0, newTimeRemaining),
    newWateringsCount: plots[plotIdx].waterings,
  };
}

/**
 * Handles HTTP requests for the water-plot Edge Function.
 * @param request - Incoming Edge Function request with watererPlayerId, ownerPlayerId, and plotId.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const result = await waterPlot(
      String(body.watererPlayerId ?? ""),
      String(body.ownerPlayerId ?? ""),
      String(body.plotId ?? ""),
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
