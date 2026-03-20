const bcrypt = require('bcryptjs');
const db = require('./database');

async function addGeorge() {
    const email = 'george.parkinson@email.com';
    const password = 'player123';
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if user already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    let userId;

    if (existing) {
        userId = existing.id;
        console.log('User already exists with id:', userId);
    } else {
        const result = db.prepare(
            'INSERT INTO users (email, password, role, full_name) VALUES (?, ?, ?, ?)'
        ).run(email, hashedPassword, 'player', 'George J Parkinson IV');
        userId = result.lastInsertRowid;
        console.log('Created user with id:', userId);
    }

    // Check if profile exists
    const existingProfile = db.prepare('SELECT id FROM player_profiles WHERE user_id = ?').get(userId);
    if (existingProfile) {
        // Update existing profile
        db.prepare(`UPDATE player_profiles SET
            full_name = ?,
            high_school = ?,
            graduation_year = ?,
            position = ?,
            height = ?,
            weight = ?,
            forty_yard_dash = ?,
            bench_press = ?,
            squat = ?,
            vertical_jump = ?,
            shuttle_5_10_5 = ?,
            l_drill = ?,
            broad_jump = ?,
            power_clean = ?,
            single_leg_squat = ?,
            gpa = ?,
            bio = ?,
            profile_picture = ?,
            highlight_videos = ?,
            additional_images = ?,
            college_offers = ?,
            hudl_link = ?,
            hudl_username = ?,
            instagram_link = ?,
            instagram_username = ?,
            twitter_link = ?,
            twitter_username = ?
            WHERE user_id = ?`
        ).run(
            'George J Parkinson IV',
            'Malvern Prep',
            2028,
            'DL',
            '6\'4"',
            235,
            4.55,
            352,
            405,
            34.5,
            4.35,
            7.03,
            10,
            308,
            400,
            3.99,
            'High-motor Edge with a quick first step and a relentless pursuit to the ball. Specializing in speed-to-power transitions and setting a hard edge in the run game.',
            '/uploads/1772316420507-7fbe7ce12__6__3084_Original.jpeg',
            JSON.stringify([
                '/uploads/1772376112490-twitsave.com_tF0NKawhP0De_3nS.mp4',
                '/uploads/1772376185675-twitsave.com_nQpUx7JXO579bYhu.mp4'
            ]),
            JSON.stringify([
                '/uploads/1772375289802-G1i0byKXYAQnWk1.jpg',
                '/uploads/1772375289802-GB2IC6JW8AAtTh7.jpg',
                '/uploads/1772375289812-footballPLayer.jpg'
            ]),
            JSON.stringify([
                '/uploads/1772376398413-Duke_Athletics_logo.svg.png',
                '/uploads/1772376398414-LSU-favicon.png',
                '/uploads/1772376398414-Ohio-State-Buckeyes-Logo-1991.png',
                '/uploads/1772376398416-Penn_State_Nittany_Lions_logo.svg.png',
                '/uploads/1772376398417-Pitt_Panthers_wordmark.svg.png',
                '/uploads/1772376398418-Texas_A&M_University_logo.svg.png',
                '/uploads/1772376398419-Wake_Forest_University_Athletic_logo.svg.png',
                '/uploads/1772378185640-b1ad46ec57029cbff79c5f9c56135db3.jpg',
                '/uploads/1772378185642-Virginia-Tech-Hokies-logo.png'
            ]),
            'https://www.hudl.com/profile/22569485/George-Parkinson-IV',
            'George Parkinson IV',
            'https://www.instagram.com/gpark.4/',
            '@gpark_4',
            'https://x.com/parkinsoniv',
            '@ParkinsonIV',
            userId
        );
        console.log('Updated existing profile for George J Parkinson IV');
    } else {
        // Insert new profile
        db.prepare(`INSERT INTO player_profiles (
            user_id, full_name, high_school, graduation_year, position,
            height, weight, forty_yard_dash, bench_press, squat,
            vertical_jump, shuttle_5_10_5, l_drill, broad_jump,
            power_clean, single_leg_squat, gpa, bio,
            profile_picture, highlight_videos, additional_images, college_offers,
            hudl_link, hudl_username, instagram_link, instagram_username,
            twitter_link, twitter_username
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            userId,
            'George J Parkinson IV',
            'Malvern Prep',
            2028,
            'DL',
            '6\'4"',
            235,
            4.55,
            352,
            405,
            34.5,
            4.35,
            7.03,
            10,
            308,
            400,
            3.99,
            'High-motor Edge with a quick first step and a relentless pursuit to the ball. Specializing in speed-to-power transitions and setting a hard edge in the run game.',
            '/uploads/1772316420507-7fbe7ce12__6__3084_Original.jpeg',
            JSON.stringify([
                '/uploads/1772376112490-twitsave.com_tF0NKawhP0De_3nS.mp4',
                '/uploads/1772376185675-twitsave.com_nQpUx7JXO579bYhu.mp4'
            ]),
            JSON.stringify([
                '/uploads/1772375289802-G1i0byKXYAQnWk1.jpg',
                '/uploads/1772375289802-GB2IC6JW8AAtTh7.jpg',
                '/uploads/1772375289812-footballPLayer.jpg'
            ]),
            JSON.stringify([
                '/uploads/1772376398413-Duke_Athletics_logo.svg.png',
                '/uploads/1772376398414-LSU-favicon.png',
                '/uploads/1772376398414-Ohio-State-Buckeyes-Logo-1991.png',
                '/uploads/1772376398416-Penn_State_Nittany_Lions_logo.svg.png',
                '/uploads/1772376398417-Pitt_Panthers_wordmark.svg.png',
                '/uploads/1772376398418-Texas_A&M_University_logo.svg.png',
                '/uploads/1772376398419-Wake_Forest_University_Athletic_logo.svg.png',
                '/uploads/1772378185640-b1ad46ec57029cbff79c5f9c56135db3.jpg',
                '/uploads/1772378185642-Virginia-Tech-Hokies-logo.png'
            ]),
            'https://www.hudl.com/profile/22569485/George-Parkinson-IV',
            'George Parkinson IV',
            'https://www.instagram.com/gpark.4/',
            '@gpark_4',
            'https://x.com/parkinsoniv',
            '@ParkinsonIV'
        );
        console.log('Created new profile for George J Parkinson IV');
    }

    console.log('\nGeorge J Parkinson IV is ready!');
    console.log('Login: george.parkinson@email.com / player123');
}

addGeorge().catch(console.error);
