const path  = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { Secp256k1Keypair, randomStr } = require("@atproto/crypto");
const pds = require("@atproto/pds");
const ui8 = (...args) => import("uint8arrays/to-string").then((context) => {const result = context.toString(...args); return result;});

const {AtpAgent} = require("@atproto/api");

// https://char.lt/blog/2024/10/atproto-pds/

const { TestPds } = require("@atproto/dev-env");

//const "dotenv/config";

const { envStr } = require("@atproto/common");
const { PDS, envToCfg, envToSecrets, readEnv } = require("@atproto/pds");
const { pkg } = require("@atproto/pds/package.json");

// import process from "node:process";

const main = async () => {

  // hack: allow listening on non-0.0.0.0 addresses
  const host = envStr("BIND_HOST") ?? "127.0.0.1";
  const appListen = pds.app.listen;
  pds.app.listen = (port) => {
    return appListen(port, host);
  };

  await pds.start();
  process.on("SIGTERM", async () => {
    await pds.destroy();
  });
};

// main();


describe("Basic", () => {
  it("Works", async () => {
    //const env = readEnv();
    //env.version ||= pkg.version;
    //const cfg = envToCfg(env);
    // const secrets = envToSecrets(env);
    const plcRotationKey = await Secp256k1Keypair.create({ exportable: true })
    const plcRotationPriv = await ui8(await plcRotationKey.export(), 'hex');
    const recoveryKey = (await Secp256k1Keypair.create()).did();

    const port = 8081;
    //const url = `http://localhost:${port}`

    const blobstoreLoc = path.join(os.tmpdir(), randomStr(8, 'base32'))
    const dataDirectory = path.join(os.tmpdir(), randomStr(8, 'base32'))
    await fs.mkdir(dataDirectory, { recursive: true })

    const ADMIN_PASSWORD = "foo";
    const JWT_SECRET = "bar";
    
    const env = {
      devMode: true,
      port,
      dataDirectory: dataDirectory,
      blobstoreDiskLocation: blobstoreLoc,
      recoveryDidKey: recoveryKey,
      adminPassword: ADMIN_PASSWORD,
      jwtSecret: JWT_SECRET,
      serviceHandleDomains: ['.test'],
      bskyAppViewUrl: "https://api.pop1.bsky.app",
      bskyAppViewDid: "did:web:api.bsky.app",
      //bskyAppViewCdnUrlPattern: 'http://cdn.appview.com/%s/%s/%s',
      //modServiceUrl: 'https://moderator.invalid',
      //modServiceDid: 'did:example:invalid',
      plcRotationKeyK256PrivateKeyHex: plcRotationPriv,
      inviteRequired: false,
      disableSsrfProtection: true,
      serviceName: 'Development PDS',
      brandColor: '#ffcb1e',
      errorColor: undefined,
      //logoUrl:
      //  'https://uxwing.com/wp-content/themes/uxwing/download/animals-and-birds/bee-icon.png',
      //homeUrl: 'https://bsky.social/',
      //termsOfServiceUrl: 'https://bsky.social/about/support/tos',
      //privacyPolicyUrl: 'https://bsky.social/about/support/privacy-policy',
      //supportUrl: 'https://blueskyweb.zendesk.com/hc/en-us',
      //...config,
    }
    const cfg = pds.envToCfg(env);
    const secrets = pds.envToSecrets(env);

    const server = await pds.PDS.create(cfg, secrets);

    await server.start()
    
    const agent = new AtpAgent({ service: `http://localhost:${port}` });

    await agent.createAccount({
      email: "alice2@mail.com",
      password: "hunter2",
      handle: "foo2.test",
    });

    const {data, success} = await agent.getProfile({
      actor: agent.accountDid
    });
    
    console.log(data);
  });
});
