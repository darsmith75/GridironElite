const Database = require('better-sqlite3-multiple-ciphers');
const db = new Database('football_platform.db');

console.log('Adding sample messages...');

// Get the agent user ID
const agent = db.prepare('SELECT id FROM users WHERE email = ?').get('agent@example.com');
if (!agent) {
  console.error('Agent user not found!');
  process.exit(1);
}

// Get all player users
const players = db.prepare('SELECT id, email FROM users WHERE role = ?').all('player');
console.log(`Found ${players.length} players`);

if (players.length === 0) {
  console.error('No players found!');
  process.exit(1);
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

// Clear existing messages
db.prepare('DELETE FROM messages').run();
console.log('Cleared existing messages');

// Add messages for each player
let messageCount = 0;
const now = new Date();

players.forEach((player, index) => {
  // Create a conversation with varied message counts (2-5 messages per conversation)
  const numMessages = Math.floor(Math.random() * 4) + 2;
  
  for (let i = 0; i < numMessages; i++) {
    let senderId, receiverId, messageText;
    
    // Alternate between agent and player messages
    if (i % 2 === 0) {
      // Agent sends first
      senderId = agent.id;
      receiverId = player.id;
      if (i === 0) {
        messageText = messageTemplates[0].messages[index % messageTemplates[0].messages.length];
      } else {
        messageText = messageTemplates[2].followUp[Math.floor(Math.random() * messageTemplates[2].followUp.length)];
      }
    } else {
      // Player responds
      senderId = player.id;
      receiverId = agent.id;
      messageText = messageTemplates[1].messages[Math.floor(Math.random() * messageTemplates[1].messages.length)];
    }
    
    // Create timestamps that are progressively older for each conversation
    const hoursAgo = (index * 24) + (i * 2); // Space out conversations by days, messages by hours
    const timestamp = new Date(now.getTime() - (hoursAgo * 60 * 60 * 1000));
    
    db.prepare(`
      INSERT INTO messages (sender_id, recipient_id, message, created_at)
      VALUES (?, ?, ?, ?)
    `).run(senderId, receiverId, messageText, timestamp.toISOString());
    
    messageCount++;
  }
  
  console.log(`Added ${numMessages} messages for conversation with ${player.email}`);
});

console.log(`\nSuccessfully added ${messageCount} sample messages!`);
console.log(`Created conversations between agent@example.com and ${players.length} players`);

db.close();
