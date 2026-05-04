import { getConfigs } from "../lib/config.ts";
import type { CropConfig } from "../lib/crops.ts";
import {
  calculatePlotState,
  type FarmPlot,
  type PlotConstants,
  type PlotStateResult,
} from "../lib/farm.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export type EnrichedPlot = FarmPlot & PlotStateResult;

export interface FarmStateResponse {
  plots: EnrichedPlot[];
  totalPlots: number;
  plotsReady: number;
  plotsGrowing: number;
  plotsEmpty: number;
  serverTimestamp: number;
}

interface PlayerFarmStateRow {
  farm_plots: FarmPlot[];
  level: number;
}

interface PlayerFarmStateQuery {
  select(columns: string): PlayerFarmStateQuery;
  eq(column: string, value: string): PlayerFarmStateQuery;
  single(): Promise<
    { data: PlayerFarmStateRow | null; error: { message: string } | null }
  >;
}

/**
 * Returns all farm plots with current state calculated.
 * @param playerId - Target player UUID.
 * @returns Farm state response for the Farm tab.
 * @throws DB_ERROR when the player query fails or the player is missing.
 * @throws DB_ERROR when the config query fails.
 * @throws CONFIG_KEY_NOT_FOUND when required config rows are missing.
 */
export async function getFarmState(
  playerId: string,
): Promise<FarmStateResponse> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerFarmStateQuery)
      .select("farm_plots, level")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");

  const plots = player.farm_plots;
  const uniqueCropIds = [
    ...new Set(plots.map((plot) => plot.cropId).filter(Boolean)),
  ] as string[];
  const configKeys = [
    ...uniqueCropIds,
    "STEAL_WINDOW_SECONDS",
    "OFFLINE_CAP_SECONDS",
    "WITHER_TIME_MULTIPLIER",
    "MAX_WATERINGS_PER_CYCLE",
  ];
  const configs = configKeys.length > 0 ? await getConfigs(configKeys) : {};

  const consts: PlotConstants = {
    STEAL_WINDOW_SECONDS: Number(configs["STEAL_WINDOW_SECONDS"] ?? 60),
    OFFLINE_CAP_SECONDS: Number(configs["OFFLINE_CAP_SECONDS"] ?? 57_600),
    WITHER_TIME_MULTIPLIER: Number(configs["WITHER_TIME_MULTIPLIER"] ?? 2.0),
    MAX_WATERINGS_PER_CYCLE: Number(
      configs["MAX_WATERINGS_PER_CYCLE"] ?? 3,
    ),
  };

  const cropConfigMap: Record<string, CropConfig> = {};
  for (const cropId of uniqueCropIds) {
    if (configs[cropId]) {
      const c = configs[cropId] as Record<string, unknown>;
      cropConfigMap[cropId] = {
        cropId,
        displayName: cropId,
        seasonAvailability: "all_seasons",
        itemCategory: "crops",
        growTimeSeconds: Number(c.growTimeSeconds),
        regrowTimeSeconds: c.regrowTimeSeconds != null
          ? Number(c.regrowTimeSeconds)
          : null,
        seedCostCoins: Number(c.seedCostCoins),
        isPerpetual: Boolean(c.isPerpetual),
        unlockLevel: Number(c.unlockLevel),
        baseYieldMin: Number(c.baseYieldMin),
        baseYieldMax: Number(c.baseYieldMax),
      };
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const enriched: EnrichedPlot[] = plots.map((plot) => {
    const cropConfig = plot.cropId ? cropConfigMap[plot.cropId] ?? null : null;
    return { ...plot, ...calculatePlotState(plot, now, cropConfig, consts) };
  });

  return {
    plots: enriched,
    totalPlots: enriched.length,
    plotsReady:
      enriched.filter((plot) =>
        plot.state === "RIPE" || plot.state === "STEALABLE"
      ).length,
    plotsGrowing: enriched.filter((plot) => plot.state === "GROWING").length,
    plotsEmpty: enriched.filter((plot) => plot.state === "EMPTY").length,
    serverTimestamp: now,
  };
}

/**
 * Handles HTTP requests for the get-farm-state Edge Function.
 * @param request - Incoming Edge Function request with playerId.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const result = await getFarmState(String(body.playerId ?? ""));
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
