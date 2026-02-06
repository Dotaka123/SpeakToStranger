// handlers/chatManager.js
const facebookAPI = require('../services/facebookAPI');
const { Chat, User, Queue, Message } = require('../models');

class ChatManager {
    constructor() {
        this.fb = facebookAPI;
        this.activeChats = new Map();
        this.waitingQueue = [];
    }

    // ========================================
    // GESTION DE LA FILE D'ATTENTE
    // ========================================

    isInQueue(userId) {
        return this.waitingQueue.some(u => u.userId === userId);
    }

    isInChat(userId) {
        return this.activeChats.has(userId);
    }

    getChatInfo(userId) {
        return this.activeChats.get(userId);
    }

    async addToQueue(userId, userPreferences = {}) {
        try {
            // Vérifier si déjà en file d'attente
            if (this.isInQueue(userId)) {
                await this.fb.sendTextMessage(userId, 
                    "🔄 Vous êtes déjà en recherche d'un partenaire...\n\n" +
                    "Patience, nous cherchons quelqu'un pour vous !"
                );
                return;
            }

            // Vérifier si déjà en conversation
            if (this.isInChat(userId)) {
                await this.fb.sendTextMessage(userId, 
                    "💬 Vous êtes déjà en conversation !\n\n" +
                    "Tapez /stop pour terminer votre conversation actuelle."
                );
                return;
            }

            // Récupérer les infos de l'utilisateur
            const user = await User.findOne({ facebookId: userId });
            const pseudo = user?.pseudo || 'Anonyme';

            // Ajouter à la file d'attente
            const queueEntry = {
                userId,
                pseudo,
                preferences: userPreferences,
                joinedAt: new Date()
            };

            this.waitingQueue.push(queueEntry);

            // Sauvegarder en base de données
            await Queue.create(queueEntry);

            // Message de confirmation
            await this.fb.sendTextMessage(userId, 
                "🔍 Recherche en cours...\n\n" +
                "Vous êtes dans la file d'attente.\n" +
                "Nous vous connecterons dès qu'un partenaire sera disponible !\n\n" +
                "💡 Tapez /stop pour annuler la recherche."
            );

            // Essayer de matcher immédiatement
            await this.tryMatch(userId);

        } catch (error) {
            console.error('Erreur ajout file d\'attente:', error);
            await this.fb.sendTextMessage(userId, 
                "❌ Une erreur s'est produite.\n\n" +
                "Veuillez réessayer avec /chercher"
            );
        }
    }

    async tryMatch(userId) {
        const userIndex = this.waitingQueue.findIndex(u => u.userId === userId);
        if (userIndex === -1) return;

        const user = this.waitingQueue[userIndex];

        // Chercher un partenaire dans la file
        for (let i = 0; i < this.waitingQueue.length; i++) {
            if (i !== userIndex) {
                const partner = this.waitingQueue[i];
                
                if (partner.userId !== user.userId) {
                    // Match trouvé !
                    this.waitingQueue = this.waitingQueue.filter(
                        u => u.userId !== user.userId && u.userId !== partner.userId
                    );

                    // Retirer de la base de données
                    await Queue.deleteMany({
                        userId: { $in: [user.userId, partner.userId] }
                    });

                    // Créer la conversation
                    await this.createChat(user, partner);
                    return;
                }
            }
        }

        // Pas de match trouvé
        const queueLength = this.waitingQueue.length;
        if (queueLength > 1) {
            await this.fb.sendTextMessage(userId, 
                `⏳ ${queueLength - 1} personne(s) en attente...\n` +
                "Nous cherchons le meilleur match pour vous !"
            );
        }
    }

    async removeFromQueue(userId) {
        this.waitingQueue = this.waitingQueue.filter(u => u.userId !== userId);
        await Queue.deleteOne({ userId });
        console.log(`✅ ${userId} retiré de la file d'attente`);
    }

    // ========================================
    // GESTION DES CONVERSATIONS
    // ========================================

    async createChat(user1, user2) {
        try {
            // Créer le chat en base de données
            const chat = await Chat.create({
                participants: [
                    { 
                        userId: user1.userId, 
                        pseudo: user1.pseudo || 'Anonyme' 
                    },
                    { 
                        userId: user2.userId, 
                        pseudo: user2.pseudo || 'Anonyme' 
                    }
                ],
                userId1: user1.userId,
                userId2: user2.userId,
                startedAt: new Date(),
                lastActivity: new Date(),
                isActive: true,
                messageCount: 0
                // PAS de champ messages - ils sont dans la collection Message
            });

            // Stocker dans la map active
            this.activeChats.set(user1.userId, {
                chatId: chat._id,
                partnerId: user2.userId,
                partnerPseudo: user2.pseudo || 'Anonyme'
            });

            this.activeChats.set(user2.userId, {
                chatId: chat._id,
                partnerId: user1.userId,
                partnerPseudo: user1.pseudo || 'Anonyme'
            });

            // Messages de connexion
            const message1 = 
                "🎉 MATCH TROUVÉ !\n" +
                "━━━━━━━━━━━━━━━━━━\n" +
                `Vous êtes connecté avec : ${user2.pseudo || 'Anonyme'}\n\n` +
                "💬 Dites bonjour pour commencer !\n\n" +
                "Commandes disponibles :\n" +
                "/stop - Terminer la conversation\n" +
                "/signaler - Signaler un comportement inapproprié";

            const message2 = 
                "🎉 MATCH TROUVÉ !\n" +
                "━━━━━━━━━━━━━━━━━━\n" +
                `Vous êtes connecté avec : ${user1.pseudo || 'Anonyme'}\n\n` +
                "💬 Dites bonjour pour commencer !\n\n" +
                "Commandes disponibles :\n" +
                "/stop - Terminer la conversation\n" +
                "/signaler - Signaler un comportement inapproprié";

            await Promise.all([
                this.fb.sendTextMessage(user1.userId, message1),
                this.fb.sendTextMessage(user2.userId, message2)
            ]);

            // Mettre à jour les stats des utilisateurs
            await User.updateMany(
                { facebookId: { $in: [user1.userId, user2.userId] } },
                { $inc: { totalConversations: 1 } }
            );

            console.log(`✅ Chat créé entre ${user1.pseudo} et ${user2.pseudo}`);
            return chat;

        } catch (error) {
            console.error('Erreur création chat:', error);
            
            const errorMessage = 
                "❌ Erreur lors de la création de la conversation.\n\n" +
                "Veuillez réessayer avec /chercher";

            await Promise.all([
                this.fb.sendTextMessage(user1.userId, errorMessage),
                this.fb.sendTextMessage(user2.userId, errorMessage)
            ]);
        }
    }

    async endChat(userId, reason = 'user_request') {
        const chat = this.activeChats.get(userId);
        if (!chat) return false;

        try {
            // Mettre à jour en base de données
            await Chat.findByIdAndUpdate(chat.chatId, {
                isActive: false,
                endedAt: new Date(),
                endReason: reason
            });

            // Retirer de la map active
            this.activeChats.delete(userId);
            this.activeChats.delete(chat.partnerId);

            // Messages de fin
            const endMessage1 = 
                "🔚 Conversation terminée.\n" +
                "━━━━━━━━━━━━━━━━━━\n\n" +
                "J'espère que vous avez passé un bon moment !\n\n" +
                "Que voulez-vous faire ?\n" +
                "/chercher - Trouver un nouveau partenaire\n" +
                "/stats - Voir vos statistiques\n" +
                "/help - Afficher l'aide";

            const endMessage2 = 
                "🔚 Votre partenaire a quitté la conversation.\n" +
                "━━━━━━━━━━━━━━━━━━\n\n" +
                "Que voulez-vous faire ?\n" +
                "/chercher - Trouver un nouveau partenaire\n" +
                "/stats - Voir vos statistiques\n" +
                "/help - Afficher l'aide";

            await this.fb.sendTextMessage(userId, endMessage1);
            
            if (reason !== 'reported') {
                await this.fb.sendTextMessage(chat.partnerId, endMessage2);
            }

            console.log(`✅ Chat terminé entre ${userId} et ${chat.partnerId}`);
            return true;

        } catch (error) {
            console.error('Erreur fin chat:', error);
            return false;
        }
    }

    // ========================================
    // GESTION DES MESSAGES (NOUVEAU SYSTÈME)
    // ========================================

    async handleMessage(senderId, content, type = 'text', mediaUrl = null) {
        try {
            const chatInfo = this.activeChats.get(senderId);
            if (!chatInfo) {
                return false;
            }

            const chat = await Chat.findById(chatInfo.chatId);
            if (!chat) {
                return false;
            }

            // Récupérer le pseudo de l'expéditeur
            const senderInfo = chat.participants.find(p => p.userId === senderId);
            const senderPseudo = senderInfo?.pseudo || 'Anonyme';

            // Créer un nouveau document Message dans la collection séparée
            await Message.create({
                chatId: chat._id,
                senderId: senderId,
                senderPseudo: senderPseudo,
                recipientId: chatInfo.partnerId,
                content: content,
                text: content, // Pour compatibilité
                type: type,
                mediaUrl: mediaUrl,
                timestamp: new Date()
            });

            // Mettre à jour UNIQUEMENT les stats du chat
            chat.messageCount = (chat.messageCount || 0) + 1;
            chat.lastActivity = new Date();
            
            // NE PAS stocker dans chat.messages
            if (chat.messages) {
                chat.messages = undefined;
                chat.markModified('messages');
            }
            
            await chat.save();
            
            console.log(`📝 Message stocké - Type: ${type}, Chat: ${chat._id}, Count: ${chat.messageCount}`);
            
            return true;
        } catch (error) {
            console.error('Erreur handling message:', error);
            return false;
        }
    }

    async relayMessage(senderId, message) {
        const chat = this.activeChats.get(senderId);
        if (!chat) {
            await this.fb.sendTextMessage(senderId, 
                "❌ Vous n'êtes pas en conversation.\n\n" +
                "Tapez /chercher pour trouver un partenaire."
            );
            return false;
        }

        try {
            const senderPseudo = await this.getUserPseudo(senderId);
            
            // MESSAGE TEXTE
            if (message.text) {
                await this.handleMessage(senderId, message.text, 'text');
                
                const formattedMessage = `${senderPseudo}: ${message.text}`;
                await this.fb.sendTextMessage(chat.partnerId, formattedMessage);
                
            // PIÈCES JOINTES
            } else if (message.attachments && message.attachments.length > 0) {
                for (const attachment of message.attachments) {
                    const attachmentType = attachment.type;
                    const payload = attachment.payload;
                    const url = payload?.url;
                    
                    // Notification
                    let notification = `${senderPseudo} envoie `;
                    switch(attachmentType) {
                        case 'image':
                            notification += 'une photo... 📷';
                            break;
                        case 'video':
                            notification += 'une vidéo... 🎥';
                            break;
                        case 'audio':
                            notification += 'un message vocal... 🎵';
                            break;
                        case 'file':
                            notification += 'un fichier... 📎';
                            break;
                        case 'location':
                            notification += 'sa localisation... 📍';
                            break;
                        default:
                            notification += 'quelque chose... 📎';
                    }
                    
                    await this.fb.sendTextMessage(chat.partnerId, notification);
                    
                    // Transférer et stocker selon le type
                    try {
                        switch(attachmentType) {
                            case 'image':
                                if (url) {
                                    await this.fb.sendImageMessage(chat.partnerId, url);
                                    await this.handleMessage(senderId, '[Photo]', 'image', url);
                                }
                                break;
                                
                            case 'video':
                                if (url) {
                                    await this.fb.sendVideoMessage(chat.partnerId, url);
                                    await this.handleMessage(senderId, '[Vidéo]', 'video', url);
                                }
                                break;
                                
                            case 'audio':
                                if (url) {
                                    await this.fb.sendAudioMessage(chat.partnerId, url);
                                    await this.handleMessage(senderId, '[Audio]', 'audio', url);
                                }
                                break;
                                
                            case 'file':
                                if (url) {
                                    await this.fb.sendFileMessage(chat.partnerId, url);
                                    await this.handleMessage(senderId, '[Fichier]', 'file', url);
                                }
                                break;
                                
                            case 'location':
                                const coords = payload.coordinates;
                                if (coords) {
                                    await this.fb.sendLocationMessage(chat.partnerId, coords.lat, coords.long);
                                    await this.handleMessage(senderId, '[Localisation]', 'location', 
                                        `${coords.lat},${coords.long}`);
                                }
                                break;
                                
                            default:
                                await this.fb.sendTextMessage(chat.partnerId, 
                                    `${senderPseudo} a envoyé un(e) ${attachmentType} (non transférable)`
                                );
                        }
                    } catch (attachError) {
                        console.error('Erreur transfert pièce jointe:', attachError);
                        await this.fb.sendTextMessage(chat.partnerId, 
                            `⚠️ ${senderPseudo} a essayé d'envoyer un(e) ${attachmentType}, mais le transfert a échoué.`
                        );
                    }
                }
                
            // STICKERS
            } else if (message.sticker_id) {
                await this.handleMessage(senderId, '[Sticker]', 'sticker', message.sticker_id);
                
                try {
                    await this.fb.sendStickerMessage(chat.partnerId, message.sticker_id);
                } catch (stickerError) {
                    await this.fb.sendTextMessage(chat.partnerId, 
                        `😊 ${senderPseudo} a envoyé un sticker !`
                    );
                }
                
            // RÉPONSES RAPIDES
            } else if (message.quick_reply) {
                const replyText = message.quick_reply.payload;
                await this.handleMessage(senderId, replyText, 'text');
                await this.fb.sendTextMessage(chat.partnerId, 
                    `${senderPseudo}: ${replyText}`
                );
            }

            // Mettre à jour les stats utilisateur
            await User.findOneAndUpdate(
                { facebookId: senderId },
                { $inc: { totalMessages: 1 } }
            );

            return true;

        } catch (error) {
            console.error('Erreur transfert message:', error);
            
            await this.fb.sendTextMessage(senderId, 
                "⚠️ Erreur lors de l'envoi du message. Veuillez réessayer."
            );
            
            return false;
        }
    }

    // ========================================
    // MÉTHODES UTILITAIRES
    // ========================================

    async getUserPseudo(userId) {
        try {
            const user = await User.findOne({ facebookId: userId });
            return user?.pseudo || 'Anonyme';
        } catch (error) {
            return 'Anonyme';
        }
    }

    async getChatMessages(chatId, limit = 100) {
        try {
            const messages = await Message.find({ chatId })
                .sort({ timestamp: 1 })
                .limit(limit)
                .lean();
            
            return messages;
        } catch (error) {
            console.error('Erreur récupération messages:', error);
            return [];
        }
    }

    getQueueLength() {
        return this.waitingQueue.length;
    }

    getActiveChatsCount() {
        return this.activeChats.size / 2;
    }

    // ========================================
    // NETTOYAGE ET MAINTENANCE
    // ========================================

    async cleanup() {
        try {
            // Nettoyer la file d'attente (+ de 10 minutes)
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            
            const oldEntries = this.waitingQueue.filter(
                u => u.joinedAt < tenMinutesAgo
            );

            if (oldEntries.length > 0) {
                for (const entry of oldEntries) {
                    await this.fb.sendTextMessage(entry.userId, 
                        "⏱️ Recherche expirée (inactivité).\n\n" +
                        "Tapez /chercher pour relancer une recherche."
                    );
                }

                this.waitingQueue = this.waitingQueue.filter(
                    u => u.joinedAt >= tenMinutesAgo
                );

                await Queue.deleteMany({
                    joinedAt: { $lt: tenMinutesAgo }
                });
            }

            // Marquer les chats inactifs comme terminés (+ de 30 minutes)
            const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
            
            const inactiveChats = await Chat.find({
                isActive: true,
                lastActivity: { $lt: thirtyMinutesAgo }
            });

            for (const chat of inactiveChats) {
                for (const participant of chat.participants) {
                    if (this.activeChats.has(participant.userId)) {
                        await this.endChat(participant.userId, 'inactivity');
                    }
                }
            }

            // Nettoyer les vieux messages (+ de 30 jours)
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const deletedMessages = await Message.deleteMany({
                timestamp: { $lt: thirtyDaysAgo }
            });

            if (deletedMessages.deletedCount > 0) {
                console.log(`🗑️ ${deletedMessages.deletedCount} vieux messages supprimés`);
            }

            // Nettoyer les vieux chats inactifs (+ de 7 jours)
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const deletedChats = await Chat.deleteMany({
                isActive: false,
                lastActivity: { $lt: sevenDaysAgo }
            });

            if (deletedChats.deletedCount > 0) {
                console.log(`🗑️ ${deletedChats.deletedCount} vieux chats supprimés`);
            }

            console.log('✅ Nettoyage effectué');
        } catch (error) {
            console.error('Erreur nettoyage:', error);
        }
    }

    startAutoCleanup() {
        // Nettoyer toutes les 5 minutes
        setInterval(() => {
            this.cleanup();
        }, 5 * 60 * 1000);
        
        console.log('🔄 Nettoyage automatique activé');
    }
}

module.exports = ChatManager;
