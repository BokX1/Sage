/**
 * @module src/core/db/prisma-client
 * @description Defines the prisma client module.
 */
import { PrismaClient } from '@prisma/client';

/**
 * Declares exported bindings: prisma.
 */
export const prisma = new PrismaClient();
