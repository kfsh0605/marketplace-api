export const USER_ROLES = ['customer', 'seller', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];