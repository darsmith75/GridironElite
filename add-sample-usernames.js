const db = require('./database');

console.log('Adding sample social media usernames to player profiles...');

// Sample usernames
const sampleUsernames = [
  {
    email: 'marcus.johnson@email.com',
    hudl: 'MarcusJohnson_QB',
    instagram: '@mjohnson_fb',
    twitter: '@MarcusJ_FB'
  },
  {
    email: 'tyrell.washington@email.com',
    hudl: 'TyrellWashington_WR',
    instagram: '@tyrellw_athlete',
    twitter: '@TyrellW_23'
  },
  {
    email: 'james.rodriguez@email.com',
    hudl: 'JamesRodriguez_RB',
    instagram: '@jrod_football',
    twitter: '@JRod_FB'
  },
  {
    email: 'devon.harris@email.com',
    hudl: 'DevonHarris_LB',
    instagram: '@devon_harris_fb',
    twitter: '@DevonH_Football'
  },
  {
    email: 'brandon.mitchell@email.com',
    hudl: 'BrandonMitchell_DL',
    instagram: '@bmitchell_athlete',
    twitter: '@BMitchell_FB'
  }
];

async function main() {
  let updateCount = 0;

  for (const user of sampleUsernames) {
    const dbUser = await db.prepare('SELECT id FROM users WHERE email = ?').get(user.email);

    if (dbUser) {
      await db.prepare(`
        UPDATE player_profiles
        SET hudl_username = ?, instagram_username = ?, twitter_username = ?
        WHERE user_id = ?
      `).run(user.hudl, user.instagram, user.twitter, dbUser.id);

      console.log(`Updated usernames for ${user.email}`);
      updateCount++;
    } else {
      console.log(`User not found: ${user.email}`);
    }
  }

  console.log(`\nSuccessfully updated ${updateCount} player profiles with social media usernames!`);
}

main()
  .catch(error => {
    console.error('Error updating sample usernames:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
