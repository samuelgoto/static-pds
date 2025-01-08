const { TestPds } = require("@atproto/dev-env");

// https://char.lt/blog/2024/10/atproto-pds/                                                                                                                              

const port = process.env.PORT || 8080;
const hostname = process.env.HOSTNAME || `localhost`;
const domains = process.env.DOMAINS || ".test";

console.log(`$HOSTNAME=${process.env.HOSTNAME}`);
console.log(`$DOMAINS=${process.env.DOMAINS}`);

async function main() {

  const pds = await TestPds.create({
    devMode: false,
    port: port,
    hostname: hostname,
    serviceHandleDomains: [domains],
    bskyAppViewUrl: "https://api.pop1.bsky.app",
    bskyAppViewDid: "did:web:api.bsky.app",
  });

  console.log(`Running on ${hostname}.`);
}

main();
