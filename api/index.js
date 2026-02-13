"use strict";
require('dotenv').config();
const {
  envToCfg,
  envToSecrets,
  readEnv,
} = require("@atproto/pds");
const pkg = require("@atproto/pds/package.json");
const PDSServer = require("../server");
const { TursoBlobStore, setupTursoBlobStoreSchema } = require("../turso-blobstore");
const { createClient } = require("@libsql/client");

const main = async () => {
  const env = readEnv();
  
  // Manually supplement the database env vars, as readEnv() does not pick them up
  env.databaseUrl = process.env.PDS_DATABASE_URL;
  env.databaseAuthToken = process.env.PDS_DATABASE_AUTH_TOKEN;

  env.version ||= pkg.version;
  const cfg = envToCfg(env);
  const secrets = envToSecrets(env);

  const overrides = {};
  const tursoUrl = process.env.TURSO_BLOBSTORE_URL || process.env.PDS_DATABASE_URL;
  const tursoAuthToken = process.env.TURSO_BLOBSTORE_AUTH_TOKEN || process.env.PDS_DATABASE_AUTH_TOKEN;

  if (tursoUrl) {
    const dbConfig = {
      url: tursoUrl,
      authToken: tursoAuthToken,
    };
    
    // Initialize schema
    const client = createClient(dbConfig);
    await setupTursoBlobStoreSchema(client);
    
    overrides.blobstore = TursoBlobStore.creator(dbConfig);
  }

  const server = new PDSServer(cfg, secrets);
  await server.start(overrides);
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
