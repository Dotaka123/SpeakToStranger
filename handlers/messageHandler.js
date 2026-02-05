const { User, Chat, Queue, Report } = require('../models');
const FacebookAPI = require('../services/facebookAPI');

class MessageHandler {
    constructor(chatManager, userManager) {
        this.chatManager = chatManager;
        this.userManager = userManager;
        this.fb = new FacebookAPI();
        
        this.commands = {
            '/start': this.handleStart.bind(this),
            '/stop': this.handleStop.bind(this),
            '/next': this.handleNext.bind(this),
            '/report': this.handleReport.bind(this),
            '/block': this.handleBlock.bind(this),
            '/interests': this.handleInterests.bind(this),
            '/stats': this.handleStats.bind(this),
            '/help': this.handleHelp.bind(this),
            '/pseudo': this.handlePseudo.bind(this),
            '/rating': this.handleRating.bind(this)
        };
    }

    async handleEvent(event) {
        if (event.message) {
            await this.handleMessage(event.sender.id, event.message);
        } else if (event.postback) {
            await this.handlePostback(event.sender.id, event.postback);
        }
    }

    async handleMessage(senderId, message) {
        const text = message.text;
        if (!text) return;

        // Vérifier/créer l'utilisateur
        let user = await this.userManager.getOrCreateUser(senderId);
        
        // Vérifier si bloqué
        if (user.isBlocked) {
            await this.fb.sendTextMessage(senderId, "⛔ Votre compte a été temporairement suspendu suite à des signalements.");
            return;
        }

        // Mise à jour de l'activité
        await User.findByIdAndUpdate(user._id, { 
            lastActivity: new Date(),
            status: 'online'
        });

        // Traiter les commandes
        const command = text.toLowerCase().split(' ')[0];
        if (this.commands[command]) {
            await this.commands[command](senderId, text);
            return;
        }

        // Si en conversation, relayer le message
        if (user.currentChat) {
            await this.relayMessage(senderId, text);
        } else {
            await this.sendWelcomeMessage(senderId);
        }
    }

    async handleStart(senderId, text) {
        const user = await User.findOne({ facebookId: senderId });
        
        if (user.currentChat) {
            await this.fb.sendTextMessage(senderId, "❌ Vous êtes déjà en conversation. Tapez /stop pour terminer.");
            return;
        }

        // Ajouter à la file d'attente
        await this.chatManager.addToQueue(senderId);
        
        // Chercher un match
        const match = await this.chatManager.findMatch(senderId);
        
        if (match) {
            await this.chatManager.createChat(senderId, match.userId);
        } else {
            await this.fb.sendQuickReplies(senderId, 
                "⏳ Recherche d'un étranger... En attendant, voulez-vous définir vos centres d'intérêt ?",
                [
                    { title: "📝 Définir intérêts", payload: "SET_INTERESTS" },
                    { title: "⏭️ Attendre", payload: "WAIT" }
                ]
            );
        }
    }

    async handleStop(senderId) {
        const user = await User.findOne({ facebookId: senderId });
        
        if (!user.currentChat) {
            await this.fb.sendTextMessage(senderId, "❌ Vous n'êtes pas en conversation.");
            return;
        }

        await this.chatManager.endChat(senderId);
    }

    async handleNext(senderId) {
        await this.handleStop(senderId);
        setTimeout(() => this.handleStart(senderId), 1000);
    }

// Dans messageHandler.js - Mise à jour de handleReport
async handleReport(senderId, text) {
    const user = await User.findOne({ facebookId: senderId });
    
    if (!user.currentChat) {
        await this.fb.sendTextMessage(senderId, "❌ Aucune conversation active à signaler.");
        return;
    }

    const reason = text.substring(8).trim();
    if (!reason) {
        await this.fb.sendTextMessage(senderId, "📝 Usage: /report [raison du signalement]");
        return;
    }

    const chat = await Chat.findById(user.currentChat);
    const otherUser = chat.participants.find(p => p.userId !== senderId);
    
    // Créer le signalement
    const report = await Report.create({
        reporterId: senderId,
        reportedUserId: otherUser.userId,
        chatId: chat._id,
        reason: reason
    });

    // Notifier les administrateurs
    const NotificationService = require('../services/notificationService');
    const notificationService = new NotificationService();
    await notificationService.notifyNewReport(report);

    await this.fb.sendTextMessage(senderId, "✅ Signalement enregistré. Nous examinerons la situation dans les plus brefs délais.");
    
    // Vérifier le nombre de signalements
    const reportCount = await Report.countDocuments({ 
        reportedUserId: otherUser.userId,
        status: 'pending'
    });
    
    if (reportCount >= 3) {
        // Suspension automatique après 3 signalements
        await User.findOneAndUpdate(
            { facebookId: otherUser.userId },
            { 
                isBlocked: true,
                blockReason: 'Suspension automatique - Signalements multiples'
            }
        );
        
        // Notifier les admins de la suspension automatique
        await notificationService.notifyCriticalReport(report);
    }
}
    async handleInterests(senderId, text) {
        const interests = text.substring(11).trim();
        
        if (!interests) {
            await this.fb.sendQuickReplies(senderId,
                "Choisissez vos centres d'intérêt:",
                [
                    { title: "🎮 Gaming", payload: "INTEREST_GAMING" },
                    { title: "🎵 Musique", payload: "INTEREST_MUSIC" },
                    { title: "📚 Lecture", payload: "INTEREST_BOOKS" },
                    { title: "🎬 Cinéma", payload: "INTEREST_MOVIES" },
                    { title: "💻 Tech", payload: "INTEREST_TECH" }
                ]
            );
            return;
        }

        const interestList = interests.split(',').map(i => i.trim());
        await User.findOneAndUpdate(
            { facebookId: senderId },
            { interests: interestList }
        );

        await this.fb.sendTextMessage(senderId, `✅ Intérêts mis à jour: ${interestList.join(', ')}`);
    }

    async handleStats(senderId) {
        const user = await User.findOne({ facebookId: senderId });
        
        const stats = `📊 Vos statistiques:
        
👤 Pseudo: ${user.pseudo}
💬 Conversations totales: ${user.totalConversations}
📝 Messages envoyés: ${user.totalMessages}
⭐ Note moyenne: ${user.rating.toFixed(1)}/5 (${user.ratingCount} avis)
🎯 Intérêts: ${user.interests.join(', ') || 'Aucun'}`;

        await this.fb.sendTextMessage(senderId, stats);
    }

    async handlePseudo(senderId, text) {
        const newPseudo = text.substring(8).trim();
        
        if (!newPseudo) {
            await this.fb.sendTextMessage(senderId, "📝 Usage: /pseudo [nouveau pseudo]");
            return;
        }

        if (newPseudo.length < 3 || newPseudo.length > 20) {
            await this.fb.sendTextMessage(senderId, "❌ Le pseudo doit faire entre 3 et 20 caractères.");
            return;
        }

        // Vérifier les mots interdits
        const bannedWords = ['admin', 'moderator', 'official', 'facebook'];
        if (bannedWords.some(word => newPseudo.toLowerCase().includes(word))) {
            await this.fb.sendTextMessage(senderId, "❌ Ce pseudo n'est pas autorisé.");
            return;
        }

        await User.findOneAndUpdate(
            { facebookId: senderId },
            { pseudo: newPseudo }
        );

        await this.fb.sendTextMessage(senderId, `✅ Pseudo changé en: ${newPseudo}`);
    }

    async handleRating(senderId, text) {
        const rating = parseInt(text.substring(8).trim());
        
        if (!rating || rating < 1 || rating > 5) {
            await this.fb.sendTextMessage(senderId, "📝 Usage: /rating [1-5]");
            return;
        }

        const user = await User.findOne({ facebookId: senderId });
        const lastChat = await Chat.findOne({ 
            'participants.userId': senderId,
            isActive: false
        }).sort({ endTime: -1 });

        if (!lastChat || (new Date() - lastChat.endTime) > 300000) { // 5 minutes
            await this.fb.sendTextMessage(senderId, "❌ Aucune conversation récente à noter.");
            return;
        }

        const otherUser = lastChat.participants.find(p => p.userId !== senderId);
        
        // Ajouter la note
        await Chat.findByIdAndUpdate(lastChat._id, {
            $push: {
                ratings: {
                    userId: senderId,
                    rating: rating
                }
            }
        });

        // Mettre à jour la note moyenne de l'autre utilisateur
        const otherUserDoc = await User.findOne({ facebookId: otherUser.userId });
        const newRating = ((otherUserDoc.rating * otherUserDoc.ratingCount) + rating) / (otherUserDoc.ratingCount + 1);
        
        await User.findOneAndUpdate(
            { facebookId: otherUser.userId },
            { 
                rating: newRating,
                $inc: { ratingCount: 1 }
            }
        );

        await this.fb.sendTextMessage(senderId, `✅ Merci pour votre évaluation (${rating}/5) !`);
    }

    async relayMessage(senderId, text) {
        const user = await User.findOne({ facebookId: senderId });
        const chat = await Chat.findById(user.currentChat);
        
        if (!chat || !chat.isActive) {
            await this.fb.sendTextMessage(senderId, "❌ La conversation n'est plus active.");
            return;
        }

        const otherParticipant = chat.participants.find(p => p.userId !== senderId);
        
        // Sauvegarder le message
        await Chat.findByIdAndUpdate(chat._id, {
            $push: {
                messages: {
                    senderId: senderId,
                    senderPseudo: user.pseudo,
                    content: text
                }
            },
            $inc: { messageCount: 1 }
        });

        // Incrémenter le compteur de messages de l'utilisateur
        await User.findByIdAndUpdate(user._id, {
            $inc: { totalMessages: 1 }
        });

        // Envoyer le message à l'autre participant
        await this.fb.sendTextMessage(
            otherParticipant.userId, 
            `${user.pseudo}: ${text}`
        );

        // Envoyer des indicateurs de frappe si supporté
        await this.fb.sendTypingIndicator(otherParticipant.userId, true);
        setTimeout(() => {
            this.fb.sendTypingIndicator(otherParticipant.userId, false);
        }, 2000);
    }

    async sendWelcomeMessage(senderId) {
        const message = `🎭 Bienvenue sur SpeakToStranger !

Je suis un bot qui vous connecte anonymement avec des inconnus pour discuter.

📝 Commandes principales:
• /start - Nouvelle conversation
• /stop - Terminer la conversation
• /next - Passer au prochain étranger
• /interests - Définir vos centres d'intérêt
• /stats - Voir vos statistiques
• /help - Toutes les commandes

🚀 Tapez /start pour rencontrer quelqu'un !`;

        await this.fb.sendTextMessage(senderId, message);
    }

    async handleHelp(senderId) {
        const helpMessage = `🔮 Guide Complet SpeakToStranger

📌 COMMANDES DE BASE:
• /start - Démarrer une conversation
• /stop - Arrêter la conversation
• /next - Changer d'interlocuteur
• /help - Afficher ce message

👤 PROFIL:
• /pseudo [nom] - Changer votre pseudo
• /interests [liste] - Définir vos intérêts
• /stats - Voir vos statistiques

🛡️ SÉCURITÉ:
• /report [raison] - Signaler un comportement
• /block - Bloquer l'utilisateur actuel
• /rating [1-5] - Noter la dernière conversation

💡 ASTUCES:
• Les intérêts communs augmentent vos chances de match
• Soyez respectueux pour maintenir une bonne note
• Les conversations sont anonymes mais surveillées

⚡ RACCOURCIS:
• Envoyez un emoji 👋 pour saluer
• Tapez "bye" pour terminer poliment

🎯 Intérêts disponibles:
Gaming, Musique, Lecture, Cinéma, Tech, Sport, Art, Voyage, Cuisine, Photo

📊 Votre note influence la priorité dans la file d'attente !`;

        await this.fb.sendTextMessage(senderId, helpMessage);
    }

    async handleBlock(senderId) {
        const user = await User.findOne({ facebookId: senderId });
        
        if (!user.currentChat) {
            await this.fb.sendTextMessage(senderId, "❌ Aucune conversation active.");
            return;
        }

        const chat = await Chat.findById(user.currentChat);
        const otherUser = chat.participants.find(p => p.userId !== senderId);
        
        // Ajouter à la liste des bloqués
        await User.findByIdAndUpdate(user._id, {
            $addToSet: { blockedUsers: otherUser.userId }
        });

        // Terminer la conversation
        await this.chatManager.endChat(senderId);
        
        await this.fb.sendTextMessage(senderId, "✅ Utilisateur bloqué. Vous ne serez plus mis en relation.");
    }

    async handlePostback(senderId, postback) {
        const payload = postback.payload;
        
        switch(payload) {
            case 'GET_STARTED':
                await this.sendWelcomeMessage(senderId);
                break;
            case 'SET_INTERESTS':
                await this.handleInterests(senderId, '/interests');
                break;
            case 'START_CHAT':
                await this.handleStart(senderId, '/start');
                break;
            default:
                if (payload.startsWith('INTEREST_')) {
                    const interest = payload.replace('INTEREST_', '');
                    await User.findOneAndUpdate(
                        { facebookId: senderId },
                        { $addToSet: { interests: interest } }
                    );
                    await this.fb.sendTextMessage(senderId, `✅ Intérêt ajouté: ${interest}`);
                }
        }
    }
}

module.exports = MessageHandler;
