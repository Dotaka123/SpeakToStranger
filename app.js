const express = require('express');
const bodyParser = require('body-parser');
const cron = require('node-cron');
require('./config/database');
const { User, Chat, Queue, Report, Stats } = require('./models');
const MessageHandler = require('./handlers/messageHandler');
const ChatManager = require('./handlers/chatManager');
const UserManager = require('./handlers/userManager');

const app = express();
app.use(bodyParser.json());

// Configuration
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || 'VOTRE_TOKEN_ICI';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'VOTRE_VERIFY_TOKEN';
const APP_SECRET = process.env.APP_SECRET || 'VOTRE_APP_SECRET';

// Initialisation des gestionnaires
const userManager = new UserManager();
const chatManager = new ChatManager();
const messageHandler = new MessageHandler(chatManager, userManager);

// Webhook verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode && token === VERIFY_TOKEN) {
        console.log('✅ Webhook vérifié');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Réception des messages
app.post('/webhook', async (req, res) => {
    const body = req.body;
    
    if (body.object === 'page') {
        for (const entry of body.entry) {
            for (const event of entry.messaging) {
                try {
                    await messageHandler.handleEvent(event);
                } catch (error) {
                    console.error('Erreur traitement événement:', error);
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// Routes API pour statistiques
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await Stats.findOne().sort({ date: -1 });
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/active-chats', async (req, res) => {
    try {
        const activeChats = await Chat.find({ isActive: true }).count();
        res.json({ activeChats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Tâches planifiées
cron.schedule('*/5 * * * *', async () => {
    // Nettoyer les utilisateurs inactifs de la file d'attente
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    await Queue.deleteMany({ joinedAt: { $lt: fiveMinutesAgo } });
});

cron.schedule('0 * * * *', async () => {
    // Générer les statistiques horaires
    await generateStats();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🤖 SpeakToStranger bot démarré sur le port ${PORT}`);
});
