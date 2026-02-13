const { AtpAgent } = require("@atproto/api");
const { TestNetworkNoAppView } = require("@atproto/dev-env");
const { TursoBlobStore, setupTursoBlobStoreSchema } = require("../turso-blobstore");
const { createClient } = require("@libsql/client");
const { Secp256k1Keypair } = require("@atproto/crypto");
const PDSServer = require("../server");
const fs = require("fs");
const path = require("path");

describe("PDS Interoperability (PLC + Turso Blobstore)", () => {
  let network;
  let pdsServer;
  let agent;
  let assert;
  const dbPath = path.join(__dirname, "test-interop-turso.db");

  before(async () => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const chai = await import("chai");
    assert = chai.assert;

    // 1. Create a TestNetworkNoAppView (PLC + PDS)
    network = await TestNetworkNoAppView.create({
        pds: {
            // Default config
        }
    });

    // 2. Set up our Turso Blobstore
    const dbConfig = { url: `file:${dbPath}` };
    const client = createClient(dbConfig);
    await setupTursoBlobStoreSchema(client);
    
    const overrides = {
      blobstore: TursoBlobStore.creator(dbConfig),
    };

    // 3. Start our PDSServer using the config from the network's PDS
    const networkPds = network.pds;
    const { ADMIN_PASSWORD, JWT_SECRET } = require("@atproto/dev-env/dist/const");
    
    const plcRotationKey = await Secp256k1Keypair.create({ exportable: true });
    const privKeyHex = Buffer.from(await plcRotationKey.export()).toString('hex');

    const secrets = {
        adminPassword: ADMIN_PASSWORD,
        jwtSecret: JWT_SECRET,
        plcRotationKey: {
            provider: 'memory',
            privateKeyHex: privKeyHex,
        },
    };
    
    pdsServer = new PDSServer(networkPds.server.ctx.cfg, secrets);
    
    // Stop the network's default PDS to free the port
    await networkPds.server.destroy();
    
    await pdsServer.start(overrides);
    
    agent = new AtpAgent({ service: networkPds.url });
  });

  after(async () => {
    if (pdsServer) await pdsServer.destroy();
    if (network) await network.close();
    if (fs.existsSync(dbPath)) {
        await new Promise(resolve => setTimeout(resolve, 500));
        try { fs.unlinkSync(dbPath); } catch (e) {}
    }
  });

  it("should interoperate with local PLC for identity and use Turso for blobs", async () => {
    const handle = `interop-${randomStr(4, 'abcdefghijklmnopqrstuvwxyz')}.test`;
    const password = "password123";

    // 1. Create account (talks to local PLC)
    await agent.createAccount({
        handle,
        email: `${handle}@example.com`,
        password,
    });

    // 2. Login
    await agent.login({ identifier: handle, password });
    const did = agent.session.did;
    assert.exists(did);

    // 3. Upload a blob (uses TursoBlobStore)
    const blobData = Buffer.from("Interop Blob Content");
    const upload = await agent.uploadBlob(blobData, { encoding: 'text/plain' });
    assert.isTrue(upload.success);

    // 4. Verify the blob is in our Turso DB
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
        sql: "SELECT 1 FROM blobs WHERE cid = ?",
        args: [upload.data.blob.ref.toString()]
    });
    assert.equal(result.rows.length, 1, "Blob must be in Turso");

    // 5. Verify handle resolution via PDS
    const resolved = await agent.api.com.atproto.identity.resolveHandle({ handle });
    assert.equal(resolved.data.did, did, "PDS should resolve the handle to the correct DID");
    
    // 6. Verify PLC resolution directly
    const plcClient = network.plc.getClient();
    const doc = await plcClient.getDocument(did);
    assert.equal(doc.alsoKnownAs[0], `at://${handle}`);
  });
});

function randomStr(len, chars) {
    let result = '';
    for (let i = len; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
}
