"use strict";

const { PDS, httpLogger } = require("@atproto/pds");

class PDSServer {
  constructor(cfg, secrets) {
    this.pds = null;
    this.cfg = cfg;
    this.secrets = secrets;
  }

  async start(overrides = {}) {
    this.pds = await PDS.create(this.cfg, this.secrets, overrides);
    if (overrides.blobstore) {
      this.pds.ctx.blobstore = overrides.blobstore;
      this.pds.ctx.actorStore.resources.blobstore = overrides.blobstore;
    }
    await this.pds.start();
    httpLogger.info("pds has started");

    this.pds.app.get("/tls-check", (req, res) => {
      this.#checkHandleRoute(req, res);
    });

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      await this.destroy();
    });
    
    return this.pds;
  }

  async destroy() {
    httpLogger.info("pds is stopping");
    if (this.pds) {
      await this.pds.destroy();
    }
    httpLogger.info("pds is stopped");
  }

  async #checkHandleRoute(req, res) {
    try {
      const { domain } = req.query;
      if (!domain || typeof domain !== "string") {
        return res.status(400).json({
          error: "InvalidRequest",
          message: "bad or missing domain query param",
        });
      }
      if (domain === this.pds.ctx.cfg.service.hostname) {
        return res.json({ success: true });
      }
      const isHostedHandle = this.pds.ctx.cfg.identity.serviceHandleDomains.find(
        (avail) => domain.endsWith(avail)
      );
      if (!isHostedHandle) {
        return res.status(400).json({
          error: "InvalidRequest",
          message: "handles are not provided on this domain",
        });
      }
      const account = await this.pds.ctx.accountManager.getAccount(domain);
      if (!account) {
        return res.status(404).json({
          error: "NotFound",
          message: "handle not found for this domain",
        });
      }
      return res.json({ success: true });
    } catch (err) {
      httpLogger.error({ err }, "check handle failed");
      return res.status(500).json({
        error: "InternalServerError",
        message: "Internal Server Error",
      });
    }
  }
}

module.exports = PDSServer;
