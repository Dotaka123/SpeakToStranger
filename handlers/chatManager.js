// handlers/chatManager.js
const facebookAPI = require('../services/facebookAPI');
const { Chat, User, Queue } = require('../models');

class ChatManager {
    constructor() {
        this.fb = facebookAPI; // Utiliser directement l'instance exportée
        this.activeChats = new Map();
        this.waitingQueue = [];
    }

    // Ajouter un utilisateur à la file d'attente
    async addToQueue(userId, userPreferences = {}) {
        try {
            // Vérifier si l'utilisateur n'est pas déjà en file d'attente
            if (this.waitingQueue.find(u => u.userId === userId)) {
                await this.fb.sendTextMessage(userId, "🔄 Vous êtes déjà en recherche d'un partenaire...");
                return;
            }

            // Vérifier si l'utilisateur n'est pas déjà en conversation
            if (this.activeChats.has(userId)) {
                await this.fb.sendTextMessage(userId, "💬 Vous êtes déjà en conversation !");
                return;
            }

            // Ajouter à la file d'attente
            this.waitingQueue.push({
                userId,
                preferences: userPreferences,
                joinedAt: new Date()
            });

            // Sauvegarder en base de données
            await Queue.create({
                userId,
                preferences: userPreferences,
                joinedAt: new Date()
            });

            // Essayer de matcher
            await this.tryMatch(userId);
        } catch (error) {
            console.error('Erreur ajout file d\'attente:', error);
            await this.fb.sendTextMessage(userId, "❌ Une erreur s'est produite. Veuillez réessayer.");
        }
    }

    // Essayer de trouver un match
    async tryMatch(userId) {
        const userIndex = this.waitingQueue.findIndex(u => u.userId === userId);
        if (userIndex === -1) return;

        const user = this.waitingQueue[userIndex];

        // Chercher un partenaire compatible
        for (let i = 0; i < this.waitingQueue.length; i++) {
            if (i !== userIndex) {
                const partner = this.waitingQueue[i];
                
                // Vérifier la compatibilité (vous pouvez ajouter des critères)
                if (this.areCompatible(user, partner)) {
                    // Retirer les deux de la file d'attente
                    this.waitingQueue = this.waitingQueue.filter(
                        u => u.userId !== user.userId && u.userId !== partner.userId
                    );

                    // Retirer de la base de données
                    await Queue.deleteMany({
                        userId: { $in: [user.userId, partner.userId] }
                    });

                    // Créer la conversation
                    await this.createChat(user.userId, partner.userId);
                    return;
                }
            }
        }

        // Pas de match trouvé
        await this.fb.sendTextMessage(userId, "🔍 Recherche d'un partenaire en cours...\n\nVous recevrez une notification dès qu'un partenaire sera trouvé !");
    }

    // Vérifier la compatibilité
    areCompatible(user1, user2) {
        // Logique de compatibilité simple
        // Vous pouvez améliorer selon vos besoins
        
        // Si les deux ont des préférences d'intérêts
        if (user1.preferences?.interests && user2.preferences?.interests) {
            const commonInterests = user1.preferences.interests.filter(
                i => user2.preferences.interests.includes(i)
            );
            return commonInterests.length > 0;
        }

        // Par défaut, tout le monde est compatible
        return true;
    }

    // Créer une nouvelle conversation
    async createChat(userId1, userId2) {
        try {
            // Récupérer les infos des utilisateurs
            const [user1, user2] = await Promise.all([
                User.findOne({ facebookId: userId1 }),
                User.findOne({ facebookId: userId2 })
            ]);

            // Créer le chat en base de données
            const chat = await Chat.create({
                participants: [
                    { userId: userId1, pseudo: user1?.pseudo },
                    { userId: userId2, pseudo: user2?.pseudo }
                ],
                startedAt: new Date(),
                isActive: true,
                messageCount: 0
            });

            // Stocker dans la map active
            this.activeChats.set(userId1, {
                chatId: chat._id,
                partnerId: userId2,
                partnerPseudo: user2?.pseudo || 'Inconnu'
            });

            this.activeChats.set(userId2, {
                chatId: chat._id,
                partnerId: userId1,
                partnerPseudo: user1?.pseudo || 'Inconnu'
            });

            // Notifier les deux utilisateurs
            const message1 = `🎉 Match trouvé !\n\nVous êtes maintenant connecté avec ${user2?.pseudo || 'un utilisateur'}.\n\n💬 Dites bonjour pour commencer la conversation !\n\nTapez /stop pour terminer la conversation.`;
            const message2 = `🎉 Match trouvé !\n\nVous êtes maintenant connecté avec ${user1?.pseudo || 'un utilisateur'}.\n\n💬 Dites bonjour pour commencer la conversation !\n\nTapez /stop pour terminer la conversation.`;

            await Promise.all([
                this.fb.sendTextMessage(userId1, message1),
                this.fb.sendTextMessage(userId2, message2)
            ]);

            return chat;
        } catch (error) {
            console.error('Erreur création chat:', error);
            
            // Notifier les utilisateurs de l'erreur
            await Promise.all([
                this.fb.sendTextMessage(userId1, "❌ Erreur lors de la création de la conversation."),
                this.fb.sendTextMessage(userId2, "❌ Erreur lors de la création de la conversation.")
            ]);
        }
    }

    // Transférer un message
    async relayMessage(senderId, message) {
        const chat = this.activeChats.get(senderId);
        if (!chat) {
            await this.fb.sendTextMessage(senderId, "❌ Vous n'êtes pas en conversation actuellement.\n\nTapez /chercher pour trouver un partenaire.");
            return false;
        }

        try {
            // Mettre à jour le compteur de messages
            await Chat.findByIdAndUpdate(chat.chatId, {
                $inc: { messageCount: 1 },
                lastActivity: new Date()
            });

            // Transférer le message au partenaire
            if (message.text) {
                await this.fb.sendTextMessage(chat.partnerId, `${chat.partnerPseudo}: ${message.text}`);
            } else if (message.attachments) {
                await this.fb.sendTextMessage(chat.partnerId, `${chat.partnerPseudo} a envoyé une pièce jointe`);
            }

            return true;
        } catch (error) {
            console.error('Erreur transfert message:', error);
            return false;
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

            // Notifier les deux utilisateurs
            const endMessage = "🔚 La conversation est terminée.\n\nTapez /chercher pour trouver un nouveau partenaire.";
            
            await Promise.all([
                this.fb.sendTextMessage(userId, endMessage),
                this.fb.sendTextMessage(chat.partnerId, "🔚 Votre partenaire a quitté la conversation.\n\n" + endMessage)
            ]);

            // Proposer de chercher un nouveau partenaire
            const quickReplies = [
                {
                    content_type: 'text',
                    title: '🔍 Nouvelle recherche',
                    payload: 'CHERCHER'
                },
                {
                    content_type: 'text',
                    title: '📊 Mes stats',
                    payload: 'STATS'
                }
            ];

            await Promise.all([
                this.fb.sendQuickReply(userId, "Que souhaitez-vous faire ?", quickReplies),
                this.fb.sendQuickReply(chat.partnerId, "Que souhaitez-vous faire ?", quickReplies)
            ]);

            return true;
        } catch (error) {
            console.error('Erreur fin chat:', error);
            return false;
        }
    }

    // Vérifier si un utilisateur est en conversation
    isInChat(userId) {
        return this.activeChats.has(userId);
    }

    // Obtenir les infos de conversation d'un utilisateur
    getChatInfo(userId) {
        return this.activeChats.get(userId);
    }

    // Retirer un utilisateur de la file d'attente
    async removeFromQueue(userId) {
        this.waitingQueue = this.waitingQueue.filter(u => u.userId !== userId);
        await Queue.deleteOne({ userId });
    }

    // Obtenir le nombre d'utilisateurs en attente
    getQueueLength() {
        return this.waitingQueue.length;
    }

    // Obtenir le nombre de conversations actives
    getActiveChatsCount() {
        return this.activeChats.size / 2; // Divisé par 2 car chaque chat a 2 participants
    }

    // Nettoyer les vieilles entrées (à appeler périodiquement)
    async cleanup() {
        try {
            // Nettoyer la file d'attente (+ de 30 minutes)
            const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
            
            this.waitingQueue = this.waitingQueue.filter(
                u => u.joinedAt > thirtyMinutesAgo
            );

            await Queue.deleteMany({
                joinedAt: { $lt: thirtyMinutesAgo }
            });

            // Marquer les chats inactifs comme terminés (+ de 1 heure sans activité)
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            
            const inactiveChats = await Chat.find({
                isActive: true,
                lastActivity: { $lt: oneHourAgo }
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
}

module.exports = ChatManager;
