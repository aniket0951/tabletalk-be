import { restaurantRepository } from "../repositories/restaurant.repository";

export async function generateRestaurantCode(restaurantId: string): Promise<string> {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function generateCode(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[bytes[i] % chars.length];
    }
    return code;
  }

  let code = generateCode();
  let attempts = 0;
  while (attempts < 10) {
    const existing = await restaurantRepository.findByCode(code);
    if (!existing || existing.id === restaurantId) break;
    code = generateCode();
    attempts++;
  }

  return code;
}

export const restaurantService = {
  generateRestaurantCode,
};
