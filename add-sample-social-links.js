const db = require('./database');

console.log('Adding sample social media links to player profiles...');

// Sample social media links
const sampleLinks = [
  {
    email: 'marcus.johnson@email.com',
    hudl: 'https://www.hudl.com/profile/12345678/Marcus-Johnson',
    instagram: 'https://www.instagram.com/mjohnson_fb',
    twitter: 'https://twitter.com/MarcusJ_FB'
  },
  {
    email: 'tyrell.washington@email.com',
    hudl: 'https://www.hudl.com/profile/23456789/Tyrell-Washington',
    instagram: 'https://www.instagram.com/tyrellw_athlete',
    twitter: 'https://twitter.com/TyrellW_23'
  },
  {
    email: 'james.rodriguez@email.com',
    hudl: 'https://www.hudl.com/profile/34567890/James-Rodriguez',
    instagram: 'https://www.instagram.com/jrod_football',
    twitter: 'https://twitter.com/JRod_FB'
  },
  {
    email: 'devon.harris@email.com',
    hudl: 'https://www.hudl.com/profile/45678901/Devon-Harris',
    instagram: 'https://www.instagram.com/devon_harris_fb',
    twitter: 'https://twitter.com/DevonH_Football'
  },
  {
    email: 'brandon.mitchell@email.com',
    hudl: 'https://www.hudl.com/profile/56789012/Brandon-Mitchell',
    instagram: 'https://www.instagram.com/bmitchell_athlete',
    twitter: 'https://twitter.com/BMitchell_FB'
  }
];

async function main() {
  let updateCount = 0;

  for (const link of sampleLinks) {
    const user = await db.prepare('SELECT id FROM users WHERE email = ?').get(link.email);

    if (user) {
      await db.prepare(`
        UPDATE player_profiles
        SET hudl_link = ?, instagram_link = ?, twitter_link = ?
        WHERE user_id = ?
      `).run(link.hudl, link.instagram, link.twitter, user.id);

      console.log(`Updated social links for ${link.email}`);
      updateCount++;
    } else {
      console.log(`User not found: ${link.email}`);
    }
  }

  console.log(`\nSuccessfully updated ${updateCount} player profiles with social media links!`);
}

main()
  .catch(error => {
    console.error('Error updating social links:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
