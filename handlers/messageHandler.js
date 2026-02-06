// handlers/messageHandler.js
const facebookAPI = require('../services/facebookAPI');
const { User, Chat, Report, Stats, Message } = require('../models');

class MessageHandler {
    constructor(chatManager, userManager) {
        this.chatManager = chatManager;
        this.userManager = userManager;
        this.fb = facebookAPI;
    }

    // Gérer les événements Facebook
    async handleEvent(event) {
        try {
            const senderId = event.sender.id;
            
            if (event.message) {
                await this.handleMessage(senderId, event.message);
            } else if (event.postback) {
                await this.handlePostback(senderId, event.postback);
            }
        } catch (error) {
            console.error('Erreur traitement événement:', error);
        }
    }

    // Gérer les messages entrants
    async handleMessage(senderId, message) {
        try {
            // Marquer comme vu
            await this.fb.markSeen(senderId);
            
            // Vérifier/récupérer l'utilisateur
            let user = await User.findOne({ facebookId: senderId });
            
            if (!user) {
                // Créer un nouvel utilisateur avec un pseudo par défaut
                user = await User.create({
                    facebookId: senderId,
                    pseudo: 'Anonyme',
                    createdAt: new Date(),
                    lastActivity: new Date(),
                    status: 'online',
                    isBlocked: false,
                    totalConversations: 0,
                    totalMessages: 0
                });
                
                await this.sendWelcomeMessage(senderId);
                return;
            }

            // VÉRIFICATION DU BLOCAGE
            if (user.isBlocked === true) {
                console.log(`🚫 Utilisateur bloqué tenté d'accès: ${senderId} (${user.pseudo})`);
                
                await this.fb.sendTextMessage(senderId, 
                    "🚫 COMPTE SUSPENDU\n" +
                    "━━━━━━━━━━━━━━━━━━\n\n" +
                    "Votre compte a été suspendu pour violation des règles.\n\n" +
                    `Raison: ${user.blockReason || 'Violation des conditions d\'utilisation'}\n` +
                    `Date: ${user.blockedAt ? new Date(user.blockedAt).toLocaleDateString('fr-FR') : 'Non spécifiée'}\n\n` +
                    "Cette décision est définitive.\n\n" +
                    "Si vous pensez qu'il s'agit d'une erreur, contactez le support."
                );
                
                if (user.status !== 'blocked') {
                    user.status = 'blocked';
                    await user.save();
                }
                
                return;
            }

            // Mettre à jour l'activité
            user.lastActivity = new Date();
            user.status = 'online';
            await user.save();

            // Extraire le texte du message
            const text = message.text?.toLowerCase().trim();

            // Traiter les commandes
            if (text?.startsWith('/')) {
                await this.handleCommand(senderId, message.text);
                return;
            }

            // Si en conversation, transférer le message
            if (this.chatManager.isInChat(senderId)) {
                const chatInfo = this.chatManager.activeChats.get(senderId);
                
                if (chatInfo && chatInfo.chatId) {
                    // Stocker le message selon son type
                    if (message.text) {
                        await this.storeMessage(chatInfo.chatId, senderId, user.pseudo, chatInfo.partnerId, {
                            content: message.text,
                            type: 'text'
                        });
                    } else if (message.attachments && message.attachments.length > 0) {
                        for (const attachment of message.attachments) {
                            await this.storeMessage(chatInfo.chatId, senderId, user.pseudo, chatInfo.partnerId, {
                                content: `[${attachment.type}]`,
                                type: attachment.type,
                                mediaUrl: attachment.payload?.url
                            });
                        }
                    } else if (message.sticker_id) {
                        await this.storeMessage(chatInfo.chatId, senderId, user.pseudo, chatInfo.partnerId, {
                            content: '[Sticker]',
                            type: 'sticker',
                            mediaUrl: message.sticker_id
                        });
                    }
                    
                    await this.updateChatStats(chatInfo.chatId);
                }
                
                await this.chatManager.relayMessage(senderId, message);
                return;
            }

            // Si pas en conversation et pas une commande, afficher l'aide
            await this.showHelp(senderId);

        } catch (error) {
            console.error('Erreur traitement message:', error);
            await this.fb.sendTextMessage(senderId, 
                "❌ Une erreur s'est produite. Veuillez réessayer.\n\n" +
                "Tapez /help pour voir les commandes disponibles."
            );
        }
    }

    // Stocker les messages dans la collection séparée
    async storeMessage(chatId, senderId, senderPseudo, recipientId, messageData) {
        try {
            await Message.create({
                chatId: chatId,
                senderId: senderId,
                senderPseudo: senderPseudo || 'Anonyme',
                recipientId: recipientId,
                content: messageData.content,
                type: messageData.type || 'text',
                mediaUrl: messageData.mediaUrl || null,
                timestamp: new Date()
            });
            
            console.log(`📝 Message stocké - Type: ${messageData.type}, Chat: ${chatId}`);
            
        } catch (error) {
            console.error('Erreur stockage message:', error);
        }
    }

    // Mettre à jour les stats du chat
    async updateChatStats(chatId) {
        try {
            await Chat.findByIdAndUpdate(chatId, {
                $inc: { messageCount: 1 },
                lastActivity: new Date()
            });
        } catch (error) {
            console.error('Erreur mise à jour stats chat:', error);
        }
    }

    // Gérer les commandes
    async handleCommand(senderId, messageText) {
        try {
            const parts = messageText.toLowerCase().split(' ');
            const command = parts[0];
            
            console.log(`📝 Commande reçue: ${command} de ${senderId}`);
            
            switch(command) {
                case '/start':
                case '/help':
                    await this.showHelp(senderId);
                    break;
                    
                case '/chercher':
                case '/search':
                case '/nouveau':
                case '/new':
                    await this.chatManager.addToQueue(senderId);
                    break;
                    
                case '/stop':
                case '/quitter':
                case '/leave':
                    await this.handleStop(senderId);
                    break;
                    
                case '/pseudo':
                    const newPseudo = messageText.slice(7).trim();
                    await this.changePseudo(senderId, newPseudo);
                    break;
                    
                case '/profil':
                case '/profile':
                    await this.showProfile(senderId);
                    break;
                    
                case '/stats':
                    await this.showUserStats(senderId);
                    break;
                    
                case '/infos':
                case '/info':
                    await this.showBotStats(senderId);
                    break;
                    
                case '/signaler':
                case '/report':
                    await this.handleReport(senderId);
                    break;
                    
                case '/feedback':
                    const feedback = messageText.slice(9).trim();
                    await this.handleFeedback(senderId, feedback);
                    break;
                    
                default:
                    await this.fb.sendTextMessage(senderId, 
                        "❌ Commande non reconnue.\n\n" +
                        "Tapez /help pour voir les commandes disponibles."
                    );
                    break;
            }
            
            return true;
            
        } catch (error) {
            console.error('Erreur traitement commande:', error);
            await this.fb.sendTextMessage(senderId, 
                "❌ Une erreur s'est produite.\n\n" +
                "Veuillez réessayer ou tapez /help pour l'aide."
            );
            return false;
        }
    }

    // Message de bienvenue
    async sendWelcomeMessage(senderId) {
        const welcomeMessage = 
            "🎭 Bienvenue sur SpeakToStranger !\n\n" +
            "Je suis votre assistant pour vous connecter avec des inconnus.\n\n" +
            "📝 COMMANDES DISPONIBLES :\n" +
            "━━━━━━━━━━━━━━━━━━\n" +
            "/chercher - 🔍 Trouver un partenaire\n" +
            "/stop - 🛑 Quitter la conversation\n" +
            "/pseudo - ✏️ Changer votre pseudo\n" +
            "/profil - 👤 Voir votre profil\n" +
            "/stats - 📊 Voir vos statistiques\n" +
            "/infos - 📈 Statistiques du bot\n" +
            "/signaler - 🚨 Signaler un utilisateur\n" +
            "/help - ❓ Afficher cette aide\n\n" +
            "🎯 Commencez par taper /chercher pour trouver quelqu'un !";

        await this.fb.sendTextMessage(senderId, welcomeMessage);
    }

    // Afficher l'aide
    async showHelp(senderId) {
        const user = await User.findOne({ facebookId: senderId });
        const pseudo = user?.pseudo || 'Anonyme';
        
        const helpMessage = 
            `👋 Bonjour ${pseudo} !\n\n` +
            "📝 COMMANDES DISPONIBLES :\n" +
            "━━━━━━━━━━━━━━━━━━\n" +
            "/chercher - 🔍 Trouver un partenaire\n" +
            "/stop - 🛑 Quitter la conversation\n" +
            "/pseudo [nom] - ✏️ Changer votre pseudo\n" +
            "/profil - 👤 Voir votre profil\n" +
            "/stats - 📊 Voir vos statistiques\n" +
            "/infos - 📈 Statistiques du bot\n" +
            "/signaler - 🚨 Signaler un utilisateur\n" +
            "/feedback [message] - 💬 Envoyer un feedback\n" +
            "/help - ❓ Afficher cette aide\n\n" +
            "💡 CONSEILS :\n" +
            "• Restez respectueux\n" +
            "• Ne partagez pas d'infos personnelles\n" +
            "• Amusez-vous ! 🎉\n\n" +
            "🎯 Tapez /chercher pour commencer !";

        await this.fb.sendTextMessage(senderId, helpMessage);
    }

    // Gérer /stop
    async handleStop(senderId) {
        try {
            if (this.chatManager.isInChat(senderId)) {
                await this.chatManager.endChat(senderId);
                return;
            }
            
            if (this.chatManager.isInQueue(senderId)) {
                await this.chatManager.removeFromQueue(senderId);
                await this.fb.sendTextMessage(senderId,
                    "✅ Recherche annulée.\n\n" +
                    "Tapez /chercher quand vous voudrez trouver un partenaire."
                );
                return;
            }
            
            await this.fb.sendTextMessage(senderId,
                "❌ Vous n'êtes ni en conversation ni en recherche.\n\n" +
                "Tapez /chercher pour commencer !"
            );
            
        } catch (error) {
            console.error('Erreur stop:', error);
            await this.fb.sendTextMessage(senderId,
                "❌ Erreur lors de l'arrêt.\n\nVeuillez réessayer."
            );
        }
    }

    // Changer de pseudo
    async changePseudo(senderId, newPseudo) {
        try {
            if (!newPseudo || newPseudo.trim() === '') {
                await this.fb.sendTextMessage(senderId,
                    "❌ Format incorrect !\n\n" +
                    "Utilisation : /pseudo VotreNouveauPseudo\n\n" +
                    "Exemple : /pseudo SuperChat123"
                );
                return;
            }

            newPseudo = newPseudo.trim();
            
            if (newPseudo.length < 3) {
                await this.fb.sendTextMessage(senderId,
                    "❌ Pseudo trop court !\n\n" +
                    "Le pseudo doit contenir au moins 3 caractères."
                );
                return;
            }

            if (newPseudo.length > 20) {
                await this.fb.sendTextMessage(senderId,
                    "❌ Pseudo trop long !\n\n" +
                    "Le pseudo ne peut pas dépasser 20 caractères."
                );
                return;
            }

            const pseudoRegex = /^[a-zA-Z0-9_]+$/;
            if (!pseudoRegex.test(newPseudo)) {
                await this.fb.sendTextMessage(senderId,
                    "❌ Caractères non autorisés !\n\n" +
                    "Utilisez uniquement : lettres, chiffres et underscores"
                );
                return;
            }

            const existingUser = await User.findOne({ 
                pseudo: newPseudo,
                facebookId: { $ne: senderId }
            });

            if (existingUser) {
                await this.fb.sendTextMessage(senderId,
                    "❌ Ce pseudo est déjà pris !\n\n" +
                    "Suggestions :\n" +
                    `• ${newPseudo}${Math.floor(Math.random() * 999)}\n` +
                    `• ${newPseudo}_${Math.floor(Math.random() * 99)}`
                );
                return;
            }

            const user = await User.findOne({ facebookId: senderId });
            const oldPseudo = user?.pseudo || 'Anonyme';

            await User.findOneAndUpdate(
                { facebookId: senderId },
                { 
                    pseudo: newPseudo,
                    lastPseudoChange: new Date()
                },
                { upsert: true }
            );

            if (this.chatManager.isInChat(senderId)) {
                const chatInfo = this.chatManager.getChatInfo(senderId);
                if (chatInfo && chatInfo.chatId) {
                    await Chat.findOneAndUpdate(
                        { 
                            _id: chatInfo.chatId,
                            'participants.userId': senderId 
                        },
                        { 
                            '$set': { 'participants.$.pseudo': newPseudo }
                        }
                    );

                    await this.fb.sendTextMessage(chatInfo.partnerId,
                        `📝 ${oldPseudo} a changé son pseudo en : ${newPseudo}`
                    );
                }
            }

            await this.fb.sendTextMessage(senderId,
                "✅ PSEUDO CHANGÉ AVEC SUCCÈS !\n" +
                "━━━━━━━━━━━━━━━━━━\n\n" +
                `Ancien : ${oldPseudo}\n` +
                `Nouveau : ${newPseudo}\n\n` +
                "💡 Tapez /profil pour voir vos infos"
            );

            console.log(`✅ Pseudo changé : ${oldPseudo} → ${newPseudo}`);

        } catch (error) {
            console.error('Erreur changement pseudo:', error);
            await this.fb.sendTextMessage(senderId,
                "❌ Erreur lors du changement de pseudo.\n\nRéessayez plus tard."
            );
        }
    }

    // Afficher le profil
    async showProfile(senderId) {
        try {
            const user = await User.findOne({ facebookId: senderId });
            
            if (!user) {
                await this.fb.sendTextMessage(senderId,
                    "❌ Profil non trouvé.\n\nDéfinissez un pseudo avec /pseudo"
                );
                return;
            }

            const memberSince = user.createdAt ? 
                new Date(user.createdAt).toLocaleDateString('fr-FR') : 'Inconnue';

            const profileMessage = 
                "👤 VOTRE PROFIL\n" +
                "━━━━━━━━━━━━━━━━━━\n\n" +
                `📝 Pseudo : ${user.pseudo || 'Non défini'}\n` +
                `💬 Conversations : ${user.totalConversations || 0}\n` +
                `📨 Messages : ${user.totalMessages || 0}\n` +
                `📅 Membre depuis : ${memberSince}\n` +
                `📊 Statut : ${user.isBlocked ? '🔴 Bloqué' : '🟢 Actif'}\n\n` +
                "Commandes :\n" +
                "/pseudo [nom] - Changer de pseudo\n" +
                "/stats - Statistiques détaillées";

            await this.fb.sendTextMessage(senderId, profileMessage);

        } catch (error) {
            console.error('Erreur affichage profil:', error);
            await this.fb.sendTextMessage(senderId,
                "❌ Erreur lors de la récupération du profil."
            );
        }
    }

    // Afficher les stats utilisateur
    async showUserStats(senderId) {
        try {
            const user = await User.findOne({ facebookId: senderId });
            
            if (!user) {
                await this.fb.sendTextMessage(senderId,
                    "📊 Aucune statistique disponible.\n\nCommencez à chatter !"
                );
                return;
            }

            const todayMessages = await Message.countDocuments({
                senderId: senderId,
                timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
            });

            const statsMessage = 
                "📊 VOS STATISTIQUES\n" +
                "━━━━━━━━━━━━━━━━━━\n\n" +
                `📝 Pseudo : ${user.pseudo || 'Non défini'}\n` +
                `💬 Conversations : ${user.totalConversations || 0}\n` +
                `📨 Messages totaux : ${user.totalMessages || 0}\n` +
                `📅 Messages aujourd'hui : ${todayMessages}\n` +
                `⚠️ Signalements : ${user.reportCount || 0}\n` +
                `📅 Membre depuis : ${new Date(user.createdAt).toLocaleDateString('fr-FR')}\n\n` +
                "Continuez à chatter ! 🚀";

            await this.fb.sendTextMessage(senderId, statsMessage);

        } catch (error) {
            console.error('Erreur stats utilisateur:', error);
            await this.fb.sendTextMessage(senderId,
                "❌ Erreur lors de la récupération des stats."
            );
        }
    }

    // Afficher les stats du bot
    async showBotStats(senderId) {
        try {
            const activeChats = this.chatManager.getActiveChatsCount();
            const queueLength = this.chatManager.getQueueLength();
            const totalUsers = await User.countDocuments();
            const activeUsers = await User.countDocuments({ 
                lastActivity: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
            });
            const totalChats = await Chat.countDocuments();
            const todayChats = await Chat.countDocuments({
                startedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
            });
            const totalMessages = await Message.countDocuments();

            const statsMessage = 
                "📊 STATISTIQUES DU BOT\n" +
                "━━━━━━━━━━━━━━━━━━\n\n" +
                "🔴 EN TEMPS RÉEL :\n" +
                `• Conversations actives : ${activeChats}\n` +
                `• En attente : ${queueLength}\n\n` +
                "📈 AUJOURD'HUI :\n" +
                `• Conversations : ${todayChats}\n\n` +
                "📊 TOTAUX :\n" +
                `• Utilisateurs : ${totalUsers}\n` +
                `• Actifs (24h) : ${activeUsers}\n` +
                `• Conversations : ${totalChats}\n` +
                `• Messages : ${totalMessages}\n\n` +
                "Bot créé avec ❤️";

            await this.fb.sendTextMessage(senderId, statsMessage);

        } catch (error) {
            console.error('Erreur stats bot:', error);
            
            const activeChats = this.chatManager.getActiveChatsCount();
            const queueLength = this.chatManager.getQueueLength();
            
            await this.fb.sendTextMessage(senderId,
                "📊 STATISTIQUES DU BOT\n" +
                "━━━━━━━━━━━━━━━━━━\n\n" +
                `🔴 Actifs : ${activeChats}\n` +
                `⏳ En attente : ${queueLength}`
            );
        }
    }

    // Gérer les signalements
    async handleReport(senderId) {
        try {
            if (!this.chatManager.isInChat(senderId)) {
                await this.fb.sendTextMessage(senderId,
                    "❌ Vous devez être en conversation pour signaler."
                );
                return;
            }

            const chatInfo = this.chatManager.getChatInfo(senderId);

            await Report.create({
                reportedBy: senderId,
                reportedUser: chatInfo.partnerId,
                chatId: chatInfo.chatId,
                reason: 'inappropriate_behavior',
                timestamp: new Date()
            });

            await User.findOneAndUpdate(
                { facebookId: chatInfo.partnerId },
                { $inc: { reportCount: 1 } }
            );

            const reportedUser = await User.findOne({ facebookId: chatInfo.partnerId });
            if (reportedUser && reportedUser.reportCount >= 3) {
                await User.findOneAndUpdate(
                    { facebookId: chatInfo.partnerId },
                    { isBlocked: true }
                );
            }

            await this.chatManager.endChat(senderId, 'reported');

            await this.fb.sendTextMessage(senderId,
                "✅ Signalement enregistré.\n\n" +
                "Merci de maintenir un environnement sûr.\n\n" +
                "Tapez /chercher pour un nouveau partenaire."
            );

            console.log(`⚠️ Signalement: ${senderId} → ${chatInfo.partnerId}`);

        } catch (error) {
            console.error('Erreur signalement:', error);
            await this.fb.sendTextMessage(senderId,
                "❌ Erreur lors du signalement."
            );
        }
    }

    // Gérer les feedbacks
    async handleFeedback(senderId, feedbackText) {
        try {
            if (!feedbackText || feedbackText.trim() === '') {
                await this.fb.sendTextMessage(senderId,
                    "❌ Format : /feedback Votre message\n\n" +
                    "Exemple : /feedback Super bot !"
                );
                return;
            }

            console.log(`📝 Feedback de ${senderId}: ${feedbackText}`);

            await this.fb.sendTextMessage(senderId,
                "✅ Merci pour votre feedback !\n\n" +
                "Votre message a été transmis. 💙"
            );

        } catch (error) {
            console.error('Erreur feedback:', error);
            await this.fb.sendTextMessage(senderId,
                "❌ Erreur lors de l'envoi du feedback."
            );
        }
    }

    // Gérer les postbacks
    async handlePostback(senderId, postback) {
        const payload = postback.payload;
        
        switch(payload) {
            case 'GET_STARTED':
                await this.sendWelcomeMessage(senderId);
                break;
            default:
                await this.showHelp(senderId);
        }
    }
}

module.exports = MessageHandler;
