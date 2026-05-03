import { supabaseAdmin } from "./supabase.ts";

interface GameConfigRow {
  key?: string;
  value: string;
}

interface ConfigQuery {
  select(columns: string): ConfigQuery;
  eq(column: string, value: string): ConfigQuery;
  in(
    column: string,
    values: string[],
  ): Promise<{ data: GameConfigRow[] | null; error: { message: string } | null }>;
  maybeSingle(): Promise<
    { data: GameConfigRow | null; error: { message: string } | null }
  >;
}

/**
 * Fetches a single balance constant from the game_config table.
 * @param key - Config key name.
 * @returns Parsed config value.
 * @throws DB_ERROR when the database query fails.
 * @throws CONFIG_KEY_NOT_FOUND when the key does not exist.
 */
export async function getConfig(key: string): Promise<unknown> {
  const { data, error } = await (supabaseAdmin.from("game_config") as ConfigQuery)
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) throw new Error("DB_ERROR:" + error.message);
  if (!data) throw new Error("CONFIG_KEY_NOT_FOUND:" + key);
  return JSON.parse(data.value);
}

/**
 * Fetches multiple config keys in one query to minimise round trips.
 * @param keys - Array of config key names.
 * @returns Record keyed by config key with parsed values.
 * @throws DB_ERROR when the database query fails.
 * @throws CONFIG_KEY_NOT_FOUND when any key is missing.
 */
export async function getConfigs(keys: string[]): Promise<Record<string, unknown>> {
  const { data, error } = await (supabaseAdmin.from("game_config") as ConfigQuery)
    .select("key, value")
    .in("key", keys);

  if (error) throw new Error("DB_ERROR:" + error.message);
  const missing = keys.filter((key) => !data?.find((row) => row.key === key));
  if (missing.length > 0) throw new Error("CONFIG_KEY_NOT_FOUND:" + missing[0]);
  return Object.fromEntries((data ?? []).map((row) => [row.key as string, JSON.parse(row.value)]));
}
