const { AtpAgent } = require("@atproto/api");
const { assert } = require("chai");
const { PDS, envToCfg, envToSecrets } = require("@atproto/pds");
const { Secp256k1Keypair, randomStr } = require("@atproto/crypto");

describe("PDS Server", () => {
  let pds;
  let agent;
  let port;

  before(async () => {
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
    pds = await PDS.create(cfg, secrets);
    await pds.start();
    agent = new AtpAgent({ service: `http://localhost:${port}` });
  });

  after(async () => {
    if (pds) {
      await pds.destroy();
    }
  });

  it("should respond to describeServer", async () => {
    const response = await agent.api.com.atproto.server.describeServer();
    assert.isTrue(response.success);
    assert.isObject(response.data);
    assert.isFalse(response.data.inviteCodeRequired);
    assert.isTrue(Array.isArray(response.data.availableUserDomains));
    assert.deepEqual(response.data.availableUserDomains, [".test"]);
  });

  it("should allow creating an account", async () => {
    const handle = `${randomStr(8, "base32")}.test`;
    const response = await agent.createAccount({
      email: `testuser${Date.now()}@example.com`,
      handle: handle,
      password: "password123",
    });
    assert.isTrue(response.success);
    assert.isString(response.data.accessJwt);
    assert.isString(response.data.refreshJwt);
    assert.equal(response.data.handle, handle);
    assert.isString(response.data.did);
  });
  
  describe("Authenticated operations", () => {
    const user = {
      handle: `${randomStr(8, "base32")}.test`,
      password: "password123",
      email: `testuser${Date.now()}@example.com`,
    };
    let userAgent;
    let postUri;
    let postCid;

    before(async () => {
      await agent.createAccount(user);
      userAgent = new AtpAgent({ service: `http://localhost:${port}` });
      await userAgent.login({
        identifier: user.handle,
        password: user.password,
      });
    });

    it("should create a post", async () => {
      const record = {
        $type: "app.bsky.feed.post",
        text: "Hello, world!",
        createdAt: new Date().toISOString(),
      };
      const response = await userAgent.api.com.atproto.repo.createRecord({
        repo: userAgent.session.did,
        collection: "app.bsky.feed.post",
        record,
      });
      assert.isObject(response.data);
      assert.isString(response.data.uri);
      assert.isString(response.data.cid);
      postUri = response.data.uri;
      postCid = response.data.cid;
    });

    it("should get the created post", async () => {
        const rkey = postUri.split('/').pop();
        const response = await userAgent.api.com.atproto.repo.getRecord({
            repo: userAgent.session.did,
            collection: 'app.bsky.feed.post',
            rkey,
        });

        assert.isObject(response.data);
        assert.equal(response.data.uri, postUri);
        assert.equal(response.data.value.text, "Hello, world!");
    });

    it("should delete the created post", async () => {
        const rkey = postUri.split('/').pop();
        await userAgent.api.com.atproto.repo.deleteRecord({
            repo: userAgent.session.did,
            collection: 'app.bsky.feed.post',
            rkey,
        });

      // Verify the post is gone
      try {
        await userAgent.api.com.atproto.repo.getRecord({
            repo: userAgent.session.did,
            collection: 'app.bsky.feed.post',
            rkey,
        });
        assert.fail("Should have thrown an error");
      } catch (error) {
        assert.equal(error.error, 'RecordNotFound');
      }
    });
  });
});
