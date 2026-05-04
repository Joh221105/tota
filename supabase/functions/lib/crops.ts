import { getConfig, getConfigs } from "./config.ts";

export interface CropConfig {
  cropId: string;
  displayName: string;
  growTimeSeconds: number;
  regrowTimeSeconds: number | null;
  seedCostCoins: number;
  isPerpetual: boolean;
  unlockLevel: number;
  baseYieldMin: number;
  baseYieldMax: number;
  seasonAvailability: string;
  itemCategory: "crops";
}

export const CROP_IDS = [
  "crop_lettuce",
  "crop_tomato",
  "crop_cucumber",
  "crop_onion",
  "crop_wheat",
  "crop_potato",
  "crop_jalapeno",
  "crop_sesame",
  "crop_strawberry",
  "crop_blueberry",
  "crop_herb",
] as const;

/**
 * Converts a crop config game_config value into the canonical CropConfig shape.
 * @param cropId - Crop config key from game_config.
 * @param raw - Parsed game_config value for the crop.
 * @returns Parsed crop config with numeric fields coerced to numbers.
 * @throws Never.
 */
export function parseCropConfig(cropId: string, raw: unknown): CropConfig {
  const config = raw as Record<string, unknown>;
  return {
    cropId,
    displayName: cropId.replace("crop_", "").replace(/_/g, " "),
    growTimeSeconds: Number(config.growTimeSeconds),
    regrowTimeSeconds: config.regrowTimeSeconds != null
      ? Number(config.regrowTimeSeconds)
      : null,
    seedCostCoins: Number(config.seedCostCoins),
    isPerpetual: Boolean(config.isPerpetual),
    unlockLevel: Number(config.unlockLevel),
    baseYieldMin: Number(config.baseYieldMin),
    baseYieldMax: Number(config.baseYieldMax),
    seasonAvailability: "all_seasons",
    itemCategory: "crops",
  };
}

/**
 * Fetches crop config from the game_config table.
 * @param cropId - Crop config key to fetch.
 * @returns Parsed crop config.
 * @throws CROP_NOT_FOUND:{cropId} if cropId is missing from game_config or not in the crop catalog.
 */
export async function getCropConfig(cropId: string): Promise<CropConfig> {
  const raw = await getConfig(cropId).catch(() => {
    throw new Error("CROP_NOT_FOUND:" + cropId);
  });
  if (!CROP_IDS.includes(cropId as typeof CROP_IDS[number])) {
    throw new Error("CROP_NOT_FOUND:" + cropId);
  }
  return parseCropConfig(cropId, raw);
}

/**
 * Fetches all 11 Phase 1 crop configs in one database query.
 * @returns Parsed crop configs in CROP_IDS order.
 * @throws CONFIG_KEY_NOT_FOUND when any crop config row is missing.
 * @throws DB_ERROR when the database query fails.
 */
export async function getAllCropConfigs(): Promise<CropConfig[]> {
  const configs = await getConfigs([...CROP_IDS]);
  return CROP_IDS.map((cropId) => parseCropConfig(cropId, configs[cropId]));
}
