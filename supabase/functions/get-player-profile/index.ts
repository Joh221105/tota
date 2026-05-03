import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export interface PublicPlayerProfile {
  playerId: string;
  displayName: string | null;
  level: number;
  michelinStars: number;
  neighbourScore: number;
  neighbourScoreTier: "PILLAR" | "REGULAR" | "FOX" | "OUTLAW";
  equippedPetId: string | null;
  restaurantTier: number;
  thiefStats: {
    totalAttemptsLifetime: number;
    totalSuccessesLifetime: number;
    successRatePercent: number;
    nemesisDisplayName: string | null;
    timesStorenFrom: number;
  };
}

interface PlayerProfileRow {
  id: string;
  display_name: string | null;
  level: number;
  michelin_stars: number;
  neighbour_score: number;
  equipped_pet: string | null;
  restaurant: { tier?: number } | null;
  thief_stats: {
    totalAttemptsLifetime: number;
    totalSuccessesLifetime: number;
    nemesisDisplayName: string | null;
    timesStorenFrom: number;
  };
}

interface PlayerProfileQuery {
  select(columns: string): PlayerProfileQuery;
  eq(column: string, value: string): PlayerProfileQuery;
  maybeSingle(): Promise<
    { data: PlayerProfileRow | null; error: { message: string } | null }
  >;
}

export const PUBLIC_COLUMNS =
  "id, display_name, level, michelin_stars, neighbour_score, equipped_pet, restaurant, thief_stats";

/**
 * Converts a neighbour score into its public tier.
 * @param score - Neighbour score integer.
 * @returns Public neighbour score tier.
 * @throws Never.
 */
export function calculateNeighbourScoreTier(
  score: number,
): "PILLAR" | "REGULAR" | "FOX" | "OUTLAW" {
  if (score >= 80) return "PILLAR";
  if (score >= 40) return "REGULAR";
  if (score >= 15) return "FOX";
  return "OUTLAW";
}

/**
 * Fetches the public profile for a player.
 * @param playerId - Player ID to fetch.
 * @returns Public player profile with no private economy, inventory, or timestamp fields.
 * @throws DB_ERROR when the database query fails.
 * @throws PLAYER_NOT_FOUND when no player exists for playerId.
 */
export async function getPlayerProfile(
  playerId: string,
): Promise<PublicPlayerProfile> {
  const { data, error } =
    await (supabaseAdmin.from("players") as PlayerProfileQuery)
      .select(PUBLIC_COLUMNS)
      .eq("id", playerId)
      .maybeSingle();
  if (error) throw new Error("DB_ERROR:" + error.message);
  if (!data) throw new Error("PLAYER_NOT_FOUND:" + playerId);

  const thiefStats = data.thief_stats;
  const attempts = thiefStats.totalAttemptsLifetime;
  const successes = thiefStats.totalSuccessesLifetime;
  const successRatePercent = attempts > 0
    ? Math.round((successes / attempts) * 1000) / 10
    : 0;

  return {
    playerId: data.id,
    displayName: data.display_name,
    level: data.level,
    michelinStars: data.michelin_stars,
    neighbourScore: data.neighbour_score,
    neighbourScoreTier: calculateNeighbourScoreTier(data.neighbour_score),
    equippedPetId: data.equipped_pet,
    restaurantTier: data.restaurant?.tier ?? 1,
    thiefStats: {
      totalAttemptsLifetime: attempts,
      totalSuccessesLifetime: successes,
      successRatePercent,
      nemesisDisplayName: thiefStats.nemesisDisplayName,
      timesStorenFrom: thiefStats.timesStorenFrom,
    },
  };
}

/**
 * Handles HTTP requests for the get-player-profile Edge Function.
 * @param request - Incoming Edge Function request with playerId in the JSON body.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const result = await getPlayerProfile(String(body.playerId ?? ""));
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
