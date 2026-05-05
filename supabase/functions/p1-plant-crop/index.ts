import { getConfig } from "../_lib/config.ts";
import { getCropConfig } from "../_lib/crops.ts";
import { debitCoins, validateCanAfford } from "../_lib/economy.ts";
import type { FarmPlot } from "../_lib/farm.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../_lib/supabase.ts";

export type { FarmPlot } from "../_lib/farm.ts";

export interface PlantResult {
  success: true;
  plot: FarmPlot;
  coinsDeducted: number;
}

interface PlayerFarmRow {
  farm_plots: FarmPlot[];
  level: number;
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

/**
 * Plants a crop on an empty plot, deducting seed cost and locking yield state.
 * @param playerId - Target player UUID.
 * @param plotId - Farm plot ID to plant into.
 * @param cropId - Crop config ID from game_config.
 * @returns Plant result containing the updated plot and deducted seed cost.
 * @throws PLOT_NOT_FOUND:{plotId} if plotId is not in the player's farm_plots.
 * @throws PLOT_OCCUPIED:{plotId} if the selected plot already has a crop.
 * @throws CROP_NOT_FOUND:{cropId} if cropId is missing or invalid.
 * @throws CROP_NOT_UNLOCKED:{cropId} if the player's level is too low.
 * @throws INSUFFICIENT_FUNDS if the player cannot afford the seed cost.
 * @throws DB_ERROR when a player query fails.
 */
export async function plantCrop(
  playerId: string,
  plotId: string,
  cropId: string,
): Promise<PlantResult> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerFarmQuery)
      .select("farm_plots, level")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");

  const plots = player.farm_plots;
  const plotIdx = plots.findIndex((plot) => plot.plotId === plotId);
  if (plotIdx === -1) throw new Error("PLOT_NOT_FOUND:" + plotId);

  const plot = plots[plotIdx];
  if (plot.cropId !== null) throw new Error("PLOT_OCCUPIED:" + plotId);

  // SPEC_AMBIGUITY: plantCrop throws list mentions INVALID_CROP_ID, but Step 3 and T2.2.12 require CROP_NOT_FOUND from getCropConfig.
  const cropConfig = await getCropConfig(cropId);
  if (player.level < cropConfig.unlockLevel) {
    throw new Error("CROP_NOT_UNLOCKED:" + cropId);
  }

  const affordability = await validateCanAfford(
    playerId,
    cropConfig.seedCostCoins,
  );
  // SPEC_AMBIGUITY: plantCrop spec says validateCanAfford throws INSUFFICIENT_FUNDS, but Task 1.5 helper returns canAfford=false.
  if (!affordability.canAfford) throw new Error("INSUFFICIENT_FUNDS");

  const yieldVal = randomIntInclusive(
    cropConfig.baseYieldMin,
    cropConfig.baseYieldMax,
  );
  const stealPoolPercent = await getConfig("STEAL_POOL_PERCENT") as number;
  const stealPool = Math.max(1, Math.floor(yieldVal * stealPoolPercent));

  await debitCoins(
    playerId,
    cropConfig.seedCostCoins,
    "SEED_PURCHASE",
    crypto.randomUUID(),
    { cropId, plotId },
  );

  const now = Math.floor(Date.now() / 1000);
  plots[plotIdx] = {
    ...plot,
    cropId,
    state: "PLANTED",
    plantedAt: now,
    regrowStartedAt: null,
    yield: yieldVal,
    stealPool,
    stealPoolRemaining: stealPool,
    waterings: 0,
    hasBugs: false,
    hasWeeds: false,
    fertilised: false,
    fertiliserBronzeBoost: 0,
    fertiliserSilverBoost: 0,
    isPerpetualRegrowing: false,
    needsWater: false,
    lastPestCheck: 0,
  };

  const { error: updateError } = await (supabaseAdmin.from(
    "players",
  ) as PlayerFarmQuery)
    .update({ farm_plots: plots })
    .eq("id", playerId);

  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  return {
    success: true,
    plot: plots[plotIdx],
    coinsDeducted: cropConfig.seedCostCoins,
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
 * Handles HTTP requests for the plant-crop Edge Function.
 * @param request - Incoming Edge Function request with playerId, plotId, and cropId.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const result = await plantCrop(
      String(body.playerId ?? ""),
      String(body.plotId ?? ""),
      String(body.cropId ?? ""),
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
