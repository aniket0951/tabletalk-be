import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../repositories/staff.repository", () => ({
  staffRepository: {
    findAllActive: vi.fn(),
    findAllActiveExcept: vi.fn(),
    findLastByRestaurant: vi.fn(),
  },
}));

vi.mock("bcryptjs", () => ({
  compare: vi.fn(),
  hash: vi.fn(),
}));

import {
  validatePin,
  checkPinUniqueness,
  hashPin,
  generateEmployeeId,
  findStaffByPin,
} from "../staff.service";
import { staffRepository } from "../../repositories/staff.repository";
import { compare, hash } from "bcryptjs";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validatePin", () => {
  it("returns null for valid 4-digit pin", () => {
    expect(validatePin("1234")).toBeNull();
    expect(validatePin("0000")).toBeNull();
    expect(validatePin("9999")).toBeNull();
  });

  it("returns error for too short pin", () => {
    expect(validatePin("123")).toBe("PIN must be exactly 4 digits");
  });

  it("returns error for too long pin", () => {
    expect(validatePin("12345")).toBe("PIN must be exactly 4 digits");
  });

  it("returns error for non-digit pin", () => {
    expect(validatePin("12ab")).toBe("PIN must be exactly 4 digits");
    expect(validatePin("abcd")).toBe("PIN must be exactly 4 digits");
  });

  it("returns error for empty string", () => {
    expect(validatePin("")).toBe("PIN must be exactly 4 digits");
  });
});

describe("checkPinUniqueness", () => {
  it("returns true when no staff exist", async () => {
    vi.mocked(staffRepository.findAllActive).mockResolvedValue([]);
    const result = await checkPinUniqueness("rest-1", "1234");
    expect(result).toBe(true);
  });

  it("returns true when pin is unique", async () => {
    vi.mocked(staffRepository.findAllActive).mockResolvedValue([
      { pin: "hashed-5678" },
    ] as never);
    vi.mocked(compare).mockResolvedValue(false as never);

    const result = await checkPinUniqueness("rest-1", "1234");
    expect(result).toBe(true);
    expect(compare).toHaveBeenCalledWith("1234", "hashed-5678");
  });

  it("returns false when pin is already in use", async () => {
    vi.mocked(staffRepository.findAllActive).mockResolvedValue([
      { pin: "hashed-1234" },
    ] as never);
    vi.mocked(compare).mockResolvedValue(true as never);

    const result = await checkPinUniqueness("rest-1", "1234");
    expect(result).toBe(false);
  });

  it("uses findAllActiveExcept when excludeStaffId provided", async () => {
    vi.mocked(staffRepository.findAllActiveExcept).mockResolvedValue([]);

    await checkPinUniqueness("rest-1", "1234", "staff-1");
    expect(staffRepository.findAllActiveExcept).toHaveBeenCalledWith("rest-1", "staff-1");
    expect(staffRepository.findAllActive).not.toHaveBeenCalled();
  });
});

describe("hashPin", () => {
  it("calls bcrypt hash with salt rounds 10", async () => {
    vi.mocked(hash).mockResolvedValue("hashed-value" as never);
    const result = await hashPin("1234");
    expect(hash).toHaveBeenCalledWith("1234", 10);
    expect(result).toBe("hashed-value");
  });
});

describe("generateEmployeeId", () => {
  it("returns EMP001 when no staff exist", async () => {
    vi.mocked(staffRepository.findLastByRestaurant).mockResolvedValue(null);
    const id = await generateEmployeeId("rest-1");
    expect(id).toBe("EMP001");
  });

  it("increments from last employee id", async () => {
    vi.mocked(staffRepository.findLastByRestaurant).mockResolvedValue({
      employeeId: "EMP005",
    } as never);
    const id = await generateEmployeeId("rest-1");
    expect(id).toBe("EMP006");
  });

  it("pads to 3 digits", async () => {
    vi.mocked(staffRepository.findLastByRestaurant).mockResolvedValue({
      employeeId: "EMP099",
    } as never);
    const id = await generateEmployeeId("rest-1");
    expect(id).toBe("EMP100");
  });
});

describe("findStaffByPin", () => {
  it("returns matching staff member", async () => {
    const staffMember = { id: "staff-1", pin: "hashed", name: "John" };
    vi.mocked(staffRepository.findAllActive).mockResolvedValue([staffMember] as never);
    vi.mocked(compare).mockResolvedValue(true as never);

    const result = await findStaffByPin("rest-1", "1234");
    expect(result).toEqual(staffMember);
  });

  it("returns null when no match", async () => {
    vi.mocked(staffRepository.findAllActive).mockResolvedValue([
      { id: "staff-1", pin: "hashed" },
    ] as never);
    vi.mocked(compare).mockResolvedValue(false as never);

    const result = await findStaffByPin("rest-1", "9999");
    expect(result).toBeNull();
  });

  it("returns null when no staff exist", async () => {
    vi.mocked(staffRepository.findAllActive).mockResolvedValue([]);
    const result = await findStaffByPin("rest-1", "1234");
    expect(result).toBeNull();
  });

  it("stops comparing after finding match", async () => {
    const staff = [
      { id: "s1", pin: "hash1" },
      { id: "s2", pin: "hash2" },
      { id: "s3", pin: "hash3" },
    ];
    vi.mocked(staffRepository.findAllActive).mockResolvedValue(staff as never);
    vi.mocked(compare)
      .mockResolvedValueOnce(false as never)
      .mockResolvedValueOnce(true as never);

    const result = await findStaffByPin("rest-1", "1234");
    expect(result).toEqual(staff[1]);
    expect(compare).toHaveBeenCalledTimes(2); // did not check 3rd
  });
});
