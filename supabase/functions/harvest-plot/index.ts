import { getConfigs } from "../lib/config.ts";
import { type CropConfig, parseCropConfig } from "../lib/crops.ts";
import {
  calculatePlotState,
  type FarmPlot,
  type PlotConstants,
} from "../lib/farm.ts";
import { addItemToInventory } from "../lib/inventory.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export interface HarvestItem {
  itemId: string;
  grade: string;
  quantity: number;
}

export interface HarvestResult {
  success: true;
  itemsHarvested: HarvestItem[];
  itemsFailedDueToFullInventory: HarvestItem[];
  xpAwarded: number;
  yieldPenalties: {
    withered: boolean;
    bugs: boolean;
  };
  plotTransition: "EMPTY" | "NEEDS_WATER";
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

interface PlayerFarmRow {
  farm_plots: FarmPlot[];
  skills?: {
    farming?: {
      level?: number;
    };
  };
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
const skillXpAwardCalls: SkillXpAwardCall[] = [];
let rollGradeImpl: (...args: unknown[]) => string = () => "Normal";

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
 * Returns crop harvest XP from crop duration and perpetual status.
 * @param cropConfig - Crop config used for the harvested plot.
 * @returns XP amount awarded for harvesting the crop.
 * @throws Never.
 */
export function getCropXP(cropConfig: CropConfig): number {
  if (cropConfig.isPerpetual) return 12;
  if (cropConfig.growTimeSeconds <= 7_200) return 10;
  if (cropConfig.growTimeSeconds <= 21_600) return 18;
  return 30;
}

/**
 * Rolls one harvested unit's grade.
 * STUB: replaced by Task 2.8.
 * @param args - Future rollGrade arguments.
 * @returns The rolled grade; V1 stub returns Normal.
 * @throws Never.
 */
export function rollGrade(...args: unknown[]): string {
  return rollGradeImpl(...args);
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
 * Resets V1 stub call records and rollGrade override for tests.
 * @returns Nothing.
 * @throws Never.
 */
export function resetHarvestPlotStubsForTesting(): void {
  xpAwardCalls.length = 0;
  skillXpAwardCalls.length = 0;
  rollGradeImpl = () => "Normal";
}

/**
 * Overrides the rollGrade stub for tests.
 * @param implementation - Roll grade function to use until reset.
 * @returns Nothing.
 * @throws Never.
 */
export function setRollGradeForTesting(
  implementation: (...args: unknown[]) => string,
): void {
  rollGradeImpl = implementation;
}

/**
 * Returns V1 stub call records for tests.
 * @returns Copies of XP and skill XP calls.
 * @throws Never.
 */
export function getHarvestPlotStubCallsForTesting(): {
  xpAwards: XpAwardCall[];
  skillXpAwards: SkillXpAwardCall[];
} {
  return {
    xpAwards: [...xpAwardCalls],
    skillXpAwards: [...skillXpAwardCalls],
  };
}

/**
 * Calculates harvestable yield, rolls grades, adds crops to inventory, awards XP, and resets or transitions the plot.
 * @param playerId - Player harvesting the plot.
 * @param plotId - Plot ID to harvest.
 * @returns Harvest result with item and plot transition details.
 * @throws PLOT_NOT_FOUND:{plotId} if plotId is not in player's farm_plots.
 * @throws PLOT_EMPTY if cropId is null or the plot needs water per step 2.
 * @throws PLOT_NOT_READY if the plot is still growing.
 * @throws DB_ERROR when a player query or update fails.
 * @throws CONFIG_KEY_NOT_FOUND when required config rows are missing.
 */
export async function harvestPlot(
  playerId: string,
  plotId: string,
): Promise<HarvestResult> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerFarmQuery)
      .select("farm_plots, skills")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");

  const plots = player.farm_plots;
  const plotIdx = plots.findIndex((plot) => plot.plotId === plotId);
  if (plotIdx === -1) throw new Error("PLOT_NOT_FOUND:" + plotId);

  const plot = plots[plotIdx];
  if (plot.cropId === null) throw new Error("PLOT_EMPTY");

  const configKeys = [
    "WITHER_YIELD_MULTIPLIER",
    "BUG_YIELD_PENALTY",
    "STEAL_WINDOW_SECONDS",
    "OFFLINE_CAP_SECONDS",
    "WITHER_TIME_MULTIPLIER",
    "MAX_WATERINGS_PER_CYCLE",
    plot.cropId,
  ];
  const configs = await getConfigs(configKeys);
  const cropConfig = parseCropConfig(plot.cropId, configs[plot.cropId]);
  const consts = parseConstants(configs);
  const stateResult = calculatePlotState(
    plot,
    Math.floor(Date.now() / 1000),
    cropConfig,
    consts,
  );
  if (stateResult.state === "GROWING") throw new Error("PLOT_NOT_READY");
  // SPEC_AMBIGUITY: Top-level throws list says NEEDS_WATER should throw PLOT_NOT_READY, but Step 2 requires PLOT_EMPTY.
  if (stateResult.state === "NEEDS_WATER") throw new Error("PLOT_EMPTY");

  const yieldPenalties = {
    withered: stateResult.isWithered,
    bugs: plot.hasBugs,
  };
  const stolen = plot.stealPool - plot.stealPoolRemaining;
  let available = plot.yield - stolen;
  if (stateResult.isWithered) {
    available = Math.floor(
      available * Number(configs["WITHER_YIELD_MULTIPLIER"]),
    );
  }
  if (plot.hasBugs) {
    available = Math.floor(available * Number(configs["BUG_YIELD_PENALTY"]));
  }
  available = Math.max(1, available);

  const farmingSkillLevel = player.skills?.farming?.level ?? 0;
  const gradeMap = new Map<string, number>();
  for (let index = 0; index < available; index += 1) {
    const grade = rollGrade(plot.cropId, plot, farmingSkillLevel);
    gradeMap.set(grade, (gradeMap.get(grade) ?? 0) + 1);
  }

  const itemsHarvested: HarvestItem[] = [];
  const itemsFailed: HarvestItem[] = [];
  for (const [grade, quantity] of gradeMap.entries()) {
    try {
      await addItemToInventory(playerId, plot.cropId, grade, quantity);
      itemsHarvested.push({ itemId: plot.cropId, grade, quantity });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("INVENTORY_FULL")) {
        itemsFailed.push({ itemId: plot.cropId, grade, quantity });
      } else {
        throw error;
      }
    }
  }

  const xp = getCropXP(cropConfig);
  await awardXP(playerId, xp, "HARVEST_CROP");
  await awardSkillXP(playerId, "farming", xp);

  if (cropConfig.isPerpetual) {
    Object.assign(plots[plotIdx], {
      needsWater: true,
      isPerpetualRegrowing: false,
      hasBugs: false,
      hasWeeds: false,
      fertilised: false,
      fertiliserBronzeBoost: 0,
      fertiliserSilverBoost: 0,
      waterings: 0,
      stealPool: 0,
      stealPoolRemaining: 0,
      yield: 0,
    });
  } else {
    Object.assign(plots[plotIdx], {
      cropId: null,
      state: "EMPTY",
      plantedAt: 0,
      regrowStartedAt: null,
      yield: 0,
      stealPool: 0,
      stealPoolRemaining: 0,
      waterings: 0,
      hasBugs: false,
      hasWeeds: false,
      fertilised: false,
      fertiliserBronzeBoost: 0,
      fertiliserSilverBoost: 0,
      isPerpetualRegrowing: false,
      needsWater: false,
      lastPestCheck: 0,
    });
  }

  const { error: updateError } = await (supabaseAdmin.from(
    "players",
  ) as PlayerFarmQuery)
    .update({ farm_plots: plots })
    .eq("id", playerId);

  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  return {
    success: true,
    itemsHarvested,
    itemsFailedDueToFullInventory: itemsFailed,
    xpAwarded: xp,
    yieldPenalties,
    plotTransition: cropConfig.isPerpetual ? "NEEDS_WATER" : "EMPTY",
  };
}

/**
 * Handles HTTP requests for the harvest-plot Edge Function.
 * @param request - Incoming Edge Function request with playerId and plotId.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const result = await harvestPlot(
      String(body.playerId ?? ""),
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
