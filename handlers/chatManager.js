// handlers/chatManager.js
const facebookAPI = require('../services/facebookAPI');
const { Chat, User, Queue, Message } = require('../models');

class ChatManager {
    constructor() {
        this.fb = facebookAPI;
        this.activeChats = new Map();
        this.waitingQueue = [];
        
        // NOUVEAU : Protection contre la concurrence
        this.processingUsers = new Set(); // Users en cours de traitement
        this.matchingLock = false; // Verrou pour le matching
    }

    // ========================================
    // GESTION DE LA FILE D'ATTENTE SÉCURISÉE
    // ========================================

    isInQueue(userId) {
        return this.waitingQueue.some(u => u.userId === userId);
    }

    isInChat(userId) {
        return this.activeChats.has(userId);
    }

    isBeingProcessed(userId) {
        return this.processingUsers.has(userId);
    }

    getChatInfo(userId) {
        return this.activeChats.get(userId);
    }

    async addToQueue(userId, userPreferences = {}) {
    try {
        console.log(`🔄 Tentative d'ajout à la queue: ${userId}`);
        
        // NOUVEAU : Vérifier si déjà en traitement
        if (this.isBeingProcessed(userId)) {
            console.log(`⚠️ ${userId} déjà en cours de traitement`);
            return;
        }
        
        // Marquer comme en traitement
        this.processingUsers.add(userId);
        
        // Vérifier si déjà en file d'attente
        if (this.isInQueue(userId)) {
            this.processingUsers.delete(userId);
            await this.fb.sendTextMessage(userId, 
                "🔄 Vous êtes déjà en recherche d'un partenaire...\n\n" +
                "Patience, nous cherchons quelqu'un pour vous !"
            );
            return;
        }

        // Vérifier si déjà en conversation
        if (this.isInChat(userId)) {
            this.processingUsers.delete(userId);
            await this.fb.sendTextMessage(userId, 
                "💬 Vous êtes déjà en conversation !\n\n" +
                "Tapez /stop pour terminer votre conversation actuelle."
            );
            return;
        }

        // Récupérer les infos de l'utilisateur
        const user = await User.findOne({ facebookId: userId });
        if (!user) {
            this.processingUsers.delete(userId);
            await this.fb.sendTextMessage(userId, 
                "❌ Profil utilisateur non trouvé.\n\n" +
                "Veuillez réessayer."
            );
            return;
        }

        const pseudo = user.pseudo || 'Anonyme';

        // SECTION CRITIQUE - Un seul thread à la fois
        await this.acquireMatchingLock();
        
        // DÉCLARER matchedPartner ICI, en dehors du try
        let matchedPartner = null;
        
        try {
            // Re-vérifier après avoir acquis le verrou
            if (this.isInQueue(userId) || this.isInChat(userId)) {
                console.log(`⚠️ ${userId} déjà en queue ou en chat après verrou`);
                return;
            }
            
            // Chercher un partenaire disponible IMMÉDIATEMENT
            let matchFound = false;
            
            // Parcourir la file pour trouver un match
            for (let i = 0; i < this.waitingQueue.length; i++) {
                const potentialPartner = this.waitingQueue[i];
                
                // Vérifications de sécurité
                if (potentialPartner.userId === userId) continue;
                if (this.isInChat(potentialPartner.userId)) continue;
                if (this.isBeingProcessed(potentialPartner.userId)) continue;
                
                // Match trouvé !
                matchedPartner = potentialPartner;
                matchFound = true;
                
                // Retirer le partenaire de la queue IMMÉDIATEMENT
                this.waitingQueue.splice(i, 1);
                
                // Marquer le partenaire comme en traitement
                this.processingUsers.add(matchedPartner.userId);
                
                console.log(`💘 Match immédiat: ${pseudo} ↔ ${matchedPartner.pseudo}`);
                break;
            }
            
            if (matchFound && matchedPartner) {
                // Créer le chat AVANT de libérer le verrou
                await this.createChatSafe(
                    { userId, pseudo },
                    matchedPartner
                );
                
                // Retirer de la base de données
                await Queue.deleteMany({
                    userId: { $in: [userId, matchedPartner.userId] }
                });
                
            } else {
                // Pas de match, ajouter à la queue
                const queueEntry = {
                    userId,
                    pseudo,
                    preferences: userPreferences,
                    joinedAt: new Date()
                };
                
                this.waitingQueue.push(queueEntry);
                
                // Sauvegarder en base de données
                try {
                    await Queue.create(queueEntry);
                } catch (dbError) {
                    console.error('Erreur sauvegarde queue:', dbError);
                    // Continuer même si la sauvegarde échoue
                }
                
                const queuePosition = this.waitingQueue.length;
                
                // Message avec position
                let waitMessage = "🔍 RECHERCHE EN COURS...\n" +
                                 "━━━━━━━━━━━━━━━━━━\n\n" +
                                 "Vous êtes dans la file d'attente.\n";
                
                if (queuePosition > 1) {
                    waitMessage += `📊 Position : ${queuePosition}\n`;
                    waitMessage += `👥 ${queuePosition - 1} personne(s) devant vous\n\n`;
                } else {
                    waitMessage += "Vous êtes le premier ! ⭐\n\n";
                }
                
                waitMessage += "⏳ Patientez, quelqu'un va bientôt arriver...\n\n" +
                              "💡 Tapez /stop pour annuler";
                
                await this.fb.sendTextMessage(userId, waitMessage);
                
                console.log(`📋 Ajouté à la queue: ${pseudo} (Position ${queuePosition})`);
            }
            
        } finally {
            // Libérer le verrou et retirer du traitement
            this.releaseMatchingLock();
            this.processingUsers.delete(userId);
            
            // Retirer le partenaire du traitement si match
            if (matchedPartner) {
                this.processingUsers.delete(matchedPartner.userId);
            }
        }

    } catch (error) {
        console.error('Erreur ajout file d\'attente:', error);
        this.processingUsers.delete(userId);
        this.releaseMatchingLock();
        
        await this.fb.sendTextMessage(userId, 
            "❌ Une erreur s'est produite.\n\n" +
            "Veuillez réessayer avec /chercher"
        );
    }
}

    // Méthodes de verrouillage pour éviter la concurrence
    async acquireMatchingLock() {
        while (this.matchingLock) {
            // Attendre 50ms si le verrou est pris
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        this.matchingLock = true;
    }

    releaseMatchingLock() {
        this.matchingLock = false;
    }

    // Version sécurisée de createChat
    async createChatSafe(user1, user2) {
        try {
            // Double vérification avant création
            if (this.isInChat(user1.userId) || this.isInChat(user2.userId)) {
                console.log('⚠️ Un des users est déjà en chat, annulation');
                return null;
            }
            
            // Récupérer les infos complètes des utilisateurs pour les badges
            const user1Doc = await User.findOne({ facebookId: user1.userId });
            const user2Doc = await User.findOne({ facebookId: user2.userId });
            
            // Thèmes préférés de chaque utilisateur (sur leur profil)
            const theme1 = user1Doc?.preferredTheme || null;
            const theme2 = user2Doc?.preferredTheme || null;

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
                startTime: new Date(),
                startedAt: new Date(),
                lastActivity: new Date(),
                isActive: true,
                messageCount: 0,
                theme: theme1 || theme2 || null
            });

            // Stocker dans la map active ATOMIQUEMENT
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

            // Fonction pour générer l'info utilisateur
            const getUserInfo = (user, userDoc) => {
                let info = '';
                
                // Badge vérifié
                if (userDoc && userDoc.totalConversations >= 10 && userDoc.respectScore >= 80) {
                    info += '🛡️ Utilisateur Vérifié';
                    const convCount = userDoc.totalConversations;
                    info += ` (${convCount} conv.)\n`;
                }
                
                // Score de respect
                if (userDoc && userDoc.respectScore >= 90) {
                    info += `Score de respect: ⭐⭐⭐⭐⭐\n`;
                } else if (userDoc && userDoc.respectScore >= 70) {
                    info += `Score de respect: ⭐⭐⭐⭐\n`;
                }
                
                return info;
            };

            const user1Info = getUserInfo(user1, user2Doc); // Info du partenaire pour user1
            const user2Info = getUserInfo(user2, user1Doc); // Info du partenaire pour user2

            // Construire la ligne thème pour chaque utilisateur
            const buildThemeLine = (myTheme, partnerTheme) => {
                if (myTheme && partnerTheme && myTheme !== partnerTheme) {
                    return `🎭 Thèmes : ${myTheme} (toi) × ${partnerTheme} (partenaire)\n\n`;
                } else if (myTheme || partnerTheme) {
                    return `🎭 Thème : ${myTheme || partnerTheme}\n\n`;
                }
                return '';
            };

            const themeLine1 = buildThemeLine(theme1, theme2);
            const themeLine2 = buildThemeLine(theme2, theme1);

            // 🆕 Messages de connexion améliorés
            const message1 = {
                text: `🎉 CONVERSATION DÉMARRÉE\n━━━━━━━━━━━━━━━━━━\n\nVous êtes connecté avec ${user2.pseudo || 'Anonyme'}\n${user1Info ? user1Info + '\n' : ''}${themeLine1}💬 Discutez librement et respectueusement\n🛡️ Protection anti-harcèlement active\n\nCommandes: /stop | /signaler | /favoris`,
                quick_replies: [
                    { content_type: "text", title: "⭐ Ajouter favoris", payload: "QUICK_ADD_FAV" },
                    { content_type: "text", title: "🚫 Signaler", payload: "QUICK_SIGNALER" },
                    { content_type: "text", title: "📊 Stats", payload: "QUICK_STATS" }
                ]
            };

            const message2 = {
                text: `🎉 CONVERSATION DÉMARRÉE\n━━━━━━━━━━━━━━━━━━\n\nVous êtes connecté avec ${user1.pseudo || 'Anonyme'}\n${user2Info ? user2Info + '\n' : ''}${themeLine2}💬 Discutez librement et respectueusement\n🛡️ Protection anti-harcèlement active\n\nCommandes: /stop | /signaler | /favoris`,
                quick_replies: [
                    { content_type: "text", title: "⭐ Ajouter favoris", payload: "QUICK_ADD_FAV" },
                    { content_type: "text", title: "🚫 Signaler", payload: "QUICK_SIGNALER" },
                    { content_type: "text", title: "📊 Stats", payload: "QUICK_STATS" }
                ]
            };

            await Promise.all([
                this.fb.sendQuickReplies(user1.userId, message1),
                this.fb.sendQuickReplies(user2.userId, message2)
            ]);

            // Mettre à jour les stats
            await User.updateMany(
                { facebookId: { $in: [user1.userId, user2.userId] } },
                { $inc: { totalConversations: 1 } }
            );

            console.log(`✅ Chat créé avec succès: ${user1.pseudo} ↔ ${user2.pseudo}${chat.theme ? ` (${chat.theme})` : ''}`);
            return chat;

        } catch (error) {
            console.error('Erreur création chat:', error);
            
            // Nettoyer en cas d'erreur
            this.activeChats.delete(user1.userId);
            this.activeChats.delete(user2.userId);
            
            const errorMessage = 
                "❌ Erreur lors de la création de la conversation.\n\n" +
                "Veuillez réessayer avec /chercher";

            await Promise.all([
                this.fb.sendTextMessage(user1.userId, errorMessage),
                this.fb.sendTextMessage(user2.userId, errorMessage)
            ]);
            
            return null;
        }
    }

    async removeFromQueue(userId) {
        await this.acquireMatchingLock();
        try {
            this.waitingQueue = this.waitingQueue.filter(u => u.userId !== userId);
            await Queue.deleteOne({ userId });
            this.processingUsers.delete(userId);
            console.log(`✅ ${userId} retiré de la file d'attente`);
        } finally {
            this.releaseMatchingLock();
        }
    }

    // ANCIEN createChat - remplacé par createChatSafe mais gardé pour compatibilité
    async createChat(user1, user2) {
        return this.createChatSafe(user1, user2);
    }

    async tryMatch(userId) {
        // Cette méthode n'est plus nécessaire car le matching se fait dans addToQueue
        console.log('tryMatch appelé mais ignoré (ancien système)');
    }

    async endChat(userId, reason = 'user_request') {
        const chat = this.activeChats.get(userId);
        if (!chat) return false;

        try {
            // Récupérer les infos du chat depuis la DB
            const chatDoc = await Chat.findById(chat.chatId);
            if (!chatDoc) return false;

            const startTime = chatDoc.startTime || chatDoc.startedAt;
            const endTime = new Date();
            const duration = startTime ? Math.floor((endTime - startTime) / 1000) : 0;

            // Mettre à jour en base de données
            await Chat.findByIdAndUpdate(chat.chatId, {
                isActive: false,
                endTime: endTime,
                endedAt: endTime,
                endReason: reason,
                duration: duration
            });

            // 🆕 AJOUTER À L'HISTORIQUE DES DEUX UTILISATEURS
            const user1 = await User.findOne({ facebookId: userId });
            const user2 = await User.findOne({ facebookId: chat.partnerId });

            const historyEntry1 = {
                partnerId: chat.partnerId,
                partnerPseudo: chat.partnerPseudo,
                chatId: chat.chatId,
                endedAt: endTime,
                duration: duration,
                messageCount: chatDoc.messageCount || 0
            };

            const historyEntry2 = {
                partnerId: userId,
                partnerPseudo: user1?.pseudo || 'Anonyme',
                chatId: chat.chatId,
                endedAt: endTime,
                duration: duration,
                messageCount: chatDoc.messageCount || 0
            };

            await User.findOneAndUpdate(
                { facebookId: userId },
                { 
                    $push: { 
                        conversationHistory: {
                            $each: [historyEntry1],
                            $slice: -20  // Garder seulement les 20 dernières
                        }
                    },
                    totalChatDuration: (user1?.totalChatDuration || 0) + duration
                }
            );

            await User.findOneAndUpdate(
                { facebookId: chat.partnerId },
                { 
                    $push: { 
                        conversationHistory: {
                            $each: [historyEntry2],
                            $slice: -20
                        }
                    },
                    totalChatDuration: (user2?.totalChatDuration || 0) + duration
                }
            );

            // Retirer de la map active
            this.activeChats.delete(userId);
            this.activeChats.delete(chat.partnerId);

            // Formater la durée
            const formatDuration = (secs) => {
                const hours = Math.floor(secs / 3600);
                const minutes = Math.floor((secs % 3600) / 60);
                const seconds = secs % 60;
                if (hours > 0) return `${hours}h ${minutes}min`;
                if (minutes > 0) return `${minutes}min ${seconds}s`;
                return `${seconds}s`;
            };

            // 🆕 MESSAGES AMÉLIORÉS AVEC QUICK REPLIES
            const endMessage1 = {
                text: `💬 CONVERSATION TERMINÉE\n━━━━━━━━━━━━━━━━━━\n\nAvec: ${chat.partnerPseudo}\nDurée: ${formatDuration(duration)}\nMessages: ${chatDoc.messageCount || 0}\n\nMerci d'avoir utilisé SpeakToStranger !`,
                quick_replies: [
                    { content_type: "text", title: "⭐ Ajouter aux favoris", payload: "QUICK_ADD_FAV" },
                    { content_type: "text", title: "🔍 Nouvelle conversation", payload: "QUICK_CHERCHER" },
                    { content_type: "text", title: "📋 Historique", payload: "QUICK_HISTORIQUE" }
                ]
            };

            const endMessage2 = {
                text: `💬 CONVERSATION TERMINÉE\n━━━━━━━━━━━━━━━━━━\n\nVotre partenaire a quitté la conversation.\n\nAvec: ${user1?.pseudo || 'Anonyme'}\nDurée: ${formatDuration(duration)}\nMessages: ${chatDoc.messageCount || 0}`,
                quick_replies: [
                    { content_type: "text", title: "🔍 Nouvelle conversation", payload: "QUICK_CHERCHER" },
                    { content_type: "text", title: "📊 Mes stats", payload: "QUICK_STATS" },
                    { content_type: "text", title: "📋 Historique", payload: "QUICK_HISTORIQUE" }
                ]
            };

            await this.fb.sendQuickReplies(userId, endMessage1);
            
            if (reason !== 'reported') {
                await this.fb.sendQuickReplies(chat.partnerId, endMessage2);

                // 🆕 DEMANDER LE FEEDBACK (seulement si pas de report)
                setTimeout(async () => {
                    const feedbackMessage = {
                        text: "⭐ COMMENT ÉTAIT LA CONVERSATION ?\n━━━━━━━━━━━━━━━━━━\n\nVotre avis nous aide à améliorer l'expérience !",
                        quick_replies: [
                            { content_type: "text", title: "😄 Excellente", payload: "FEEDBACK_EXCELLENT" },
                            { content_type: "text", title: "🙂 Bonne", payload: "FEEDBACK_GOOD" },
                            { content_type: "text", title: "😐 Moyenne", payload: "FEEDBACK_AVERAGE" },
                            { content_type: "text", title: "😕 Mauvaise", payload: "FEEDBACK_BAD" }
                        ]
                    };

                    await this.fb.sendQuickReplies(userId, feedbackMessage);
                    await this.fb.sendQuickReplies(chat.partnerId, feedbackMessage);
                }, 2000);
            }

            console.log(`✅ Chat terminé entre ${userId} et ${chat.partnerId} - ${formatDuration(duration)}`);
            return true;

        } catch (error) {
            console.error('Erreur fin chat:', error);
            return false;
        }
    }

    // ========================================
    // GESTION DES MESSAGES (RESTE IDENTIQUE)
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

    // Méthode pour afficher l'état actuel (debug)
    getSystemStatus() {
        return {
            queueLength: this.waitingQueue.length,
            activeChats: this.activeChats.size / 2,
            processingUsers: Array.from(this.processingUsers),
            lockStatus: this.matchingLock ? 'LOCKED' : 'FREE',
            queue: this.waitingQueue.map(u => ({
                pseudo: u.pseudo,
                waiting: `${Math.floor((Date.now() - u.joinedAt.getTime()) / 1000)}s`
            }))
        };
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
