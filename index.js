const { TestPds } = require("@atproto/dev-env");

const port = process.env.PORT || 8080;
const hostname = process.env.HOSTNAME || `localhost`;
const domains = process.env.DOMAINS || ".test";

async function main() {

  const pds = await TestPds.create({
    devMode: false,
    port: port,
    hostname: hostname,
    serviceHandleDomains: [domains],
  });

  console.log(`Running on ${hostname}.`);

}

main();
