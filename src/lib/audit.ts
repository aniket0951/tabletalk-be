import { prisma } from "./prisma";

interface AuditEntry {
  restaurantId: string;
  actorType: "owner" | "staff" | "system";
  actorId?: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

export function logAudit(entry: AuditEntry) {
  // Fire-and-forget — don't block the request
  prisma.auditLog
    .create({
      data: {
        restaurantId: entry.restaurantId,
        actorType: entry.actorType,
        actorId: entry.actorId || null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId || null,
        details: entry.details ? JSON.stringify(entry.details) : null,
      },
    })
    .catch(() => {
      // Silently fail — audit should never break the main flow
    });
}
