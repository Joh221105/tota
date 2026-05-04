import type { CropConfig } from "./crops.ts";

export type PlotState =
  | "EMPTY"
  | "PLANTED"
  | "GROWING"
  | "RIPE"
  | "STEALABLE"
  | "WITHERED"
  | "NEEDS_WATER";

export interface FarmPlot {
  plotId: string;
  cropId: string | null;
  state: PlotState;
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

export interface PlotConstants {
  STEAL_WINDOW_SECONDS: number;
  OFFLINE_CAP_SECONDS: number;
  WITHER_TIME_MULTIPLIER: number;
  MAX_WATERINGS_PER_CYCLE: number;
}

export interface PlotStateResult {
  state: PlotState;
  timeRemainingSeconds: number;
  isStealable: boolean;
  isWithered: boolean;
  stealPoolRemaining: number;
  yieldMultiplier: number;
  canWater: boolean;
  effectiveGrowTime: number;
}

/**
 * Derives a farm plot's ephemeral state from stored plot data, server time, crop config, and constants.
 * PURE FUNCTION: this performs zero database calls and makes no persistent writes.
 * @param plot - Stored farm plot from players.farm_plots.
 * @param currentTimestamp - Current server Unix timestamp in seconds.
 * @param cropConfig - Crop config for plot.cropId, or null for missing config.
 * @param consts - Farm state constants loaded before calling this function.
 * @returns Derived plot state result for read-time farm display and actions.
 * @throws Never.
 */
export function calculatePlotState(
  plot: FarmPlot,
  currentTimestamp: number,
  cropConfig: CropConfig | null,
  consts: PlotConstants,
): PlotStateResult {
  if (!plot.cropId || !cropConfig) {
    return {
      state: "EMPTY",
      timeRemainingSeconds: 0,
      isStealable: false,
      isWithered: false,
      stealPoolRemaining: 0,
      yieldMultiplier: 1.0,
      canWater: false,
      effectiveGrowTime: 0,
    };
  }

  if (plot.needsWater) {
    return {
      state: "NEEDS_WATER",
      timeRemainingSeconds: 0,
      isStealable: false,
      isWithered: false,
      stealPoolRemaining: plot.stealPoolRemaining,
      yieldMultiplier: plot.hasBugs ? 0.5 : 1.0,
      canWater: true,
      effectiveGrowTime: 0,
    };
  }

  const startTs = plot.isPerpetualRegrowing
    ? plot.regrowStartedAt!
    : plot.plantedAt;
  // SPEC_AMBIGUITY: Behavior is not specified when isPerpetualRegrowing is true but regrowStartedAt or regrowTimeSeconds is null.
  const growTime = plot.isPerpetualRegrowing
    ? cropConfig.regrowTimeSeconds!
    : cropConfig.growTimeSeconds;
  const effectiveGrowTime = plot.hasWeeds
    ? Math.floor(growTime * 1.25)
    : growTime;
  const elapsed = currentTimestamp - startTs;

  if (elapsed < effectiveGrowTime) {
    return {
      state: "GROWING",
      timeRemainingSeconds: effectiveGrowTime - elapsed,
      isStealable: false,
      isWithered: false,
      stealPoolRemaining: plot.stealPoolRemaining,
      yieldMultiplier: plot.hasBugs ? 0.5 : 1.0,
      canWater: plot.waterings < consts.MAX_WATERINGS_PER_CYCLE,
      effectiveGrowTime,
    };
  }

  if (elapsed < effectiveGrowTime + consts.STEAL_WINDOW_SECONDS) {
    return {
      state: "RIPE",
      timeRemainingSeconds: 0,
      isStealable: false,
      isWithered: false,
      stealPoolRemaining: plot.stealPoolRemaining,
      yieldMultiplier: plot.hasBugs ? 0.5 : 1.0,
      canWater: false,
      effectiveGrowTime,
    };
  }

  const witherTime = effectiveGrowTime * consts.WITHER_TIME_MULTIPLIER;
  const cappedElapsed = Math.min(
    elapsed,
    consts.OFFLINE_CAP_SECONDS + effectiveGrowTime,
  );
  const isWithered = cappedElapsed >= witherTime;
  const witherMult = isWithered ? 0.5 : 1.0;
  const bugMult = plot.hasBugs ? 0.5 : 1.0;
  const yieldMultiplier = witherMult * bugMult;

  if (isWithered) {
    return {
      state: "WITHERED",
      timeRemainingSeconds: 0,
      isStealable: false,
      isWithered: true,
      stealPoolRemaining: plot.stealPoolRemaining,
      yieldMultiplier,
      canWater: false,
      effectiveGrowTime,
    };
  }

  if (plot.stealPoolRemaining <= 0) {
    return {
      state: "RIPE",
      timeRemainingSeconds: 0,
      isStealable: false,
      isWithered: false,
      stealPoolRemaining: 0,
      yieldMultiplier,
      canWater: false,
      effectiveGrowTime,
    };
  }

  return {
    state: "STEALABLE",
    timeRemainingSeconds: 0,
    isStealable: true,
    isWithered: false,
    stealPoolRemaining: plot.stealPoolRemaining,
    yieldMultiplier,
    canWater: false,
    effectiveGrowTime,
  };
}
