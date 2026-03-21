import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../repositories/restaurant.repository", () => ({
  restaurantRepository: {
    findByCode: vi.fn(),
  },
}));

import { generateRestaurantCode } from "../restaurant.service";
import { restaurantRepository } from "../../repositories/restaurant.repository";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateRestaurantCode", () => {
  it("generates a 6-character code", async () => {
    vi.mocked(restaurantRepository.findByCode).mockResolvedValue(null);
    const code = await generateRestaurantCode("rest-1");
    expect(code).toHaveLength(6);
  });

  it("uses only allowed characters", async () => {
    vi.mocked(restaurantRepository.findByCode).mockResolvedValue(null);
    const code = await generateRestaurantCode("rest-1");
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("retries when code is already taken", async () => {
    vi.mocked(restaurantRepository.findByCode)
      .mockResolvedValueOnce({ id: "other-rest" } as never) // first code taken
      .mockResolvedValueOnce(null); // second code available

    const code = await generateRestaurantCode("rest-1");
    expect(code).toHaveLength(6);
    expect(restaurantRepository.findByCode).toHaveBeenCalledTimes(2);
  });

  it("accepts code if it belongs to the same restaurant", async () => {
    vi.mocked(restaurantRepository.findByCode).mockResolvedValue({
      id: "rest-1",
    } as never);

    const code = await generateRestaurantCode("rest-1");
    expect(code).toHaveLength(6);
    expect(restaurantRepository.findByCode).toHaveBeenCalledTimes(1);
  });
});
