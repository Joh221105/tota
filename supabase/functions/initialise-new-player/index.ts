import { getConfig } from "../lib/config.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export interface FarmPlot {
  plotId: string;
  cropId: string | null;
  state: "EMPTY";
  plantedAt: number;
  regrowStartedAt: number | null;
  yield: number;
  stealPool: number;
  stealPoolRemaining: number;
  waterings: number;
  hasBugs: boolean;
  hasWeeds: boolean;
  fertilised: boolean;
  fertiliserBronzeBoost: number;
  fertiliserSilverBoost: number;
  isPerpetualRegrowing: boolean;
  needsWater: boolean;
  lastPestCheck: number;
}

export interface InitialiseResult {
  success: true;
  playerId: string;
  initialisedAt: number | null;
  wasAlreadyInitialised: boolean;
}

interface PlayerLookupRow {
  id: string;
  coins: number;
}

interface PlayerInsertRow {
  id: string;
}

interface PlayerQuery {
  select(columns: string): PlayerQuery;
  eq(column: string, value: string): PlayerQuery;
  maybeSingle(): Promise<{ data: PlayerLookupRow | null; error: { message: string } | null }>;
  insert(values: Record<string, unknown>): PlayerInsertQuery;
}

interface PlayerInsertQuery {
  select(columns: string): PlayerInsertQuery;
  single(): Promise<{ data: PlayerInsertRow | null; error: { message: string } | null }>;
}

/**
 * Builds the default six empty farm plots for a newly initialised player.
 * @param count - Number of plots to create.
 * @returns Array of empty farm plot objects.
 * @throws Never.
 */
export function buildInitialFarmPlots(count = 6): FarmPlot[] {
  return Array.from({ length: count }, (_, index) => ({
    plotId: `plot_${index + 1}`,
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
  }));
}

/**
 * Idempotently creates a player row for a device ID.
 * @param deviceId - Stable device identifier for the player.
 * @returns Initialise result containing the player ID and idempotency flag.
 * @throws DB_ERROR when a Supabase query fails.
 */
export async function initialiseNewPlayer(deviceId: string): Promise<InitialiseResult> {
  const existing = await (supabaseAdmin.from("players") as PlayerQuery)
    .select("id, coins")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (existing.error) throw new Error("DB_ERROR:" + existing.error.message);
  if (existing.data) {
    return {
      success: true,
      playerId: existing.data.id,
      initialisedAt: null,
      wasAlreadyInitialised: true,
    };
  }

  const starterCoins = await getConfig("STARTER_COINS") as number;
  const farmPlots = buildInitialFarmPlots();

  const { data, error } = await (supabaseAdmin.from("players") as PlayerQuery)
    .insert({
      device_id: deviceId,
      coins: starterCoins,
      farm_plots: farmPlots,
    })
    .select("id")
    .single();

  if (error) throw new Error("DB_ERROR:" + error.message);
  if (!data) throw new Error("DB_ERROR:missing inserted player");

  return {
    success: true,
    playerId: data.id,
    initialisedAt: Date.now(),
    wasAlreadyInitialised: false,
  };
}

/**
 * Handles HTTP requests for the initialise-new-player Edge Function.
 * @param request - Incoming Edge Function request with a JSON body containing deviceId.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const result = await initialiseNewPlayer(String(body.deviceId ?? ""));
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
