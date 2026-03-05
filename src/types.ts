import type { StaffJwtPayload } from "./lib/staff-jwt";

export type Env = {
  Variables: {
    userId: string;
    email: string;
    staff: StaffJwtPayload;
  };
};
