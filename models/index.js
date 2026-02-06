const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    facebookId: { type: String, required: true, unique: true },
    pseudo: { type: String, default: 'Anonyme' }, // ⚠️ Retirer "required: true" ou ajouter une valeur par défaut
    createdAt: { type: Date, default: Date.now },
    totalConversations: { type: Number, default: 0 },
    totalMessages: { type: Number, default: 0 },
    rating: { type: Number, default: 5 },
    ratingCount: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    blockedAt: { type: Date }, // Ajouter ce champ
    blockReason: { type: String }, // Ajouter ce champ
    warningCount: { type: Number, default: 0 }, // Ajouter ce champ
    warnings: [{ // Ajouter ce champ
        date: { type: Date },
        reason: { type: String },
        sentBy: { type: String }
    }],
    blockedUsers: [{ type: String }],
    interests: [{ type: String }],
    language: { type: String, default: 'fr' },
    status: { 
        type: String, 
        enum: ['offline', 'online', 'waiting', 'chatting', 'blocked'], // Ajouter 'blocked'
        default: 'offline' 
    },
    currentChat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    lastActivity: { type: Date, default: Date.now },
    waitingForPseudo: { type: Boolean, default: false } // Ajouter ce champ
});
// Schéma Conversation
const chatSchema = new mongoose.Schema({
    participants: [{
        userId: { type: String, required: true },
        pseudo: { type: String, required: true },
        joined: { type: Date, default: Date.now },
        left: { type: Date }
    }],
    messages: [{
        senderId: { type: String, required: true },
        senderPseudo: { type: String, required: true },
        content: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        isReported: { type: Boolean, default: false }
    }],
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    isActive: { type: Boolean, default: true },
    theme: { type: String },
    messageCount: { type: Number, default: 0 },
    ratings: [{
        userId: { type: String },
        rating: { type: Number, min: 1, max: 5 },
        comment: { type: String }
    }]
});

// Schéma File d'attente
const queueSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    pseudo: { type: String, required: true },
    interests: [{ type: String }],
    language: { type: String, default: 'fr' },
    joinedAt: { type: Date, default: Date.now },
    priority: { type: Number, default: 0 }
});

// Schéma Signalement
const reportSchema = new mongoose.Schema({
    reporterId: { type: String, required: true },
    reportedUserId: { type: String, required: true },
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    reason: { type: String, required: true },
    description: { type: String },
    status: { 
        type: String, 
        enum: ['pending', 'reviewed', 'resolved'], 
        default: 'pending' 
    },
    createdAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date },
    action: { type: String }
});

// Schéma Statistiques
const statsSchema = new mongoose.Schema({
    date: { type: Date, default: Date.now },
    totalUsers: { type: Number, default: 0 },
    activeUsers: { type: Number, default: 0 },
    totalChats: { type: Number, default: 0 },
    activeChats: { type: Number, default: 0 },
    totalMessages: { type: Number, default: 0 },
    averageChatDuration: { type: Number, default: 0 },
    averageMessagesPerChat: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);
const Chat = mongoose.model('Chat', chatSchema);
const Queue = mongoose.model('Queue', queueSchema);
const Report = mongoose.model('Report', reportSchema);
const Stats = mongoose.model('Stats', statsSchema);

module.exports = { User, Chat, Queue, Report, Stats };
