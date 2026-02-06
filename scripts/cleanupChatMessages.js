// scripts/cleanupChatMessages.js

const mongoose = require('mongoose');
require('dotenv').config();

async function cleanupChatMessages() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connecté à MongoDB');
        
        const { Chat } = require('../models');
        
        // Supprimer le champ messages de tous les chats
        const result = await Chat.updateMany(
            { messages: { $exists: true } },
            { $unset: { messages: "" } }
        );
        
        console.log(`✅ Nettoyé ${result.modifiedCount} chats`);
        console.log('Les messages sont maintenant uniquement dans la collection Messages');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Erreur:', error);
        process.exit(1);
    }
}

cleanupChatMessages();
