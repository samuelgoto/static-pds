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
  env.version ||= pkg.version;
  const cfg = envToCfg(env);
  const secrets = envToSecrets(env);
  const server = new PDSServer(cfg, secrets);
  await server.start();
};

main();
