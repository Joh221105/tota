import { getConfigs } from "../_lib/config.ts";
import { parseCropConfig } from "../_lib/crops.ts";
import {
  calculatePlotState,
  type FarmPlot,
  type PlotConstants,
} from "../_lib/farm.ts";
import { addItemToInventory } from "../_lib/inventory.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../_lib/supabase.ts";

export interface FertiliserResult {
  success: true;
  newBronzeBoost: number;
  newSilverBoost: number;
  isFriendApplication: boolean;
  xpAwarded: number;
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
const blockedFriendPairs = new Set<string>();

/**
 * Parses farm constants from game_config values.
 * @param configs - Parsed game_config values keyed by config key.
 * @returns Plot constants for calculatePlotState.
 * @throws Never.
 */
function parseConstants(configs: Record<string, unknown>): PlotConstants {
  return {
    STEAL_WINDOW_SECONDS: Number(configs["STEAL_WINDOW_SECONDS"]),
    OFFLINE_CAP_SECONDS: Number(configs["OFFLINE_CAP_SECONDS"]),
    WITHER_TIME_MULTIPLIER: Number(configs["WITHER_TIME_MULTIPLIER"]),
    MAX_WATERINGS_PER_CYCLE: Number(configs["MAX_WATERINGS_PER_CYCLE"]),
  };
}

/**
 * Records one daily help action for a player.
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
 * Checks whether two players are mutual friends.
 * STUB: replaced by Task 7.1 and always passes unless configured by tests.
 * @param id1 - First player ID.
 * @param id2 - Second player ID.
 * @returns True when players are mutual friends.
 * @throws NOT_FRIENDS when future mutual friend validation fails.
 */
export async function isMutualFriend(
  id1: string,
  id2: string,
): Promise<boolean> {
  await Promise.resolve();
  if (blockedFriendPairs.has(`${id1}:${id2}`)) {
    throw new Error("NOT_FRIENDS");
  }
  return true;
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
 * @param data - Notification data.
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
 * Resets V1 stub call records and friend overrides for tests.
 * @returns Nothing.
 * @throws Never.
 */
export function resetApplyFertiliserStubsForTesting(): void {
  xpAwardCalls.length = 0;
  notificationCalls.length = 0;
  helpActionCalls.length = 0;
  blockedFriendPairs.clear();
}

/**
 * Blocks a friend pair in the V1 friend stub for tests.
 * @param id1 - First player ID.
 * @param id2 - Second player ID.
 * @returns Nothing.
 * @throws Never.
 */
export function blockMutualFriendForTesting(id1: string, id2: string): void {
  blockedFriendPairs.add(`${id1}:${id2}`);
}

/**
 * Returns V1 stub call records for tests.
 * @returns Copies of XP, notification, and help action calls.
 * @throws Never.
 */
export function getApplyFertiliserStubCallsForTesting(): {
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
 * Marks a GROWING plot as fertilised and stores harvest-time grade boosts.
 * @param applicatorPlayerId - Player applying fertiliser.
 * @param ownerPlayerId - Owner of the plot being fertilised.
 * @param plotId - Plot ID to fertilise.
 * @returns Fertiliser result with updated boost values and friend reward summary.
 * @throws PLOT_NOT_FOUND:{plotId} if plotId is not in owner's farm_plots.
 * @throws PLOT_NOT_GROWING:{state} if current plot state is not GROWING.
 * @throws NOT_FRIENDS if applicator and owner are not mutual friends.
 * @throws HELP_ACTIONS_EXHAUSTED if applicator daily help limit is reached.
 * @throws FERTILISER_AT_MAX:{plotId} if either boost would exceed its cap.
 * @throws DB_ERROR when a player query or update fails.
 * @throws CONFIG_KEY_NOT_FOUND when required config rows are missing.
 */
export async function applyFertiliser(
  applicatorPlayerId: string,
  ownerPlayerId: string,
  plotId: string,
): Promise<FertiliserResult> {
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
  // SPEC_AMBIGUITY: Spec says fetch all config at function start in one getConfigs call, while sample code calls getCropConfig separately; this parses crop config from the same getConfigs batch.
  const configKeys = [
    "FERTILISER_BRONZE_BOOST",
    "FERTILISER_SILVER_BOOST",
    "FRIEND_FERTILISER_BRONZE_BOOST",
    "FRIEND_FERTILISER_SILVER_BOOST",
    "MAX_FERTILISER_BRONZE_BOOST",
    "MAX_FERTILISER_SILVER_BOOST",
    "STEAL_WINDOW_SECONDS",
    "OFFLINE_CAP_SECONDS",
    "WITHER_TIME_MULTIPLIER",
    "MAX_WATERINGS_PER_CYCLE",
    ...(plot.cropId ? [plot.cropId] : []),
  ];
  const configs = await getConfigs(configKeys);
  const cropConfig = plot.cropId
    ? parseCropConfig(plot.cropId, configs[plot.cropId])
    : null;
  const consts = parseConstants(configs);
  const stateResult = calculatePlotState(
    plot,
    Math.floor(Date.now() / 1000),
    cropConfig,
    consts,
  );
  if (stateResult.state !== "GROWING") {
    throw new Error("PLOT_NOT_GROWING:" + stateResult.state);
  }

  const isFriendApplication = applicatorPlayerId !== ownerPlayerId;
  if (isFriendApplication) {
    await isMutualFriend(applicatorPlayerId, ownerPlayerId);
    await incrementDailyHelpActions(applicatorPlayerId);
  }

  const bronzeAdd = Number(
    configs[
      isFriendApplication
        ? "FRIEND_FERTILISER_BRONZE_BOOST"
        : "FERTILISER_BRONZE_BOOST"
    ],
  );
  const silverAdd = Number(
    configs[
      isFriendApplication
        ? "FRIEND_FERTILISER_SILVER_BOOST"
        : "FERTILISER_SILVER_BOOST"
    ],
  );
  const newBronze = plot.fertiliserBronzeBoost + bronzeAdd;
  const newSilver = plot.fertiliserSilverBoost + silverAdd;

  if (
    newBronze > Number(configs["MAX_FERTILISER_BRONZE_BOOST"]) ||
    newSilver > Number(configs["MAX_FERTILISER_SILVER_BOOST"])
  ) {
    throw new Error("FERTILISER_AT_MAX:" + plotId);
  }

  plots[plotIdx].fertiliserBronzeBoost = newBronze;
  plots[plotIdx].fertiliserSilverBoost = newSilver;
  plots[plotIdx].fertilised = true;

  const { error: updateError } = await (supabaseAdmin.from(
    "players",
  ) as PlayerFarmQuery)
    .update({ farm_plots: plots })
    .eq("id", ownerPlayerId);

  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  if (isFriendApplication) {
    await awardXP(applicatorPlayerId, 25, "FERTILISE_CROP");
    await addItemToInventory(
      applicatorPlayerId,
      "guest_buff_token",
      "Normal",
      1,
    );
    await sendNotification(ownerPlayerId, "FRIEND_FERTILISED", { plotId });
  }

  return {
    success: true,
    newBronzeBoost: newBronze,
    newSilverBoost: newSilver,
    isFriendApplication,
    xpAwarded: isFriendApplication ? 25 : 0,
  };
}

/**
 * Handles HTTP requests for the apply-fertiliser Edge Function.
 * @param request - Incoming Edge Function request with applicatorPlayerId, ownerPlayerId, and plotId.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const result = await applyFertiliser(
      String(body.applicatorPlayerId ?? ""),
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
