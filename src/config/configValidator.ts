import { GameConfig, GAME_CONFIG } from './gameConfig';

export function validateGameConfig(config: GameConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate Fuels
  for (const [fuelId, fuel] of Object.entries(config.fuels)) {
    if (fuel.baseWholesale <= 0) errors.push(`Fuel ${fuelId}: baseWholesale must be positive.`);
    if (fuel.regionalRetail <= fuel.baseWholesale) errors.push(`Fuel ${fuelId}: regionalRetail must be greater than baseWholesale.`);
    if (fuel.orderMinLiters <= 0) errors.push(`Fuel ${fuelId}: orderMinLiters must be positive.`);
    if (fuel.deliveryFee < 0) errors.push(`Fuel ${fuelId}: deliveryFee cannot be negative.`);
  }

  // Validate Buildings
  for (const [buildingId, building] of Object.entries(config.buildings)) {
    if (building.price < 0) errors.push(`Building ${buildingId}: price cannot be negative.`);
    if (building.size[0] <= 0 || building.size[1] <= 0) errors.push(`Building ${buildingId}: size dimensions must be > 0.`);
  }

  // Validate Levels
  if (config.levels.length < 10) {
    errors.push(`Levels config must contain at least 10 progression levels.`);
  }

  // Validate Economy
  if (config.economy.initialCash <= 0) errors.push('Initial cash must be positive.');
  if (config.economy.initialReputation < 1 || config.economy.initialReputation > 5) {
    errors.push('Initial reputation must be between 1.00 and 5.00.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function getValidatedConfig(customConfig?: Partial<GameConfig>): GameConfig {
  const config = { ...GAME_CONFIG, ...customConfig };
  const validation = validateGameConfig(config);
  if (!validation.valid) {
    console.warn('GameConfig validation warnings:', validation.errors);
    return GAME_CONFIG;
  }
  return config;
}
