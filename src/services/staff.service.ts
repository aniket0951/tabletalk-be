import { compare, hash } from "bcryptjs";
import { staffRepository } from "../repositories/staff.repository";

export function validatePin(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) {
    return "PIN must be exactly 4 digits";
  }
  return null;
}

export async function checkPinUniqueness(
  restaurantId: string,
  pin: string,
  excludeStaffId?: string
): Promise<boolean> {
  const staffList = excludeStaffId
    ? await staffRepository.findAllActiveExcept(restaurantId, excludeStaffId)
    : await staffRepository.findAllActive(restaurantId);

  for (const s of staffList) {
    if (await compare(pin, s.pin)) {
      return false; // PIN already in use
    }
  }
  return true; // PIN is unique
}

export async function hashPin(pin: string): Promise<string> {
  return hash(pin, 10);
}

export async function generateEmployeeId(restaurantId: string): Promise<string> {
  const lastStaff = await staffRepository.findLastByRestaurant(restaurantId);
  let nextNum = 1;
  if (lastStaff?.employeeId) {
    const match = lastStaff.employeeId.match(/\d+$/);
    if (match) nextNum = parseInt(match[0], 10) + 1;
  }
  return `EMP${String(nextNum).padStart(3, "0")}`;
}

export async function findStaffByPin(
  restaurantId: string,
  pin: string
): Promise<Awaited<ReturnType<typeof staffRepository.findById>> | null> {
  const allStaff = await staffRepository.findAllActive(restaurantId);
  for (const s of allStaff) {
    if (await compare(pin, s.pin)) {
      return s;
    }
  }
  return null;
}

export const staffService = {
  validatePin,
  checkPinUniqueness,
  hashPin,
  generateEmployeeId,
  findStaffByPin,
};
