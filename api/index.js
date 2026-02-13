"use strict";
require('dotenv').config();
const {
  envToCfg,
  envToSecrets,
  readEnv,
  Database,
  AppContext,
  PDS,
} = require("@atproto/pds");
const { Kysely } = require("kysely");
const pkg = require("@atproto/pds/package.json");
const PDSServer = require("../server");
const { TursoBlobStore, setupTursoBlobStoreSchema } = require("../turso-blobstore");
const { LibsqlDialect } = require("../kysely-libsql-dialect");
const { createClient } = require("@libsql/client");

const main = async () => {
  const env = readEnv();
  
  // Supplying environment variables
  env.databaseUrl = process.env.PDS_DATABASE_URL;
  env.databaseAuthToken = process.env.PDS_DATABASE_AUTH_TOKEN;
  env.version ||= pkg.version;
  env.blobstoreDiskLocation ||= "/tmp/blobs"; // Dummy to satisfy config check
  env.devMode = process.env.VERCEL ? false : env.devMode;

  const cfg = envToCfg(env);
  const secrets = envToSecrets(env);

  const dbConfig = {
    url: env.databaseUrl,
    authToken: env.databaseAuthToken,
  };

  // 1. Initialize Shared LibSQL Kysely instance
  const kysely = new Kysely({
    dialect: new LibsqlDialect(dbConfig),
  });

  // 2. Create the main PDS Database instance
  const db = new Database(kysely);

  // 3. Initialize Blobstore Schema
  const client = createClient(dbConfig);
  await setupTursoBlobStoreSchema(client);

  const overrides = {
    db: db,
    blobstore: TursoBlobStore.creator(dbConfig),
    // Point everything to the same Turso DB
    actorStore: {
        // Mock ActorStore to return our shared Turso DB for EVERY user (since it's just you)
        transact: async (did, fn) => {
            return db.transaction(fn);
        },
        read: async (did, fn) => {
            return fn(db);
        },
        destroy: async () => {},
        // PDS calls this during account creation
        install: async (did) => {
            const { default: migrations } = require("@atproto/pds/dist/actor-store/db/migrations");
            const { Migrator } = require("@atproto/pds/dist/db/migrator");
            const migrator = new Migrator(db.db, migrations);
            await migrator.migrateToLatestOrThrow();
        }
    }
  };

  const server = new PDSServer(cfg, secrets);
  await server.start(overrides, { skipListen: !!process.env.VERCEL });

  // Optional: Auto-create account if it doesn't exist (useful for stateless deployment)
  if (process.env.AUTO_CREATE_HANDLE && process.env.AUTO_CREATE_EMAIL && process.env.PDS_ADMIN_PASSWORD) {
    const handle = process.env.AUTO_CREATE_HANDLE;
    const email = process.env.AUTO_CREATE_EMAIL;
    const password = process.env.PDS_ADMIN_PASSWORD;
    
    const account = await server.pds.ctx.accountManager.getAccount(handle, true);
    if (!account) {
        console.log(`Auto-creating account: ${handle}`);
        await server.pds.ctx.accountManager.createAccount(email, handle, password);
    }
  }

  return server.pds.app;
};

if (require.main === module) {
  main().catch(err => {
    console.error('Failed to start PDS:', err);
    process.exit(1);
  });
}

module.exports = async (req, res) => {
  const app = await main();
  return app(req, res);
};
