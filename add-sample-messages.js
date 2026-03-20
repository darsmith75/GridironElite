const db = require('./database');

console.log('Adding sample messages...');

async function main() {
  const agent = await db.prepare('SELECT id FROM users WHERE email = ?').get('agent@example.com');
  if (!agent) {
    throw new Error('Agent user not found!');
  }

  const players = await db.prepare('SELECT id, email FROM users WHERE role = ?').all('player');
  console.log(`Found ${players.length} players`);

  if (players.length === 0) {
    throw new Error('No players found!');
  }

// Sample message templates
const messageTemplates = [
  {
    from: 'agent',
    messages: [
      "Hi! I've been reviewing your profile and I'm really impressed with your stats. Would love to discuss potential opportunities.",
      "I noticed your 40-yard dash time is excellent. Have you been working with a speed coach?",
      "Your highlight reel looks great! I'd like to set up a call to discuss your college recruitment goals.",
      "I saw your recent game footage. Your performance was outstanding! Let's talk about next steps.",
      "Your academic performance combined with your athletic ability makes you a strong candidate. Interested in chatting?"
    ]
  },
  {
    from: 'player',
    messages: [
      "Thanks for reaching out! I'd definitely be interested in learning more.",
      "Yes, I've been training hard. Would love to discuss opportunities.",
      "I appreciate you taking the time to review my profile. When would be a good time to talk?",
      "Thank you! I'm very interested in exploring my options for college football.",
      "That sounds great! I'm looking for guidance on the recruitment process."
    ]
  },
  {
    from: 'agent',
    followUp: [
      "Great! I'll send you some information about programs that might be a good fit.",
      "Perfect! Let me put together a list of schools that are looking for athletes with your profile.",
      "Excellent! I'll reach out to some coaches I know who would be interested in your skills.",
      "Wonderful! I think we can find some great opportunities for you.",
      "That's what I like to hear! Let's work together to find the right program for you."
    ]
  }
];

  await db.prepare('DELETE FROM messages').run();
  console.log('Cleared existing messages');

// Add messages for each player
let messageCount = 0;
const now = new Date();

  for (const [index, player] of players.entries()) {
    const numMessages = Math.floor(Math.random() * 4) + 2;

    for (let i = 0; i < numMessages; i++) {
      let senderId;
      let receiverId;
      let messageText;

      if (i % 2 === 0) {
        senderId = agent.id;
        receiverId = player.id;
        if (i === 0) {
          messageText = messageTemplates[0].messages[index % messageTemplates[0].messages.length];
        } else {
          messageText = messageTemplates[2].followUp[Math.floor(Math.random() * messageTemplates[2].followUp.length)];
        }
      } else {
        senderId = player.id;
        receiverId = agent.id;
        messageText = messageTemplates[1].messages[Math.floor(Math.random() * messageTemplates[1].messages.length)];
      }

      const hoursAgo = (index * 24) + (i * 2);
      const timestamp = new Date(now.getTime() - (hoursAgo * 60 * 60 * 1000));

      await db.prepare(`
        INSERT INTO messages (sender_id, recipient_id, message, created_at)
        VALUES (?, ?, ?, ?)
      `).run(senderId, receiverId, messageText, timestamp.toISOString());

      messageCount++;
    }

    console.log(`Added ${numMessages} messages for conversation with ${player.email}`);
  }

  console.log(`\nSuccessfully added ${messageCount} sample messages!`);
  console.log(`Created conversations between agent@example.com and ${players.length} players`);
}

main()
  .catch(error => {
    console.error('Error adding sample messages:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
