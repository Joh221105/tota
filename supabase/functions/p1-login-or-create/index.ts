import { initialiseNewPlayer } from "../p1-initialise-new-player/index.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../_lib/supabase.ts";

export interface LoginResult {
  sessionToken: string;
  playerId: string;
  isNewPlayer: boolean;
  level: number;
  coins: number;
  displayName: string | null;
}

interface PlayerRow {
  id: string;
  coins: number;
  level: number;
  display_name: string | null;
}

interface AuthUser {
  id: string;
}

interface AuthSession {
  access_token: string;
}

interface PlayerQuery {
  select(columns: string): PlayerQuery;
  eq(column: string, value: string): PlayerQuery;
  maybeSingle(): Promise<
    { data: PlayerRow | null; error: { message: string } | null }
  >;
  single(): Promise<
    { data: PlayerRow | null; error: { message: string } | null }
  >;
  update(values: Record<string, unknown>): PlayerMutationQuery;
}

interface PlayerMutationQuery {
  eq(
    column: string,
    value: string,
  ): Promise<{ data: unknown | null; error: { message: string } | null }>;
}

interface AuthCapableClient {
  auth: {
    admin: {
      createUser(
        input: { email: string; password: string; email_confirm: boolean },
      ): Promise<{
        data: { user: AuthUser };
        error: { message: string } | null;
      }>;
    };
    signInWithPassword(input: { email: string; password: string }): Promise<{
      data: { session: AuthSession | null };
      error: { message: string } | null;
    }>;
  };
}

/**
 * Creates a password-based session for a Supabase auth user.
 * @param authUserId - Supabase auth user ID; used for API parity with the task contract.
 * @param email - Auth email for the device account.
 * @param password - Auth password for the device account.
 * @returns Supabase auth session containing an access token.
 * @throws DB_ERROR when Supabase auth does not return a session.
 */
export async function getSessionForUser(
  authUserId: string,
  email: string,
  password: string,
): Promise<AuthSession> {
  void authUserId;
  const authClient = supabaseAdmin as unknown as AuthCapableClient;
  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new Error("DB_ERROR:" + error.message);
  if (!data.session) throw new Error("DB_ERROR:missing auth session");
  return data.session;
}

/**
 * Creates a Supabase auth user for a device.
 * @param deviceId - iOS identifierForVendor.
 * @returns Supabase auth user.
 * @throws DB_ERROR when Supabase auth user creation fails.
 */
async function createAuthUserForDevice(deviceId: string): Promise<AuthUser> {
  const authClient = supabaseAdmin as unknown as AuthCapableClient;
  const email = `${deviceId}@device.local`;
  const { data, error } = await authClient.auth.admin.createUser({
    email,
    password: deviceId,
    email_confirm: true,
  });
  if (error) throw new Error("DB_ERROR:" + error.message);
  return data.user;
}

/**
 * Logs in or creates a player for this device.
 * Creates a Supabase anonymous auth user, then initialises a player row.
 * @param deviceId - iOS identifierForVendor (non-empty string).
 * @param platform - Platform identifier; only ios is valid in V1.
 * @returns Login result including session token and public player state needed at launch.
 * @throws INVALID_DEVICE_ID if deviceId is empty.
 * @throws INVALID_PLATFORM if platform is not ios.
 * @throws DB_ERROR when a Supabase query or auth call fails.
 */
export async function loginOrCreate(
  deviceId: string,
  platform: string,
): Promise<LoginResult> {
  if (!deviceId) throw new Error("INVALID_DEVICE_ID");
  if (platform !== "ios") throw new Error("INVALID_PLATFORM");

  const email = `${deviceId}@device.local`;
  const existing = await (supabaseAdmin.from("players") as PlayerQuery)
    .select("id, coins, level, display_name")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (existing.error) throw new Error("DB_ERROR:" + existing.error.message);
  if (existing.data) {
    const authUser = await createAuthUserForDevice(deviceId);
    const session = await getSessionForUser(authUser.id, email, deviceId);
    return {
      sessionToken: session.access_token,
      playerId: existing.data.id,
      isNewPlayer: false,
      level: existing.data.level,
      coins: existing.data.coins,
      displayName: existing.data.display_name,
    };
  }

  const result = await initialiseNewPlayer(deviceId);
  const player = await (supabaseAdmin.from("players") as PlayerQuery)
    .select("id, coins, level, display_name")
    .eq("id", result.playerId)
    .single();
  if (player.error) throw new Error("DB_ERROR:" + player.error.message);
  if (!player.data) throw new Error("DB_ERROR:missing player");

  const authUser = await createAuthUserForDevice(deviceId);
  const updateResult = await (supabaseAdmin.from("players") as PlayerQuery)
    .update({ auth_user_id: authUser.id })
    .eq("id", result.playerId);
  if (updateResult.error) {
    throw new Error("DB_ERROR:" + updateResult.error.message);
  }

  const session = await getSessionForUser(authUser.id, email, deviceId);
  return {
    sessionToken: session.access_token,
    playerId: result.playerId,
    isNewPlayer: true,
    level: player.data.level,
    coins: player.data.coins,
    displayName: null,
  };
}

/**
 * Handles HTTP requests for the login-or-create Edge Function.
 * @param request - Incoming Edge Function request with deviceId and platform in the JSON body.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const result = await loginOrCreate(
      String(body.deviceId ?? ""),
      String(body.platform ?? ""),
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
