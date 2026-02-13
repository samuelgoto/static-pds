import { BlobStore, BlobNotFoundError } from '@atproto/repo'
import { CID } from 'multiformats/cid'
import stream from 'node:stream'
import { Client as LibSqlClient, Config as LibSqlClientConfig } from '@libsql/client'
import { sha256 } from 'multiformats/hashes/sha2'
import * as json from '@ipld/dag-json'
import { bf } from 'multiformats/bytes'

export class TursoBlobStore implements BlobStore {
  private client: LibSqlClient
  private did: string

  constructor(client: LibSqlClient, did: string) {
    this.client = client
    this.did = did
  }

  static creator(dbConfig: LibSqlClientConfig) {
    return (did: string) => {
      const client = new LibSqlClient(dbConfig)
      return new TursoBlobStore(client, did)
    }
  }

  async putTemp(bytes: Uint8Array | stream.Readable): Promise<string> {
    const data = bytes instanceof Uint8Array ? bytes : await this.streamToBuffer(bytes);
    const hash = await sha256.encode(data);
    const cid = CID.createV1(0xb220, hash).toString(); // Using cid as a temporary key for consistency

    await this.client.execute({
      sql: 'INSERT INTO temp_blobs (cid, data, did) VALUES (?, ?, ?) ON CONFLICT(cid) DO UPDATE SET data=excluded.data, did=excluded.did',
      args: [cid, data, this.did],
    });
    return cid;
  }

  async makePermanent(key: string, cid: CID): Promise<void> {
    const storedCid = cid.toString();
    const result = await this.client.execute({
      sql: 'UPDATE temp_blobs SET cid = ?, is_permanent = TRUE WHERE cid = ? AND did = ?',
      args: [storedCid, key, this.did],
    });
    if (result.rowsAffected === 0) {
      throw new Error('Blob not found in temp storage to make permanent');
    }
  }

  async putPermanent(cid: CID, bytes: Uint8Array | stream.Readable): Promise<void> {
    const data = bytes instanceof Uint8Array ? bytes : await this.streamToBuffer(bytes);
    const storedCid = cid.toString();

    await this.client.execute({
      sql: 'INSERT INTO permanent_blobs (cid, data, did) VALUES (?, ?, ?) ON CONFLICT(cid) DO UPDATE SET data=excluded.data, did=excluded.did',
      args: [storedCid, data, this.did],
    });
  }

  // Turso doesn't have a specific quarantine concept, so we can use a flag or a separate table
  async quarantine(cid: CID): Promise<void> {
    await this.client.execute({
      sql: 'UPDATE permanent_blobs SET is_quarantined = TRUE WHERE cid = ? AND did = ?',
      args: [cid.toString(), this.did],
    });
  }

  async unquarantine(cid: CID): Promise<void> {
    await this.client.execute({
      sql: 'UPDATE permanent_blobs SET is_quarantined = FALSE WHERE cid = ? AND did = ?',
      args: [cid.toString(), this.did],
    });
  }

  async getBytes(cid: CID): Promise<Uint8Array> {
    const result = await this.client.execute({
      sql: 'SELECT data FROM permanent_blobs WHERE cid = ? AND did = ? AND is_quarantined = FALSE',
      args: [cid.toString(), this.did],
    });
    if (result.rows.length === 0) {
      throw new BlobNotFoundError();
    }
    // Assuming data is stored as Uint8Array or Buffer
    const data = result.rows[0].data;
    if (data instanceof Uint8Array) {
      return data;
    }
    // If it's a Buffer from Node.js environment
    return new Uint8Array(data);
  }

  async getStream(cid: CID): Promise<stream.Readable> {
    const data = await this.getBytes(cid); // Reusing getBytes
    const s = new stream.Readable();
    s.push(data);
    s.push(null); // No more data
    return s;
  }

  async hasTemp(key: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: 'SELECT 1 FROM temp_blobs WHERE cid = ? AND did = ? AND is_permanent = FALSE',
      args: [key, this.did],
    });
    return result.rows.length > 0;
  }

  async hasStored(cid: CID): Promise<boolean> {
    const result = await this.client.execute({
      sql: 'SELECT 1 FROM permanent_blobs WHERE cid = ? AND did = ? AND is_quarantined = FALSE',
      args: [cid.toString(), this.did],
    });
    return result.rows.length > 0;
  }

  async delete(cid: CID): Promise<void> {
    await this.client.execute({
      sql: 'DELETE FROM permanent_blobs WHERE cid = ? AND did = ?',
      args: [cid.toString(), this.did],
    });
    await this.client.execute({
      sql: 'DELETE FROM temp_blobs WHERE cid = ? AND did = ?',
      args: [cid.toString(), this.did],
    });
  }

  async deleteMany(cids: CID[]): Promise<void> {
    const cidStrings = cids.map(c => c.toString());
    const placeholders = cidStrings.map(() => '?').join(',');

    await this.client.execute({
      sql: `DELETE FROM permanent_blobs WHERE cid IN (${placeholders}) AND did = ?`,
      args: [...cidStrings, this.did],
    });
    await this.client.execute({
      sql: `DELETE FROM temp_blobs WHERE cid IN (${placeholders}) AND did = ?`,
      args: [...cidStrings, this.did],
    });
  }

  async deleteAll(): Promise<void> {
    await this.client.execute({
      sql: 'DELETE FROM permanent_blobs WHERE did = ?',
      args: [this.did],
    });
    await this.client.execute({
      sql: 'DELETE FROM temp_blobs WHERE did = ?',
      args: [this.did],
    });
  }

  private streamToBuffer(stream: stream.Readable): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(bf.from(Buffer.concat(chunks))));
    });
  }
}

// Initial schema setup for Turso
export async function setupTursoBlobStoreSchema(client: LibSqlClient): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS temp_blobs (
      cid TEXT PRIMARY KEY,
      data BLOB NOT NULL,
      did TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_permanent BOOLEAN DEFAULT FALSE
    );
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS permanent_blobs (
      cid TEXT PRIMARY KEY,
      data BLOB NOT NULL,
      did TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_quarantined BOOLEAN DEFAULT FALSE
    );
  `);
}