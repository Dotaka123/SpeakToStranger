// models/Feedback.js
const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true
    },
    userPseudo: {
        type: String,
        default: 'Anonyme'
    },
    message: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['suggestion', 'bug', 'compliment', 'complaint', 'other'],
        default: 'other'
    },
    status: {
        type: String,
        enum: ['pending', 'read', 'resolved'],
        default: 'pending'
    },
    response: {
        type: String,
        default: null
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Feedback', feedbackSchema);
