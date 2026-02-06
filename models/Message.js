// models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    chatId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Chat',
        required: true,
        index: true  // Index pour recherche rapide
    },
    senderId: { 
        type: String, 
        required: true,
        index: true 
    },
    senderPseudo: String,
    recipientId: String,
    content: String,
    type: {
        type: String,
        enum: ['text', 'image', 'video', 'audio', 'file', 'sticker'],
        default: 'text'
    },
    mediaUrl: String,  // Pour stocker l'URL des médias
    timestamp: { 
        type: Date, 
        default: Date.now,
        index: true  // Index pour tri chronologique
    },
    isDeleted: { type: Boolean, default: false }
}, {
    timestamps: true
});

// Index composé pour recherche efficace
messageSchema.index({ chatId: 1, timestamp: -1 });

// TTL (Time To Live) - Suppression automatique après 30 jours
messageSchema.index({ timestamp: 1 }, { expireAfterSeconds: 2592000 }); // 30 jours

module.exports = mongoose.model('Message', messageSchema);
