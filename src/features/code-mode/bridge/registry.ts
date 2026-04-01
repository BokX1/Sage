import { BridgeRegistry } from './common';
import { adminDomainMethods } from './adminDomain';
import { approvalsDomainMethods } from './approvalsDomain';
import { artifactsDomainMethods } from './artifactsDomain';
import { contextDomainMethods } from './contextDomain';
import { discordDomainMethods } from './discordDomain';
import { historyDomainMethods } from './historyDomain';
import { moderationDomainMethods } from './moderationDomain';
import { scheduleDomainMethods } from './scheduleDomain';

export function createDefaultBridgeRegistry(): BridgeRegistry {
  const registry = new BridgeRegistry();
  for (const method of [
    ...discordDomainMethods,
    ...historyDomainMethods,
    ...contextDomainMethods,
    ...artifactsDomainMethods,
    ...approvalsDomainMethods,
    ...adminDomainMethods,
    ...moderationDomainMethods,
    ...scheduleDomainMethods,
  ]) {
    registry.register(method as Parameters<typeof registry.register>[0]);
  }
  return registry;
}

export const globalBridgeRegistry = createDefaultBridgeRegistry();
