// models/Report.js
const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
    // Utilisez les deux formats pour la compatibilité
    reporterId: { type: String, required: true },
    reportedUserId: { type: String, required: true },
    
    // Champs alternatifs pour compatibilité
    reportedBy: { type: String },
    reportedUser: { type: String },
    
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    reason: { type: String, default: 'Comportement inapproprié' },
    details: String,
    
    status: {
        type: String,
        enum: ['pending', 'reviewing', 'resolved', 'dismissed'],
        default: 'pending'
    },
    
    action: {
        type: String,
        enum: ['none', 'warning', 'block', 'ban'],
        default: 'none'
    },
    
    reviewedBy: String,
    reviewedAt: Date,
    reviewNotes: String,
    
    timestamp: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});

// Index pour les recherches
reportSchema.index({ reporterId: 1 });
reportSchema.index({ reportedUserId: 1 });
reportSchema.index({ status: 1 });
reportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
