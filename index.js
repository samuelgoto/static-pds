"use strict";
require('dotenv').config();
const {
  envToCfg,
  envToSecrets,
  readEnv,
} = require("@atproto/pds");
const pkg = require("@atproto/pds/package.json");
const PDSServer = require("./server");

const main = async () => {
  const env = readEnv();
  
  // Manually supplement the database env vars, as readEnv() does not pick them up
  env.databaseUrl = process.env.PDS_DATABASE_URL;
  env.databaseAuthToken = process.env.PDS_DATABASE_AUTH_TOKEN;

  env.version ||= pkg.version;
  const cfg = envToCfg(env);
  const secrets = envToSecrets(env);
  const server = new PDSServer(cfg, secrets);
  await server.start();
};

main();
