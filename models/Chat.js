// models/Chat.js
const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    participants: [{
        userId: String,
        pseudo: String
    }],
    messages: [{
        senderId: String,
        senderPseudo: String,
        recipientId: String,
        content: String,
        text: String,
        timestamp: { type: Date, default: Date.now },
        type: { type: String, default: 'text' }
    }],
    messageCount: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    lastActivity: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
    endedAt: Date,
    endReason: String
}, {
    timestamps: true
});

module.exports = mongoose.model('Chat', chatSchema);
