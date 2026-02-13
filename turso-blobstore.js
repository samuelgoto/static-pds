"use strict";

const { BlobNotFoundError } = require('@atproto/repo');
const { CID } = require('multiformats/cid');
const stream = require('node:stream');
const { createClient } = require('@libsql/client');
const { sha256 } = require('multiformats/hashes/sha2');

class TursoBlobStore {
  constructor(client, did) {
    this.client = client;
    this.did = did;
  }

  static creator(dbConfig) {
    return (did) => {
      const client = createClient(dbConfig);
      return new TursoBlobStore(client, did);
    };
  }

  async putTemp(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : await this.streamToBuffer(bytes);
    const multihash = await sha256.digest(data);
    const cid = CID.createV1(0x55, multihash).toString();

    await this.client.execute({
      sql: 'INSERT INTO blobs (cid, data, did, is_permanent) VALUES (?, ?, ?, FALSE) ON CONFLICT(cid) DO UPDATE SET data=excluded.data, did=excluded.did',
      args: [cid, data, this.did],
    });
    return cid;
  }

  async makePermanent(key, cid) {
    const storedCid = cid.toString();
    const result = await this.client.execute({
      sql: 'UPDATE blobs SET cid = ?, is_permanent = TRUE WHERE cid = ? AND did = ?',
      args: [storedCid, key, this.did],
    });
    if (result.rowsAffected === 0) {
      throw new Error('Blob not found in storage to make permanent');
    }
  }

  async putPermanent(cid, bytes) {
    const data = bytes instanceof Uint8Array ? bytes : await this.streamToBuffer(bytes);
    const storedCid = cid.toString();

    await this.client.execute({
      sql: 'INSERT INTO blobs (cid, data, did, is_permanent) VALUES (?, ?, ?, TRUE) ON CONFLICT(cid) DO UPDATE SET data=excluded.data, did=excluded.did, is_permanent=TRUE',
      args: [storedCid, data, this.did],
    });
  }

  async quarantine(cid) {
    await this.client.execute({
      sql: 'UPDATE blobs SET is_quarantined = TRUE WHERE cid = ? AND did = ?',
      args: [cid.toString(), this.did],
    });
  }

  async unquarantine(cid) {
    await this.client.execute({
      sql: 'UPDATE blobs SET is_quarantined = FALSE WHERE cid = ? AND did = ?',
      args: [cid.toString(), this.did],
    });
  }

  async getBytes(cid) {
    const result = await this.client.execute({
      sql: 'SELECT data FROM blobs WHERE cid = ? AND did = ? AND is_quarantined = FALSE',
      args: [cid.toString(), this.did],
    });
    if (result.rows.length === 0) {
      throw new BlobNotFoundError();
    }
    const data = result.rows[0].data;
    if (data instanceof Uint8Array) {
      return data;
    }
    return new Uint8Array(data);
  }

  async getStream(cid) {
    const data = await this.getBytes(cid);
    const s = new stream.Readable();
    s.push(data);
    s.push(null);
    return s;
  }

  async hasTemp(key) {
    const result = await this.client.execute({
      sql: 'SELECT 1 FROM blobs WHERE cid = ? AND did = ? AND is_permanent = FALSE',
      args: [key, this.did],
    });
    return result.rows.length > 0;
  }

  async hasStored(cid) {
    const result = await this.client.execute({
      sql: 'SELECT 1 FROM blobs WHERE cid = ? AND did = ? AND is_quarantined = FALSE',
      args: [cid.toString(), this.did],
    });
    return result.rows.length > 0;
  }

  async delete(cid) {
    await this.client.execute({
      sql: 'DELETE FROM blobs WHERE cid = ? AND did = ?',
      args: [cid.toString(), this.did],
    });
  }

  async deleteMany(cids) {
    const cidStrings = cids.map(c => c.toString());
    const placeholders = cidStrings.map(() => '?').join(',');

    await this.client.execute({
      sql: `DELETE FROM blobs WHERE cid IN (${placeholders}) AND did = ?`,
      args: [...cidStrings, this.did],
    });
  }

  async deleteAll() {
    await this.client.execute({
      sql: 'DELETE FROM blobs WHERE did = ?',
      args: [this.did],
    });
  }

  async streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    });
  }
}

async function setupTursoBlobStoreSchema(client) {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS blobs (
      cid TEXT PRIMARY KEY,
      data BLOB NOT NULL,
      did TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_permanent BOOLEAN DEFAULT FALSE,
      is_quarantined BOOLEAN DEFAULT FALSE
    );
  `);
}

module.exports = { TursoBlobStore, setupTursoBlobStoreSchema };
