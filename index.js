import { TestPds } from "@atproto/dev-env";
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import getPort from 'get-port'
import * as ui8 from 'uint8arrays'
import * as pds from '@atproto/pds'
import { createSecretKeyObject } from '@atproto/pds'
import { Secp256k1Keypair, randomStr } from '@atproto/crypto'
import { AtpAgent } from '@atproto/api'

const ADMIN_PASSWORD = 'admin-pass';
const JWT_SECRET = 'jwt-secret';
const EXAMPLE_LABELER = 'did:example:labeler';

const plcRotationKey = await Secp256k1Keypair.create({ exportable: true });
const plcRotationPriv = ui8.toString(await plcRotationKey.export(), 'hex');
const recoveryKey = (await Secp256k1Keypair.create()).did();

const port = process.env.PORT || 8080;
const url = process.env.URL || `http://localhost:${port}`;

const blobstoreLoc = path.join(os.tmpdir(), randomStr(8, 'base32'));
const dataDirectory = path.join(os.tmpdir(), randomStr(8, 'base32'));
await fs.mkdir(dataDirectory, { recursive: true });

const env = {
  devMode: true,
  port,
  dataDirectory: dataDirectory,
  blobstoreDiskLocation: blobstoreLoc,
  recoveryDidKey: recoveryKey,
  adminPassword: ADMIN_PASSWORD,
  jwtSecret: JWT_SECRET,
  serviceHandleDomains: [".test"],
  bskyAppViewUrl: "https://appview.invalid",
  bskyAppViewDid: "did:example:invalid",
  bskyAppViewCdnUrlPattern: "http://cdn.appview.com/%s/%s/%s",
  modServiceUrl: "https://moderator.invalid",
  modServiceDid: "did:example:invalid",
  plcRotationKeyK256PrivateKeyHex: plcRotationPriv,
  inviteRequired: false,
  disableSsrfProtection: true,
  serviceName: "Development PDS",
  brandColor: "#ffcb1e",
  errorColor: undefined,
  //logoUrl:
  //  "https://uxwing.com/wp-content/themes/uxwing/download/animals-and-birds/bee-icon.png",
  //homeUrl: "https://bsky.social/",
  //termsOfServiceUrl: "https://bsky.social/about/support/tos",
  //privacyPolicyUrl: "https://bsky.social/about/support/privacy-policy",
  //supportUrl: "https://blueskyweb.zendesk.com/hc/en-us",
  // ...config,
};


const cfg = pds.envToCfg(env)
const secrets = pds.envToSecrets(env)

const server = await pds.PDS.create(cfg, secrets)

await server.start()

console.log(`Running on ${url}`);
