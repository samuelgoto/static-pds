"use strict";

const { SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } = require('kysely');
const { createClient } = require('@libsql/client');

class LibsqlDialect {
  constructor(config) {
    this.config = config;
  }

  createAdapter() {
    return new SqliteAdapter();
  }

  createIntrospector(db) {
    return new SqliteIntrospector(db);
  }

  createQueryCompiler() {
    return new SqliteQueryCompiler();
  }

  createDriver() {
    const client = createClient(this.config);
    return new LibsqlDriver(client);
  }
}

class LibsqlDriver {
  constructor(client) {
    this.client = client;
  }

  async init() {
    // No-op
  }

  async acquireConnection() {
    return new LibsqlConnection(this.client);
  }

  async beginTransaction(connection) {
    await connection.execute({ sql: 'BEGIN' });
  }

  async commitTransaction(connection) {
    await connection.execute({ sql: 'COMMIT' });
  }

  async rollbackTransaction(connection) {
    await connection.execute({ sql: 'ROLLBACK' });
  }

  async releaseConnection() {
    // No-op
  }

  async destroy() {
    await this.client.close();
  }
}

class LibsqlConnection {
  constructor(client) {
    this.client = client;
  }

  async executeQuery(compiledQuery) {
    const result = await this.client.execute({
      sql: compiledQuery.sql,
      args: compiledQuery.parameters,
    });

    return {
      rows: result.rows,
      // Libsql uses lastInsertRowid, Kysely expects insertId as bigint
      insertId: result.lastInsertRowid ? BigInt(result.lastInsertRowid) : undefined,
      numAffectedRows: result.rowsAffected ? BigInt(result.rowsAffected) : undefined,
    };
  }

  async streamQuery() {
    throw new Error('LibsqlDialect does not support streaming');
  }
}

module.exports = { LibsqlDialect };
