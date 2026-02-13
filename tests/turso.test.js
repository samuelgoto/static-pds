const { AtpAgent, BlobRef } = require("@atproto/api");
const { envToCfg, envToSecrets } = require("@atproto/pds");
const { Secp256k1Keypair, randomStr } = require("@atproto/crypto");
const PDSServer = require("../server");
const { TursoBlobStore, setupTursoBlobStoreSchema } = require("../turso-blobstore");
const { createClient } = require("@libsql/client");
const fs = require("fs");
const path = require("path");

describe("PDS End-to-End User Flows (Turso Blobstore)", () => {
  let server;
  let agent;
  let port;
  let assert;
  const dbPath = path.join(__dirname, "test-e2e-turso.db");

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
      databaseLocation: ":memory:",
      blobstoreDiskLocation: "/tmp/atproto-test-blobstore", 
      recoveryDidKey: recoveryKey,
      adminPassword: "admin",
      jwtSecret: "secret",
      serviceHandleDomains: [".test"],
      plcRotationKeyK256PrivateKeyHex: Buffer.from(await plcRotationKey.export()).toString('hex'),
      inviteRequired: false,
    };

    const cfg = envToCfg(env);
    const secrets = envToSecrets(env);
    
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

  async function createAndLoginUser(handle) {
    const password = "password123";
    await agent.createAccount({
      handle,
      email: `${handle}@example.com`,
      password,
    });
    const userAgent = new AtpAgent({ service: `http://localhost:${port}` });
    await userAgent.login({
      identifier: handle,
      password,
    });
    return userAgent;
  }

  it("Profile Flow: Create account, upload avatar, and set profile", async () => {
    const handle = `${randomStr(8, "base32")}.test`;
    const userAgent = await createAndLoginUser(handle);

    // 1. Upload Avatar
    const avatarData = Buffer.from("fake-image-binary-data");
    const uploadRes = await userAgent.api.com.atproto.repo.uploadBlob(avatarData, {
      encoding: 'image/png'
    });
    assert.isTrue(uploadRes.success);
    const avatarRef = uploadRes.data.blob;

    // 2. Set Profile
    await userAgent.api.com.atproto.repo.putRecord({
      repo: userAgent.session.did,
      collection: 'app.bsky.actor.profile',
      rkey: 'self',
      record: {
        displayName: 'Test User',
        description: 'Testing Turso Blobstore',
        avatar: avatarRef,
      }
    });

    // 3. Verify Record exists in PDS
    const record = await userAgent.api.com.atproto.repo.getRecord({
        repo: userAgent.session.did,
        collection: 'app.bsky.actor.profile',
        rkey: 'self'
    });
    assert.equal(record.data.value.displayName, 'Test User');
    assert.deepEqual(record.data.value.avatar, avatarRef);

    // 4. Verify Blob is in Turso and permanent
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
        sql: "SELECT is_permanent FROM blobs WHERE cid = ?",
        args: [avatarRef.ref.toString()]
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].is_permanent, 1, "Blob should be permanent");
  });

  it("Post with Images Flow: Create post with multiple images", async () => {
    const handle = `${randomStr(8, "base32")}.test`;
    const userAgent = await createAndLoginUser(handle);

    // 1. Upload multiple images
    const img1 = Buffer.from("image-1-data");
    const img2 = Buffer.from("image-2-data");

    const [res1, res2] = await Promise.all([
      userAgent.uploadBlob(img1, { encoding: 'image/jpeg' }),
      userAgent.uploadBlob(img2, { encoding: 'image/jpeg' })
    ]);

    // 2. Create post referencing images
    const record = {
        text: "Check out these two images!",
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [
            { image: res1.data.blob, alt: 'First image' },
            { image: res2.data.blob, alt: 'Second image' }
          ]
        }
    };
    const postRes = await userAgent.api.com.atproto.repo.createRecord({
        repo: userAgent.session.did,
        collection: 'app.bsky.feed.post',
        record
    });

    // 3. Retrieve post record directly from PDS
    const rkey = postRes.data.uri.split('/').pop();
    const fetchedRecord = await userAgent.api.com.atproto.repo.getRecord({
        repo: userAgent.session.did,
        collection: 'app.bsky.feed.post',
        rkey
    });
    
    assert.equal(fetchedRecord.data.value.embed.images.length, 2);
    
    // 4. Fetch actual blob data from sync endpoint
    const fetchedImg1 = await userAgent.api.com.atproto.sync.getBlob({
      did: userAgent.session.did,
      cid: res1.data.blob.ref.toString()
    });
    assert.deepEqual(Buffer.from(fetchedImg1.data), img1);
  });

  it("Deletion Flow: Blobs should be removed from Turso when record is deleted", async () => {
    const handle = `${randomStr(8, "base32")}.test`;
    const userAgent = await createAndLoginUser(handle);

    // 1. Upload and post (must use image MIME because bsky post embed expects images)
    const data = Buffer.from("fake-image-binary");
    const upload = await userAgent.uploadBlob(data, { encoding: 'image/png' });
    const cid = upload.data.blob.ref.toString();

    const record = {
        text: "Temporary post",
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ image: upload.data.blob, alt: 'temp' }]
        }
    };
    const post = await userAgent.api.com.atproto.repo.createRecord({
        repo: userAgent.session.did,
        collection: 'app.bsky.feed.post',
        record
    });

    // Verify it exists in Turso
    const client = createClient({ url: `file:${dbPath}` });
    const before = await client.execute({ sql: "SELECT 1 FROM blobs WHERE cid = ?", args: [cid] });
    assert.equal(before.rows.length, 1);

    // 2. Delete the record
    const rkey = post.data.uri.split('/').pop();
    await userAgent.api.com.atproto.repo.deleteRecord({
      repo: userAgent.session.did,
      collection: 'app.bsky.feed.post',
      rkey
    });

    // 3. Verify blob is gone from Turso (PDS background worker deletes dereferenced blobs)
    let after;
    for (let i = 0; i < 10; i++) {
        after = await client.execute({ sql: "SELECT 1 FROM blobs WHERE cid = ?", args: [cid] });
        if (after.rows.length === 0) break;
        await new Promise(r => setTimeout(r, 200));
    }
    assert.equal(after.rows.length, 0, "Blob should have been deleted from Turso after dereferencing");
  });

  it("Takedown Flow: Blobs should be quarantined and unavailable", async () => {
    const handle = `${randomStr(8, "base32")}.test`;
    const userAgent = await createAndLoginUser(handle);

    // 1. Upload a blob
    const data = Buffer.from("problematic-content");
    const upload = await userAgent.uploadBlob(data, { encoding: 'image/png' });
    const cid = upload.data.blob.ref.toString();

    // 2. Takedown the blob (via admin API)
    const adminAgent = new AtpAgent({ service: `http://localhost:${port}` });
    await adminAgent.api.com.atproto.admin.updateSubjectStatus({
        subject: {
            $type: 'com.atproto.admin.defs#repoBlobRef',
            did: userAgent.session.did,
            cid: cid
        },
        takedown: {
            applied: true,
            ref: 'test-takedown'
        }
    }, {
        headers: { authorization: `Basic ${Buffer.from("admin:admin").toString('base64')}` },
        encoding: 'application/json'
    });

    // 3. Verify it is quarantined in Turso
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({ 
        sql: "SELECT is_quarantined FROM blobs WHERE cid = ?", 
        args: [cid] 
    });
    assert.equal(result.rows[0].is_quarantined, 1, "Blob should be marked as quarantined in Turso");

    // 4. Verify it's unavailable via API
    try {
        await userAgent.api.com.atproto.sync.getBlob({
            did: userAgent.session.did,
            cid: cid
        });
        assert.fail("Should have thrown 400/BlobNotFound");
    } catch (e) {
        assert.equal(e.status, 400);
    }

    // 5. Unquarantine
    await adminAgent.api.com.atproto.admin.updateSubjectStatus({
        subject: {
            $type: 'com.atproto.admin.defs#repoBlobRef',
            did: userAgent.session.did,
            cid: cid
        },
        takedown: {
            applied: false
        }
    }, {
        headers: { authorization: `Basic ${Buffer.from("admin:admin").toString('base64')}` },
        encoding: 'application/json'
    });

    // 6. Verify it's available again
    const back = await client.execute({ sql: "SELECT is_quarantined FROM blobs WHERE cid = ?", args: [cid] });
    assert.equal(back.rows[0].is_quarantined, 0);
    
    const getRes = await userAgent.api.com.atproto.sync.getBlob({
        did: userAgent.session.did,
        cid: cid
    });
    assert.isTrue(getRes.success);
  });
});
