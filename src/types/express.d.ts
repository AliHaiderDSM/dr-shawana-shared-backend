import { type Role } from '../lib/permissions';

declare global {
  namespace Express {
    interface AuthContext {
      userId: string;
      role: Role;
      branchId: string | null;
      isSuperAdmin: boolean;
    }

    interface Request {
      id: string;
      auth?: AuthContext;
      branchId?: string | null;
      valid: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export {};
