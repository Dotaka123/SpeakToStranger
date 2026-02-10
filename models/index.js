const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    facebookId: { type: String, required: true, unique: true },
    pseudo: { type: String, default: 'Anonyme' },
    createdAt: { type: Date, default: Date.now },
    totalConversations: { type: Number, default: 0 },
    totalMessages: { type: Number, default: 0 },
    rating: { type: Number, default: 5 },
    ratingCount: { type: Number, default: 0 },
    isBlocked: { type: Boolean, default: false },
    blockedAt: { type: Date },
    blockReason: { type: String },
    warningCount: { type: Number, default: 0 },
    warnings: [{
        date: { type: Date },
        reason: { type: String },
        sentBy: { type: String }
    }],
    blockedUsers: [{ type: String }],
    interests: [{ type: String }],
    language: { type: String, default: 'fr' },
    status: { 
        type: String, 
        enum: ['offline', 'online', 'waiting', 'chatting', 'blocked'],
        default: 'offline' 
    },
    currentChat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    lastActivity: { type: Date, default: Date.now },
    waitingForPseudo: { type: Boolean, default: false },
    
    // 🆕 NOUVEAUX CHAMPS POUR LES AMÉLIORATIONS
    favorites: [{
        userId: { type: String },
        pseudo: { type: String },
        addedAt: { type: Date, default: Date.now }
    }],
    conversationHistory: [{
        partnerId: { type: String },
        partnerPseudo: { type: String },
        chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
        endedAt: { type: Date },
        duration: { type: Number }, // en secondes
        messageCount: { type: Number },
        rating: { type: Number }
    }],
    preferredTheme: { type: String, default: null }, // Thème favori affiché sur le profil
    preferredThemes: [{ type: String }], // Sport, Musique, Gaming, etc.
    badges: [{
        name: { type: String }, // "Vérifié", "Respectueux", etc.
        earnedAt: { type: Date, default: Date.now },
        icon: { type: String }
    }],
    respectScore: { type: Number, default: 0 }, // Score de 0 à 100
    positiveRatings: { type: Number, default: 0 },
    negativeRatings: { type: Number, default: 0 },
    totalChatDuration: { type: Number, default: 0 }, // en secondes
    reconnectRequests: [{
        targetUserId: { type: String },
        requestedAt: { type: Date, default: Date.now },
        status: { type: String, enum: ['pending', 'accepted', 'declined', 'expired'], default: 'pending' }
    }]
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
    theme: { type: String }, // Sport, Musique, Gaming, etc.
    messageCount: { type: Number, default: 0 },
    ratings: [{
        userId: { type: String },
        rating: { type: Number, min: 1, max: 5 },
        comment: { type: String }
    }],
    
    // 🆕 NOUVEAUX CHAMPS
    feedbacks: [{
        userId: { type: String },
        rating: { type: String, enum: ['excellent', 'good', 'average', 'bad'] },
        submittedAt: { type: Date, default: Date.now }
    }],
    duration: { type: Number }, // Durée en secondes
    endReason: { type: String, enum: ['normal', 'report', 'reported', 'timeout', 'inactivity', 'mutual', 'error'] }
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
    reportedBy: { type: String },      // alias de reporterId (compatibilité)
    reportedUser: { type: String },    // alias de reportedUserId (compatibilité)
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    reason: { type: String, required: true },
    description: { type: String },
    status: { 
        type: String, 
        enum: ['pending', 'reviewed', 'resolved'], 
        default: 'pending' 
    },
    createdAt: { type: Date, default: Date.now },
    timestamp: { type: Date, default: Date.now },
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
const Message = require('./Message');
const Feedback = require('./Feedback');

module.exports = { User, Chat, Queue, Report, Stats, Message, Feedback };
