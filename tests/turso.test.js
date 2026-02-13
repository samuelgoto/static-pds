const { AtpAgent } = require("@atproto/api");
const { envToCfg, envToSecrets } = require("@atproto/pds");
const { Secp256k1Keypair, randomStr } = require("@atproto/crypto");
const PDSServer = require("../server");
const { TursoBlobStore, setupTursoBlobStoreSchema } = require("../turso-blobstore");
const { createClient } = require("@libsql/client");
const fs = require("fs");
const path = require("path");

describe("PDS Server with Turso (LibSQL) Blobstore", () => {
  let server;
  let agent;
  let port;
  let assert;
  const dbPath = path.join(__dirname, "test-turso.db");

  before(async () => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const chai = await import("chai");
    assert = chai.assert;
    const { default: getPort } = await import("get-port");
    port = await getPort();
    const plcRotationKey = await Secp256k1Keypair.create({ exportable: true });
    const recoveryKey = (await Secp256k1Keypair.create()).did();

    const env = {
      devMode: true,
      port,
      databaseLocation: ":memory:", // PDS uses in-memory SQLite for main DBs
      blobstoreDiskLocation: "/tmp/atproto-test-blobstore", // Placeholder
      recoveryDidKey: recoveryKey,
      adminPassword: "admin",
      jwtSecret: "secret",
      serviceHandleDomains: [".test"],
      plcRotationKeyK256PrivateKeyHex: Buffer.from(await plcRotationKey.export()).toString('hex'),
      inviteRequired: false,
    };

    const cfg = envToCfg(env);
    const secrets = envToSecrets(env);
    
    // Set up Turso Blobstore
    const dbConfig = { url: `file:${dbPath}` };
    const client = createClient(dbConfig);
    await setupTursoBlobStoreSchema(client);
    
    const overrides = {
      blobstore: TursoBlobStore.creator(dbConfig),
    };

    server = new PDSServer(cfg, secrets);
    await server.start(overrides);
    agent = new AtpAgent({ service: `http://localhost:${port}` });
  });

  after(async () => {
    if (server) {
      await server.destroy();
    }
    if (fs.existsSync(dbPath)) {
        await new Promise(resolve => setTimeout(resolve, 500));
        try {
            fs.unlinkSync(dbPath);
        } catch (e) {}
    }
  });
  
  it("should allow uploading and retrieving a blob from Turso DB", async () => {
    const user = {
      handle: `${randomStr(8, "base32")}.test`,
      password: "password123",
      email: `testuser${Date.now()}@example.com`,
    };
    await agent.createAccount(user);
    const userAgent = new AtpAgent({ service: `http://localhost:${port}` });
    await userAgent.login({
      identifier: user.handle,
      password: user.password,
    });

    const blobData = Buffer.from("Hello Turso DB Blob!");
    const uploadRes = await userAgent.api.com.atproto.repo.uploadBlob(blobData, {
        encoding: 'text/plain'
    });
    
    assert.isTrue(uploadRes.success);
    const blobRef = uploadRes.data.blob;

    // Verify it's in the Turso database
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
        sql: "SELECT * FROM blobs WHERE cid = ?",
        args: [blobRef.ref.toString()]
    });
    assert.equal(result.rows.length, 1);
    assert.deepEqual(Buffer.from(new Uint8Array(result.rows[0].data)), blobData);

    // Retrieve via API
    const getRes = await userAgent.api.com.atproto.sync.getBlob({
        did: userAgent.session.did,
        cid: blobRef.ref.toString()
    });
    assert.isTrue(getRes.success);
    assert.deepEqual(Buffer.from(getRes.data), blobData);
  });
});
