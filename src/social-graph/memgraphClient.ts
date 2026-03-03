/**
 * @module src/social-graph/memgraphClient
 * @description Defines the memgraph client module.
 */
import neo4j from 'neo4j-driver';
import type { QueryResult } from 'neo4j-driver';
import { config } from '../config';

/**
 * Represents the MemgraphClient type.
 */
export type MemgraphClient = {
  run: (query: string, params?: Record<string, unknown>) => Promise<QueryResult>;
  close: () => Promise<void>;
};

/**
 * Runs createMemgraphClient.
 *
 * @returns Returns the function result.
 */
export function createMemgraphClient(): MemgraphClient {
  const uri = `bolt://${config.MEMGRAPH_HOST}:${config.MEMGRAPH_PORT}`;

  const authToken =
    config.MEMGRAPH_USER && config.MEMGRAPH_USER.trim().length > 0
      ? neo4j.auth.basic(config.MEMGRAPH_USER, config.MEMGRAPH_PASSWORD ?? '')
      : undefined;

  const driver = neo4j.driver(uri, authToken);

  return {
    async run(query: string, params?: Record<string, unknown>) {
      const session = driver.session();
      try {
        return await session.run(query, params);
      } finally {
        await session.close();
      }
    },
    async close() {
      await driver.close();
    },
  };
}
