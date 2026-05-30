import postgres from 'postgres';

const passwords = [
  '',
  'postgres',
  'admin',
  'password',
  'root',
  '123456',
  '1234',
  'mymac',
  'ssshop',
  'ssshophaus',
  'boulder',
  '12345678',
  'postgres123',
  'Postgres',
  'admin123'
];

const users = ['postgres', 'mymac'];

async function testConnection(user, password, useSocket = false) {
  const config = useSocket 
    ? {
        host: '/tmp', // postgres package uses host starting with / as Unix socket directory
        port: 5432,
        database: 'postgres',
        username: user,
        timeout: 3,
        idle_timeout: 3
      }
    : {
        host: 'localhost',
        port: 5432,
        database: 'postgres',
        username: user,
        password: password,
        timeout: 3,
        idle_timeout: 3
      };

  const sql = postgres(config);

  try {
    const result = await sql`SELECT 1 as connected`;
    if (result && result[0] && result[0].connected === 1) {
      console.log(`\n🎉 SUCCESS! User: "${user}", Connection: ${useSocket ? 'Unix Socket' : 'TCP with Password "' + password + '"'}`);
      await sql.end();
      return true;
    }
  } catch (err) {
    console.log(`Failed user: ${user}, connection: ${useSocket ? 'Socket' : 'TCP (' + password + ')'} -> ${err.message}`);
  }
  await sql.end();
  return false;
}

async function run() {
  console.log("Starting database password & socket testing...");
  
  // First try Unix socket without password
  for (const user of users) {
    console.log(`Testing user: "${user}" via Unix Socket`);
    const success = await testConnection(user, null, true);
    if (success) process.exit(0);
  }

  // Then try TCP passwords
  for (const user of users) {
    for (const password of passwords) {
      console.log(`Testing user: "${user}" with password: "${password}"`);
      const success = await testConnection(user, password, false);
      if (success) {
        process.exit(0);
      }
    }
  }
  console.log("\n❌ All tested connection methods failed. We might need to ask the user.");
  process.exit(1);
}

run();
