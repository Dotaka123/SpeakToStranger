const { User, Chat, Queue } = require('../models');
const FacebookAPI = require('../services/facebookAPI');

class ChatManager {
    constructor() {
        this.fb = new FacebookAPI();
    }

    async addToQueue(userId) {
        const user = await User.findOne({ facebookId: userId });
        
        // Vérifier si déjà dans la file
        const existing = await Queue.findOne({ userId: userId });
        if (existing) return;

        // Calculer la priorité basée sur la note
        const priority = Math.floor(user.rating * 10);

        await Queue.create({
            userId: userId,
            pseudo: user.pseudo,
            interests: user.interests,
            language: user.language,
            priority: priority
        });

        await User.findByIdAndUpdate(user._id, { status: 'waiting' });
    }

    async findMatch(userId) {
        const user = await User.findOne({ facebookId: userId });
        
        // Chercher d'abord par intérêts communs
        let match = await Queue.findOne({
            userId: { $ne: userId },
            interests: { $in: user.interests },
            language: user.language
        }).sort({ priority: -1, joinedAt: 1 });

        // Si pas de match par intérêts, prendre le premier disponible
        if (!match) {
            match = await Queue.findOne({
                userId: { $ne: userId },
                language: user.language
            }).sort({ priority: -1, joinedAt: 1 });
        }

        // Vérifier que les utilisateurs ne se sont pas bloqués
        if (match) {
            const matchUser = await User.findOne({ facebookId: match.userId });
            if (user.blockedUsers.includes(match.userId) || 
                matchUser.blockedUsers.includes(userId)) {
                // Rechercher un autre match
                return this.findMatch(userId);
            }
        }

        return match;
    }

    async createChat(userId1, userId2) {
        // Retirer de la file d'attente
        await Queue.deleteMany({ userId: { $in: [userId1, userId2] } });

        const user1 = await User.findOne({ facebookId: userId1 });
        const user2 = await User.findOne({ facebookId: userId2 });

        // Créer la conversation
        const chat = await Chat.create({
            participants: [
                { userId: userId1, pseudo: user1.pseudo },
                { userId: userId2, pseudo: user2.pseudo }
            ],
            theme: this.findCommonInterest(user1.interests, user2.interests)
        });

        // Mettre à jour les utilisateurs
        await User.findByIdAndUpdate(user1._id, {
            currentChat: chat._id,
            status: 'chatting',
            $inc: { totalConversations: 1 }
        });

        await User.findByIdAndUpdate(user2._id, {
            currentChat: chat._id,
            status: 'chatting',
            $inc: { totalConversations: 1 }
        });

        // Envoyer les messages de connexion
        const commonInterests = user1.interests.filter(i => user2.interests.includes(i));
        let connectionMessage = `✅ Connecté avec ${user2.pseudo}!`;
        
        if (commonInterests.length > 0) {
            connectionMessage += `\n🎯 Intérêts communs: ${commonInterests.join(', ')}`;
        }
        
        connectionMessage += `\n⭐ Note: ${user2.rating.toFixed(1)}/5`;
        connectionMessage += `\n\n💬 Vous pouvez commencer à discuter !`;
        connectionMessage += `\n📝 Commandes: /stop, /next, /report`;

        await this.fb.sendTextMessage(userId1, connectionMessage);

        // Message pour l'autre utilisateur
        let connectionMessage2 = `✅ Connecté avec ${user1.pseudo}!`;
        
        if (commonInterests.length > 0) {
            connectionMessage2 += `\n🎯 Intérêts communs: ${commonInterests.join(', ')}`;
        }
        
        connectionMessage2 += `\n⭐ Note: ${user1.rating.toFixed(1)}/5`;
        connectionMessage2 += `\n\n💬 Vous pouvez commencer à discuter !`;
        connectionMessage2 += `\n📝 Commandes: /stop, /next, /report`;

        await this.fb.sendTextMessage(userId2, connectionMessage2);

        // Envoyer un starter de conversation si intérêt commun
        if (commonInterests.length > 0) {
            const starters = this.getConversationStarters(commonInterests[0]);
            if (starters.length > 0) {
                const starter = starters[Math.floor(Math.random() * starters.length)];
                setTimeout(async () => {
                    await this.fb.sendTextMessage(userId1, `💡 Idée: ${starter}`);
                    await this.fb.sendTextMessage(userId2, `💡 Idée: ${starter}`);
                }, 3000);
            }
        }

        return chat;
    }

    async endChat(userId) {
        const user = await User.findOne({ facebookId: userId });
        if (!user.currentChat) return;

        const chat = await Chat.findById(user.currentChat);
        const otherParticipant = chat.participants.find(p => p.userId !== userId);

        // Calculer la durée
        const duration = Math.floor((Date.now() - chat.startTime) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;

        // Mettre à jour la conversation
        await Chat.findByIdAndUpdate(chat._id, {
            isActive: false,
            endTime: new Date(),
            $set: {
                [`participants.${chat.participants.findIndex(p => p.userId === userId)}.left`]: new Date()
            }
        });

        // Mettre à jour les utilisateurs
        await User.findByIdAndUpdate(user._id, {
            currentChat: null,
            status: 'online'
        });

        const otherUser = await User.findOne({ facebookId: otherParticipant.userId });
        if (otherUser) {
            await User.findByIdAndUpdate(otherUser._id, {
                currentChat: null,
                status: 'online'
            });
        }

        // Envoyer les messages de fin
        const endMessage = `👋 Conversation terminée
⏱️ Durée: ${minutes}min ${seconds}s
📝 Messages échangés: ${chat.messageCount}

Notez votre expérience avec /rating [1-5]
Nouvelle rencontre avec /start`;

        await this.fb.sendTextMessage(userId, endMessage);
        
        if (otherParticipant) {
            await this.fb.sendTextMessage(
                otherParticipant.userId,
                `👋 Votre interlocuteur a quitté la conversation
⏱️ Durée: ${minutes}min ${seconds}s
📝 Messages échangés: ${chat.messageCount}

Notez votre expérience avec /rating [1-5]
Nouvelle rencontre avec /start`
            );
        }

        // Proposer une nouvelle conversation après 3 secondes
        setTimeout(async () => {
            await this.fb.sendQuickReplies(userId,
                "Voulez-vous rencontrer quelqu'un d'autre ?",
                [
                    { title: "✅ Oui", payload: "START_CHAT" },
                    { title: "❌ Non", payload: "END_SESSION" }
                ]
            );
        }, 3000);
    }

    findCommonInterest(interests1, interests2) {
        const common = interests1.filter(i => interests2.includes(i));
        return common.length > 0 ? common[0] : null;
    }

    getConversationStarters(interest) {
        const starters = {
            'Gaming': [
                "Quel est votre jeu préféré en ce moment ?",
                "Plutôt PC ou console ?",
                "Un jeu que vous attendez avec impatience ?"
            ],
            'Musique': [
                "Quel genre de musique écoutez-vous ?",
                "Un artiste que vous avez découvert récemment ?",
                "Votre chanson du moment ?"
            ],
            'Cinéma': [
                "Vu un bon film récemment ?",
                "Votre genre de film préféré ?",
                "Une série à recommander ?"
            ],
            'Tech': [
                "Une technologie qui vous passionne ?",
                "Votre setup de travail ?",
                "Une app indispensable pour vous ?"
            ],
            'Sport': [
                "Quel sport pratiquez-vous ?",
                "Une équipe que vous supportez ?",
                "Votre sportif préféré ?"
            ]
        };

        return starters[interest] || [];
    }
}

module.exports = ChatManager;
