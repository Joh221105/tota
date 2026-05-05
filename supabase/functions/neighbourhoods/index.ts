import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export interface AssignmentResult {
  alreadyAssigned?: true;
  success?: true;
  neighbourhoodId?: string;
  memberCount?: number;
}

export interface RotationResult {
  neighbourhoodsProcessed: number;
  playersRemoved: number;
}

interface PlayerNeighbourhoodRow {
  id?: string;
  neighbourhood_id: string | null;
}

interface FriendshipRow {
  friend_id: string;
}

interface NeighbourhoodRow {
  id: string;
  member_count: number;
}

interface PlayerQuery {
  select(columns: string): PlayerQuery;
  eq(column: string, value: string): PlayerQuery;
  in(column: string, values: string[]): PlayerQuery;
  not(column: string, operator: string, value: unknown): PlayerQuery;
  lt(column: string, value: number): PlayerQuery;
  update(values: Record<string, unknown>): PlayerQuery;
  single(): Promise<
    { data: PlayerNeighbourhoodRow | null; error: { message: string } | null }
  >;
  then<
    TResult1 = {
      data: PlayerNeighbourhoodRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: PlayerNeighbourhoodRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface FriendshipQuery {
  select(columns: string): FriendshipQuery;
  eq(column: string, value: string): FriendshipQuery;
  then<
    TResult1 = {
      data: FriendshipRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: FriendshipRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface NeighbourhoodQuery {
  select(columns: string): NeighbourhoodQuery;
  eq(column: string, value: string): NeighbourhoodQuery;
  lt(column: string, value: number): NeighbourhoodQuery;
  order(column: string, options: { ascending: boolean }): NeighbourhoodQuery;
  limit(count: number): NeighbourhoodQuery;
  insert(values: Record<string, unknown>): NeighbourhoodQuery;
  single(): Promise<
    { data: NeighbourhoodRow | null; error: { message: string } | null }
  >;
  then<
    TResult1 = {
      data: NeighbourhoodRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: NeighbourhoodRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface NeighbourhoodMemberQuery {
  insert(values: Record<string, unknown>): NeighbourhoodMemberQuery;
  delete(): NeighbourhoodMemberQuery;
  eq(column: string, value: string): NeighbourhoodMemberQuery;
  then<
    TResult1 = { data: unknown[] | null; error: { message: string } | null },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: { data: unknown[] | null; error: { message: string } | null },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

const NEIGHBOURHOOD_MAX_MEMBERS = 80;
const INACTIVE_THRESHOLD_SECONDS = 7 * 24 * 3600;

/**
 * Assigns an unassigned player to a neighbourhood, preferring the neighbourhood shared by most friends with space.
 * @param playerId - Player to assign.
 * @returns Assignment result, or alreadyAssigned when the player already has a neighbourhood.
 * @throws DB_ERROR when any database operation fails.
 */
export async function assignToNeighbourhood(
  playerId: string,
): Promise<AssignmentResult> {
  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .select("neighbourhood_id")
      .eq("id", playerId)
      .single();
  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (player?.neighbourhood_id) return { alreadyAssigned: true };

  let chosenId = await chooseFriendNeighbourhood(playerId);
  if (!chosenId) chosenId = await chooseAvailableNeighbourhood();
  if (!chosenId) chosenId = await createNeighbourhood();

  const { error: memberError } = await (supabaseAdmin.from(
    "neighbourhood_members",
  ) as NeighbourhoodMemberQuery)
    .insert({ neighbourhood_id: chosenId, player_id: playerId });
  if (memberError) throw new Error("DB_ERROR:" + memberError.message);

  await incrementMemberCount(chosenId);

  const { error: updatePlayerError } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .update({ neighbourhood_id: chosenId })
      .eq("id", playerId);
  if (updatePlayerError) {
    throw new Error("DB_ERROR:" + updatePlayerError.message);
  }

  const memberCount = await getNeighbourhoodMemberCount(chosenId);
  return {
    success: true,
    neighbourhoodId: chosenId,
    memberCount,
  };
}

/**
 * Updates a player's last active timestamp to the current Unix second.
 * @param playerId - Player to mark active.
 * @returns Nothing.
 * @throws DB_ERROR when the update fails.
 */
export async function updateLastActive(playerId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const { error } = await (supabaseAdmin.from("players") as PlayerQuery)
    .update({ last_active_timestamp: now })
    .eq("id", playerId);
  if (error) throw new Error("DB_ERROR:" + error.message);
}

/**
 * Removes inactive players from neighbourhood membership.
 * @returns Rotation summary containing removed player count.
 * @throws DB_ERROR when any database operation fails.
 */
export async function runMonthlyRotation(): Promise<RotationResult> {
  const cutoff = Math.floor(Date.now() / 1000) - INACTIVE_THRESHOLD_SECONDS;
  const { data: inactive, error } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .select("id,neighbourhood_id")
      .not("neighbourhood_id", "is", null)
      .lt("last_active_timestamp", cutoff);
  if (error) throw new Error("DB_ERROR:" + error.message);

  for (const player of inactive ?? []) {
    if (!player.id || !player.neighbourhood_id) continue;
    const { error: deleteError } = await (supabaseAdmin.from(
      "neighbourhood_members",
    ) as NeighbourhoodMemberQuery)
      .delete()
      .eq("neighbourhood_id", player.neighbourhood_id)
      .eq("player_id", player.id);
    if (deleteError) throw new Error("DB_ERROR:" + deleteError.message);

    await decrementMemberCount(player.neighbourhood_id);

    const { error: updateError } =
      await (supabaseAdmin.from("players") as PlayerQuery)
        .update({ neighbourhood_id: null })
        .eq("id", player.id);
    if (updateError) throw new Error("DB_ERROR:" + updateError.message);
  }

  return {
    neighbourhoodsProcessed: 0,
    playersRemoved: inactive?.length ?? 0,
  };
}

/**
 * Handles HTTP requests for the neighbourhoods Edge Function.
 * @param request - Incoming request with action-specific JSON fields.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const action = String(body.action ?? "");

    if (action === "assignToNeighbourhood") {
      return Response.json(
        await assignToNeighbourhood(String(body.playerId ?? "")),
      );
    }
    if (action === "updateLastActive") {
      await updateLastActive(String(body.playerId ?? ""));
      return Response.json({ success: true });
    }
    if (action === "runMonthlyRotation") {
      return Response.json(await runMonthlyRotation());
    }

    throw new Error("UNKNOWN_ACTION");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ success: false, error: message }, { status: 400 });
  }
}

/**
 * Chooses a non-full neighbourhood from the player's friends by descending friend count.
 * @param playerId - Player being assigned.
 * @returns Chosen neighbourhood id or null.
 * @throws DB_ERROR when a database query fails.
 */
async function chooseFriendNeighbourhood(
  playerId: string,
): Promise<string | null> {
  const { data: friends, error: friendsError } =
    await (supabaseAdmin.from("friendships") as FriendshipQuery)
      .select("friend_id")
      .eq("player_id", playerId);
  if (friendsError) throw new Error("DB_ERROR:" + friendsError.message);
  if (!friends?.length) return null;

  const friendIds = friends.map((friend) => friend.friend_id);
  const { data: friendPlayers, error: friendPlayersError } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .select("neighbourhood_id")
      .in("id", friendIds);
  if (friendPlayersError) {
    throw new Error("DB_ERROR:" + friendPlayersError.message);
  }

  const tally: Record<string, number> = {};
  for (const friend of friendPlayers ?? []) {
    if (friend.neighbourhood_id) {
      tally[friend.neighbourhood_id] = (tally[friend.neighbourhood_id] ?? 0) +
        1;
    }
  }

  const preferred = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!preferred) return null;

  const { data: neighbourhood, error } =
    await (supabaseAdmin.from("neighbourhoods") as NeighbourhoodQuery)
      .select("id,member_count")
      .eq("id", preferred)
      .single();
  if (error) throw new Error("DB_ERROR:" + error.message);
  if (neighbourhood && neighbourhood.member_count < NEIGHBOURHOOD_MAX_MEMBERS) {
    return preferred;
  }
  return null;
}

/**
 * Chooses the most populated available neighbourhood.
 * @returns Chosen neighbourhood id or null.
 * @throws DB_ERROR when the database query fails.
 */
async function chooseAvailableNeighbourhood(): Promise<string | null> {
  const { data: available, error } =
    await (supabaseAdmin.from("neighbourhoods") as NeighbourhoodQuery)
      .select("id,member_count")
      .lt("member_count", NEIGHBOURHOOD_MAX_MEMBERS)
      .order("member_count", { ascending: false })
      .limit(1);
  if (error) throw new Error("DB_ERROR:" + error.message);
  return available?.[0]?.id ?? null;
}

/**
 * Creates a new empty neighbourhood.
 * @returns Created neighbourhood id.
 * @throws DB_ERROR when creation fails.
 */
async function createNeighbourhood(): Promise<string> {
  const { data, error } =
    await (supabaseAdmin.from("neighbourhoods") as NeighbourhoodQuery)
      .insert({})
      .select("id,member_count")
      .single();
  if (error) throw new Error("DB_ERROR:" + error.message);
  if (!data) throw new Error("DB_ERROR:missing neighbourhood");
  return data.id;
}

/**
 * Reads the current member count for one neighbourhood.
 * @param neighbourhoodId - Neighbourhood id.
 * @returns Current member count.
 * @throws DB_ERROR when the query fails.
 */
async function getNeighbourhoodMemberCount(
  neighbourhoodId: string,
): Promise<number> {
  const { data, error } =
    await (supabaseAdmin.from("neighbourhoods") as NeighbourhoodQuery)
      .select("id,member_count")
      .eq("id", neighbourhoodId)
      .single();
  if (error) throw new Error("DB_ERROR:" + error.message);
  if (!data) throw new Error("DB_ERROR:missing neighbourhood");
  return data.member_count;
}

/**
 * Atomically increments neighbourhood member_count through a Postgres RPC.
 * @param neighbourhoodId - Neighbourhood id.
 * @returns Nothing.
 * @throws DB_ERROR when the RPC fails.
 */
async function incrementMemberCount(neighbourhoodId: string): Promise<void> {
  // SPEC_AMBIGUITY: The pseudocode puts supabaseAdmin.rpc(...) inside update({member_count: ...}), but Supabase update values cannot be RPC calls; Task text also says to use a Postgres function for atomicity.
  const { error } = await supabaseAdmin.rpc!("increment_member_count", {
    nb_id: neighbourhoodId,
  }) as RpcResult;
  if (error) throw new Error("DB_ERROR:" + error.message);
}

/**
 * Atomically decrements neighbourhood member_count through a Postgres RPC.
 * @param neighbourhoodId - Neighbourhood id.
 * @returns Nothing.
 * @throws DB_ERROR when the RPC fails.
 */
async function decrementMemberCount(neighbourhoodId: string): Promise<void> {
  // SPEC_AMBIGUITY: The pseudocode puts supabaseAdmin.rpc(...) inside update({member_count: ...}), but Supabase update values cannot be RPC calls; Task text also says to use a Postgres function for atomicity.
  const { error } = await supabaseAdmin.rpc!("decrement_member_count", {
    nb_id: neighbourhoodId,
  }) as RpcResult;
  if (error) throw new Error("DB_ERROR:" + error.message);
}

if (import.meta.main) {
  Deno.serve(handleRequest);
}
