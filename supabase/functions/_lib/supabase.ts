export interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface SupabaseAdminClient {
  from(table: string): unknown;
  rpc?(
    functionName: string,
    params: Record<string, unknown>,
  ): Promise<QueryResult<unknown>>;
}

let configured = false;

/**
 * Placeholder Supabase admin client used until runtime configuration or test injection occurs.
 * @param table - Table name requested by a caller.
 * @returns Never returns because the client is not configured.
 * @throws SUPABASE_ADMIN_NOT_CONFIGURED when used before configuration.
 */
function unavailableFrom(table: string): never {
  throw new Error(`SUPABASE_ADMIN_NOT_CONFIGURED:${table}`);
}

export let supabaseAdmin: SupabaseAdminClient = {
  from: unavailableFrom,
};

/**
 * Loads the Supabase JavaScript SDK only when the Edge runtime needs it.
 * @param specifier - Module specifier for the Supabase SDK.
 * @returns Supabase SDK module.
 * @throws Module resolution errors when the SDK cannot be loaded.
 */
async function importSupabaseSdk(
  specifier: string,
): Promise<
  { createClient: (url: string, key: string, options: unknown) => unknown }
> {
  return await import(specifier);
}

/**
 * Replaces the admin Supabase client for tests.
 * @param client - Mock Supabase admin client.
 * @returns Nothing.
 * @throws Never.
 */
export function setSupabaseAdminForTesting(client: SupabaseAdminClient): void {
  supabaseAdmin = client;
  configured = true;
}

/**
 * Configures the Supabase service-role client from Edge Function environment variables.
 * @returns Nothing.
 * @throws SUPABASE_ENV_MISSING when required environment variables are absent.
 */
export async function ensureSupabaseAdminFromEnv(): Promise<void> {
  if (configured) return;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_ENV_MISSING");
  }

  const { createClient } = await importSupabaseSdk(
    "jsr:" + "@supabase/supabase-js@2",
  );
  supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }) as SupabaseAdminClient;
  configured = true;
}
