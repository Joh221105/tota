import { removeItemFromInventory } from "../lib/inventory.ts";
import { ensureSupabaseAdminFromEnv, supabaseAdmin } from "../lib/supabase.ts";

export type InventoryCategory =
  | "crops"
  | "fish"
  | "animal_produce"
  | "processed"
  | "cooked_dishes"
  | "tools";

export interface ExpandResult {
  success: true;
  category: string;
  slotsBefore: number;
  slotsAfter: number;
}

interface ExpansionMaterial {
  category: string;
  slotsToAdd: number;
  maxSlots: number;
}

interface PlayerSlotsRow {
  inventory_slots: Record<string, number>;
}

interface PlayerQuery {
  select(columns: string): PlayerQuery;
  eq(column: string, value: string): PlayerQuery;
  single(): Promise<
    { data: PlayerSlotsRow | null; error: { message: string } | null }
  >;
  update(values: Record<string, unknown>): PlayerQuery;
  then<
    TResult1 = {
      data: PlayerSlotsRow[] | null;
      error: { message: string } | null;
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((
        value: {
          data: PlayerSlotsRow[] | null;
          error: { message: string } | null;
        },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

export const EXPANSION_MAP: Record<string, ExpansionMaterial> = {
  expand_wooden_plank: { category: "crops", slotsToAdd: 5, maxSlots: 200 },
  expand_iron_nail: { category: "processed", slotsToAdd: 5, maxSlots: 120 },
  expand_stone_brick: {
    category: "animal_produce",
    slotsToAdd: 5,
    maxSlots: 80,
  },
  expand_glass_pane: {
    category: "cooked_dishes",
    slotsToAdd: 5,
    maxSlots: 80,
  },
  expand_bronze_hinge: { category: "tools", slotsToAdd: 5, maxSlots: 60 },
  expand_steel_beam: { category: "any", slotsToAdd: 10, maxSlots: 0 },
};

export const CATEGORY_MAX: Record<InventoryCategory, number> = {
  crops: 200,
  fish: 100,
  animal_produce: 80,
  processed: 120,
  cooked_dishes: 80,
  tools: 60,
};

/**
 * Consumes an expansion material to increase inventory slot count.
 * Updates players.inventory_slots JSONB column.
 * @param playerId - Target player UUID.
 * @param materialItemId - Expansion material item ID to consume.
 * @param targetCategory - Required category when using expand_steel_beam.
 * @returns Expansion result with category and before/after slot counts.
 * @throws INVALID_EXPANSION_MATERIAL if materialItemId is not supported.
 * @throws STEEL_BEAM_REQUIRES_CATEGORY if steel beam has no targetCategory.
 * @throws INVALID_CATEGORY if targetCategory is not in CATEGORY_MAX.
 * @throws AT_MAX_CAPACITY:{cat}:{cur} if category is already at max slots.
 * @throws DB_ERROR when a player query fails.
 */
export async function expandInventory(
  playerId: string,
  materialItemId: string,
  targetCategory?: string,
): Promise<ExpandResult> {
  const material = EXPANSION_MAP[materialItemId];
  if (!material) throw new Error("INVALID_EXPANSION_MATERIAL");

  let category: string;
  let maxSlots: number;
  if (materialItemId === "expand_steel_beam") {
    if (!targetCategory) throw new Error("STEEL_BEAM_REQUIRES_CATEGORY");
    if (!(targetCategory in CATEGORY_MAX)) throw new Error("INVALID_CATEGORY");
    category = targetCategory;
    maxSlots = CATEGORY_MAX[targetCategory as InventoryCategory];
  } else {
    category = material.category;
    maxSlots = material.maxSlots;
  }

  const { data: player, error: playerError } =
    await (supabaseAdmin.from("players") as PlayerQuery)
      .select("inventory_slots")
      .eq("id", playerId)
      .single();

  if (playerError) throw new Error("DB_ERROR:" + playerError.message);
  if (!player) throw new Error("DB_ERROR:missing player");

  const currentMax = player.inventory_slots[category];
  if (currentMax >= maxSlots) {
    throw new Error(`AT_MAX_CAPACITY:${category}:${currentMax}`);
  }

  await removeItemFromInventory(playerId, materialItemId, "Normal", 1);

  const slotsAfter = currentMax + material.slotsToAdd;
  const newSlots = { ...player.inventory_slots, [category]: slotsAfter };
  const { error: updateError } = await (supabaseAdmin.from(
    "players",
  ) as PlayerQuery)
    .update({ inventory_slots: newSlots })
    .eq("id", playerId);

  if (updateError) throw new Error("DB_ERROR:" + updateError.message);

  return {
    success: true,
    category,
    slotsBefore: currentMax,
    slotsAfter,
  };
}

/**
 * Handles HTTP requests for the expand-inventory Edge Function.
 * @param request - Incoming Edge Function request with playerId, materialItemId, and optional targetCategory.
 * @returns JSON HTTP response.
 * @throws Never.
 */
export async function handleRequest(request: Request): Promise<Response> {
  try {
    await ensureSupabaseAdminFromEnv();
    const body = await request.json();
    const result = await expandInventory(
      String(body.playerId ?? ""),
      String(body.materialItemId ?? ""),
      typeof body.targetCategory === "string" ? body.targetCategory : undefined,
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
