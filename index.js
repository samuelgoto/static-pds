import { TestPds } from "@atproto/dev-env";

//console.log(TestPds);

const port = process.env.PORT || 8080;

const pds = await TestPds.create({
   port: port,
   inviteRequired: false,
});

console.log(`Running on ${port}`);
// console.log(pds);

const client = pds.getClient();

// console.log(client);
// console.log(client.session);
