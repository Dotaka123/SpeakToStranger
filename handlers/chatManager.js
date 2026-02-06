// handlers/chatManager.js
const facebookAPI = require('../services/facebookAPI');
const { Chat, User, Queue } = require('../models');

class ChatManager {
    constructor() {
        this.fb = facebookAPI;
        this.activeChats = new Map();
        this.waitingQueue = [];
    }

    // Vérifier si un utilisateur est en file d'attente
    isInQueue(userId) {
        return this.waitingQueue.some(u => u.userId === userId);
    }

    // Vérifier si un utilisateur est en conversation
    isInChat(userId) {
        return this.activeChats.has(userId);
    }

    // Obtenir les infos de conversation d'un utilisateur
    getChatInfo(userId) {
        return this.activeChats.get(userId);
    }

    // Ajouter un utilisateur à la file d'attente
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

    // Essayer de trouver un match
    async tryMatch(userId) {
        const userIndex = this.waitingQueue.findIndex(u => u.userId === userId);
        if (userIndex === -1) return;

        const user = this.waitingQueue[userIndex];

        // Chercher un partenaire dans la file
        for (let i = 0; i < this.waitingQueue.length; i++) {
            if (i !== userIndex) {
                const partner = this.waitingQueue[i];
                
                // Vérifier qu'ils ne sont pas le même utilisateur
                if (partner.userId !== user.userId) {
                    // Match trouvé !
                    // Retirer les deux de la file d'attente
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

        // Pas de match trouvé - l'utilisateur reste en file d'attente
        const queueLength = this.waitingQueue.length;
        if (queueLength > 1) {
            await this.fb.sendTextMessage(userId, 
                `⏳ ${queueLength - 1} personne(s) en attente...\n` +
                "Nous cherchons le meilleur match pour vous !"
            );
        }
    }

    // Créer une nouvelle conversation
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
                startedAt: new Date(),
                lastActivity: new Date(),
                isActive: true,
                messageCount: 0
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

            // Message de connexion pour user1
            const message1 = 
                "🎉 MATCH TROUVÉ !\n" +
                "━━━━━━━━━━━━━━━━━━\n" +
                `Vous êtes connecté avec : ${user2.pseudo || 'Anonyme'}\n\n` +
                "💬 Dites bonjour pour commencer !\n\n" +
                "Commandes disponibles :\n" +
                "/stop - Terminer la conversation\n" +
                "/signaler - Signaler un comportement inapproprié";

            // Message de connexion pour user2
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
            
            // Notifier les utilisateurs de l'erreur
            const errorMessage = 
                "❌ Erreur lors de la création de la conversation.\n\n" +
                "Veuillez réessayer avec /chercher";

            await Promise.all([
                this.fb.sendTextMessage(user1.userId, errorMessage),
                this.fb.sendTextMessage(user2.userId, errorMessage)
            ]);
        }
    }

async handleMessage(senderId, message) {
    try {
        // Récupérer les infos du chat depuis la map active
        const chatInfo = this.activeChats.get(senderId);
        if (!chatInfo) {
            return false;
        }

        // Récupérer le chat depuis la base de données
        const chat = await Chat.findById(chatInfo.chatId);
        if (!chat) {
            return false;
        }

        // Récupérer le pseudo de l'expéditeur
        const senderInfo = chat.participants.find(p => p.userId === senderId);
        const senderPseudo = senderInfo?.pseudo || 'Anonyme';

        // Incrémenter le compteur de messages
        chat.messageCount = (chat.messageCount || 0) + 1;
        chat.lastActivity = new Date();
        
        // IMPORTANT : Initialiser le tableau messages s'il n'existe pas
        if (!chat.messages) {
            chat.messages = [];
        }
        
        // Stocker le message dans le tableau
        chat.messages.push({
            senderId: senderId,
            senderPseudo: senderPseudo,
            recipientId: chatInfo.partnerId,
            content: message,
            text: message,
            timestamp: new Date(),
            type: 'text'
        });
        
        // Limiter à 100 derniers messages
        if (chat.messages.length > 100) {
            chat.messages = chat.messages.slice(-100);
        }
        
        await chat.save();
        
        // Log pour debug
        console.log(`📝 Message stocké - Chat: ${chat._id}, Total messages: ${chat.messages.length}`);
        
        return true;
    } catch (error) {
        console.error('Erreur handling message:', error);
        return false;
    }
}

// Transférer un message entre partenaires (VERSION AMÉLIORÉE)
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
        // Récupérer le pseudo de l'expéditeur
        const senderPseudo = await this.getUserPseudo(senderId);
        
        // Traiter selon le type de message
        if (message.text) {
            // MESSAGE TEXTE
            await this.handleMessage(senderId, message.text);
            
            // Format du message pour le destinataire
            const formattedMessage = `${senderPseudo}: ${message.text}`;
            await this.fb.sendTextMessage(chat.partnerId, formattedMessage);
            
        } else if (message.attachments && message.attachments.length > 0) {
            // PIÈCES JOINTES (images, vidéos, audio, fichiers)
            for (const attachment of message.attachments) {
                const attachmentType = attachment.type;
                const payload = attachment.payload;
                
                // Notifier d'abord que quelque chose arrive
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
                    default:
                        notification += 'quelque chose... 📎';
                }
                
                await this.fb.sendTextMessage(chat.partnerId, notification);
                
                // Transférer la pièce jointe
                try {
                    if (attachmentType === 'image' && payload.url) {
                        // TRANSFÉRER L'IMAGE
                        await this.fb.sendImageMessage(chat.partnerId, payload.url);
                        await this.handleMessage(senderId, '[Photo envoyée]');
                        
                    } else if (attachmentType === 'video' && payload.url) {
                        // TRANSFÉRER LA VIDÉO
                        await this.fb.sendVideoMessage(chat.partnerId, payload.url);
                        await this.handleMessage(senderId, '[Vidéo envoyée]');
                        
                    } else if (attachmentType === 'audio' && payload.url) {
                        // TRANSFÉRER L'AUDIO
                        await this.fb.sendAudioMessage(chat.partnerId, payload.url);
                        await this.handleMessage(senderId, '[Message vocal envoyé]');
                        
                    } else if (attachmentType === 'file' && payload.url) {
                        // TRANSFÉRER LE FICHIER
                        await this.fb.sendFileMessage(chat.partnerId, payload.url);
                        await this.handleMessage(senderId, '[Fichier envoyé]');
                        
                    } else if (attachmentType === 'location') {
                        // TRANSFÉRER LA LOCALISATION
                        const coords = payload.coordinates;
                        if (coords) {
                            await this.fb.sendLocationMessage(
                                chat.partnerId, 
                                coords.lat, 
                                coords.long
                            );
                            await this.handleMessage(senderId, '[Localisation partagée]');
                        }
                    } else {
                        // Type non supporté - envoyer juste une notification
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
            
        } else if (message.sticker_id) {
            // STICKERS
            await this.handleMessage(senderId, '[Sticker]');
            
            // Essayer de transférer le sticker
            try {
                await this.fb.sendStickerMessage(chat.partnerId, message.sticker_id);
            } catch (stickerError) {
                // Si le sticker ne peut pas être transféré, envoyer une notification
                await this.fb.sendTextMessage(chat.partnerId, 
                    `😊 ${senderPseudo} a envoyé un sticker !`
                );
            }
            
        } else if (message.quick_reply) {
            // RÉPONSES RAPIDES
            const replyText = message.quick_reply.payload;
            await this.handleMessage(senderId, replyText);
            await this.fb.sendTextMessage(chat.partnerId, 
                `${senderPseudo}: ${replyText}`
            );
        }

        // Mettre à jour les stats
        await User.findOneAndUpdate(
            { facebookId: senderId },
            { $inc: { totalMessages: 1 } }
        );

        return true;

    } catch (error) {
        console.error('Erreur transfert message:', error);
        
        // Notifier l'expéditeur si erreur
        await this.fb.sendTextMessage(senderId, 
            "⚠️ Erreur lors de l'envoi du message. Veuillez réessayer."
        );
        
        return false;
    }
}

// Fonction helper pour récupérer le pseudo
async getUserPseudo(userId) {
    try {
        const user = await User.findOne({ facebookId: userId });
        return user?.pseudo || 'Anonyme';
    } catch (error) {
        return 'Anonyme';
    }
}

    // Terminer une conversation
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

    // Retirer un utilisateur de la file d'attente
    async removeFromQueue(userId) {
        this.waitingQueue = this.waitingQueue.filter(u => u.userId !== userId);
        await Queue.deleteOne({ userId });
        console.log(`✅ ${userId} retiré de la file d'attente`);
    }

    // Obtenir le nombre d'utilisateurs en attente
    getQueueLength() {
        return this.waitingQueue.length;
    }

    // Obtenir le nombre de conversations actives
    getActiveChatsCount() {
        return this.activeChats.size / 2; // Divisé par 2 car chaque chat a 2 participants
    }

    // Nettoyer les vieilles entrées (appeler périodiquement)
    async cleanup() {
        try {
            // Nettoyer la file d'attente (+ de 10 minutes)
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            
            const oldEntries = this.waitingQueue.filter(
                u => u.joinedAt < tenMinutesAgo
            );

            if (oldEntries.length > 0) {
                // Notifier les utilisateurs
                for (const entry of oldEntries) {
                    await this.fb.sendTextMessage(entry.userId, 
                        "⏱️ Recherche expirée (inactivité).\n\n" +
                        "Tapez /chercher pour relancer une recherche."
                    );
                }

                // Retirer de la file
                this.waitingQueue = this.waitingQueue.filter(
                    u => u.joinedAt >= tenMinutesAgo
                );

                await Queue.deleteMany({
                    joinedAt: { $lt: tenMinutesAgo }
                });
            }

            // Marquer les chats inactifs comme terminés (+ de 30 minutes sans activité)
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

            console.log('✅ Nettoyage effectué');
        } catch (error) {
            console.error('Erreur nettoyage:', error);
        }
    }

    // Initialiser le nettoyage automatique
    startAutoCleanup() {
        // Nettoyer toutes les 5 minutes
        setInterval(() => {
            this.cleanup();
        }, 5 * 60 * 1000);
        
        console.log('🔄 Nettoyage automatique activé');
    }
}

module.exports = ChatManager;
