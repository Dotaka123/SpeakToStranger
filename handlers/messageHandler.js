// handlers/messageHandler.js
const facebookAPI = require('../services/facebookAPI');
const { User, Chat, Report } = require('../models');

class MessageHandler {
    constructor(chatManager) {
        this.chatManager = chatManager;
        this.fb = facebookAPI; // Utiliser directement l'instance exportée, pas new FacebookAPI()
    }

    // Gérer les messages entrants
    async handleMessage(senderId, message) {
        try {
            // Marquer le message comme vu
            await this.fb.markSeen(senderId);

            // Vérifier si l'utilisateur existe ou le créer
            let user = await User.findOne({ facebookId: senderId });
            if (!user) {
                user = await User.create({
                    facebookId: senderId,
                    createdAt: new Date(),
                    lastActivity: new Date()
                });
                
                // Message de bienvenue pour les nouveaux utilisateurs
                await this.sendWelcomeMessage(senderId);
                return;
            }

            // Mettre à jour la dernière activité
            await User.findOneAndUpdate(
                { facebookId: senderId },
                { lastActivity: new Date() }
            );

            // Vérifier si l'utilisateur est bloqué
            if (user.isBlocked) {
                await this.fb.sendTextMessage(senderId, 
                    "🚫 Votre compte a été suspendu.\n\nSi vous pensez qu'il s'agit d'une erreur, contactez le support."
                );
                return;
            }

            // Traiter les commandes
            if (message.text && message.text.startsWith('/')) {
                await this.handleCommand(senderId, message.text);
                return;
            }

            // Traiter les quick replies
            if (message.quick_reply) {
                await this.handleQuickReply(senderId, message.quick_reply.payload);
                return;
            }

            // Si l'utilisateur est en conversation, transférer le message
            if (this.chatManager.isInChat(senderId)) {
                await this.chatManager.relayMessage(senderId, message);
                return;
            }

            // Sinon, afficher le menu principal
            await this.showMainMenu(senderId);

        } catch (error) {
            console.error('Erreur traitement message:', error);
            await this.fb.sendTextMessage(senderId, 
                "❌ Une erreur s'est produite. Veuillez réessayer plus tard."
            );
        }
    }

    // Gérer les commandes
    async handleCommand(senderId, command) {
        const cmd = command.toLowerCase().trim();

        switch(cmd) {
            case '/start':
            case '/menu':
                await this.showMainMenu(senderId);
                break;

            case '/chercher':
            case '/search':
                await this.startSearch(senderId);
                break;

            case '/stop':
            case '/quit':
                await this.stopChat(senderId);
                break;

            case '/pseudo':
                await this.changePseudo(senderId);
                break;

            case '/stats':
                await this.showStats(senderId);
                break;

            case '/help':
            case '/aide':
                await this.showHelp(senderId);
                break;

            case '/report':
            case '/signaler':
                await this.reportUser(senderId);
                break;

            default:
                await this.fb.sendTextMessage(senderId, 
                    "❓ Commande inconnue.\n\nTapez /help pour voir les commandes disponibles."
                );
        }
    }

    // Gérer les quick replies
    async handleQuickReply(senderId, payload) {
        switch(payload) {
            case 'CHERCHER':
                await this.startSearch(senderId);
                break;

            case 'STOP':
                await this.stopChat(senderId);
                break;

            case 'PSEUDO':
                await this.changePseudo(senderId);
                break;

            case 'STATS':
                await this.showStats(senderId);
                break;

            case 'HELP':
                await this.showHelp(senderId);
                break;

            case 'REPORT':
                await this.reportUser(senderId);
                break;

            default:
                // Gérer les payloads personnalisés
                if (payload.startsWith('INTERESTS_')) {
                    await this.handleInterests(senderId, payload);
                }
        }
    }

    // Message de bienvenue
    async sendWelcomeMessage(senderId) {
        const welcomeMessage = `🎭 Bienvenue sur SpeakToStranger !\n\n` +
            `Je suis votre assistant pour vous connecter avec des inconnus du monde entier.\n\n` +
            `🌟 Comment ça marche ?\n` +
            `1. Choisissez un pseudo (optionnel)\n` +
            `2. Lancez une recherche\n` +
            `3. Discutez avec un inconnu\n` +
            `4. Restez respectueux !\n\n` +
            `Que souhaitez-vous faire ?`;

        const quickReplies = [
            {
                content_type: 'text',
                title: '🔍 Chercher quelqu\'un',
                payload: 'CHERCHER'
            },
            {
                content_type: 'text',
                title: '✏️ Choisir un pseudo',
                payload: 'PSEUDO'
            },
            {
                content_type: 'text',
                title: '❓ Aide',
                payload: 'HELP'
            }
        ];

        await this.fb.sendQuickReply(senderId, welcomeMessage, quickReplies);
    }

    // Menu principal
    async showMainMenu(senderId) {
        const user = await User.findOne({ facebookId: senderId });
        const pseudo = user?.pseudo || 'Anonyme';

        const menuMessage = `👋 Bonjour ${pseudo} !\n\nQue souhaitez-vous faire ?`;

        const quickReplies = [
            {
                content_type: 'text',
                title: '🔍 Chercher quelqu\'un',
                payload: 'CHERCHER'
            },
            {
                content_type: 'text',
                title: '✏️ Changer de pseudo',
                payload: 'PSEUDO'
            },
            {
                content_type: 'text',
                title: '📊 Mes statistiques',
                payload: 'STATS'
            },
            {
                content_type: 'text',
                title: '❓ Aide',
                payload: 'HELP'
            }
        ];

        await this.fb.sendQuickReply(senderId, menuMessage, quickReplies);
    }

    // Commencer une recherche
    async startSearch(senderId) {
        // Vérifier si déjà en recherche ou en conversation
        if (this.chatManager.isInChat(senderId)) {
            await this.fb.sendTextMessage(senderId, 
                "💬 Vous êtes déjà en conversation !\n\nTapez /stop pour la terminer."
            );
            return;
        }

        // Demander les préférences (optionnel)
        await this.askInterests(senderId);
    }

    // Demander les centres d'intérêt
    async askInterests(senderId) {
        const message = "🎯 Choisissez vos centres d'intérêt (optionnel) :";
        
        const quickReplies = [
            {
                content_type: 'text',
                title: '🎮 Gaming',
                payload: 'INTERESTS_gaming'
            },
            {
                content_type: 'text',
                title: '🎵 Musique',
                payload: 'INTERESTS_music'
            },
            {
                content_type: 'text',
                title: '🎬 Films/Séries',
                payload: 'INTERESTS_movies'
            },
            {
                content_type: 'text',
                title: '⚽ Sport',
                payload: 'INTERESTS_sports'
            },
            {
                content_type: 'text',
                title: '📚 Lecture',
                payload: 'INTERESTS_reading'
            },
            {
                content_type: 'text',
                title: '🎨 Art',
                payload: 'INTERESTS_art'
            },
            {
                content_type: 'text',
                title: '💻 Tech',
                payload: 'INTERESTS_tech'
            },
            {
                content_type: 'text',
                title: '🌍 Voyages',
                payload: 'INTERESTS_travel'
            },
            {
                content_type: 'text',
                title: '⏭️ Passer',
                payload: 'INTERESTS_skip'
            }
        ];

        await this.fb.sendQuickReply(senderId, message, quickReplies);
    }

    // Gérer la sélection des intérêts
    async handleInterests(senderId, payload) {
        const interest = payload.replace('INTERESTS_', '');
        
        if (interest === 'skip') {
            // Lancer la recherche sans préférences
            await this.chatManager.addToQueue(senderId);
        } else {
            // Sauvegarder l'intérêt et lancer la recherche
            await User.findOneAndUpdate(
                { facebookId: senderId },
                { $addToSet: { interests: interest } }
            );
            
            await this.chatManager.addToQueue(senderId, { interests: [interest] });
        }
    }

    // Arrêter une conversation
    async stopChat(senderId) {
        if (!this.chatManager.isInChat(senderId)) {
            await this.fb.sendTextMessage(senderId, 
                "❌ Vous n'êtes pas en conversation actuellement."
            );
            return;
        }

        await this.chatManager.endChat(senderId);
    }

    // Changer de pseudo
    async changePseudo(senderId) {
        await this.fb.sendTextMessage(senderId, 
            "✏️ Entrez votre nouveau pseudo :\n\n" +
            "⚠️ Évitez les pseudos offensants ou personnels."
        );
        
        // Stocker l'état en attente du pseudo
        await User.findOneAndUpdate(
            { facebookId: senderId },
            { waitingForPseudo: true }
        );
    }

    // Afficher les statistiques
    async showStats(senderId) {
        const user = await User.findOne({ facebookId: senderId });
        
        if (!user) {
            await this.fb.sendTextMessage(senderId, "❌ Erreur lors de la récupération des statistiques.");
            return;
        }

        const stats = `📊 Vos statistiques :\n\n` +
            `👤 Pseudo : ${user.pseudo || 'Non défini'}\n` +
            `💬 Conversations : ${user.totalConversations || 0}\n` +
            `📝 Messages envoyés : ${user.totalMessages || 0}\n` +
            `⭐ Note moyenne : ${user.rating ? user.rating.toFixed(1) : '5.0'}/5\n` +
            `📅 Membre depuis : ${user.createdAt?.toLocaleDateString('fr-FR') || 'Inconnu'}\n` +
            `🎯 Intérêts : ${user.interests?.join(', ') || 'Aucun'}`;

        await this.fb.sendTextMessage(senderId, stats);
        
        // Proposer des actions
        const quickReplies = [
            {
                content_type: 'text',
                title: '🔍 Nouvelle recherche',
                payload: 'CHERCHER'
            },
            {
                content_type: 'text',
                title: '✏️ Changer de pseudo',
                payload: 'PSEUDO'
            }
        ];

        await this.fb.sendQuickReply(senderId, "Que souhaitez-vous faire ?", quickReplies);
    }

    // Afficher l'aide
    async showHelp(senderId) {
        const helpMessage = `❓ Aide - Commandes disponibles :\n\n` +
            `🔍 /chercher - Trouver un partenaire\n` +
            `🛑 /stop - Terminer la conversation\n` +
            `✏️ /pseudo - Changer votre pseudo\n` +
            `📊 /stats - Voir vos statistiques\n` +
            `🚨 /signaler - Signaler un utilisateur\n` +
            `📋 /menu - Afficher le menu principal\n` +
            `❓ /help - Afficher cette aide\n\n` +
            `💡 Conseils :\n` +
            `• Restez respectueux\n` +
            `• Ne partagez pas d'infos personnelles\n` +
            `• Signalez les comportements inappropriés\n` +
            `• Amusez-vous ! 🎉`;

        await this.fb.sendTextMessage(senderId, helpMessage);
        
        await this.showMainMenu(senderId);
    }

    // Signaler un utilisateur
    async reportUser(senderId) {
        const chatInfo = this.chatManager.getChatInfo(senderId);
        
        if (!chatInfo) {
            await this.fb.sendTextMessage(senderId, 
                "❌ Vous devez être en conversation pour signaler quelqu'un."
            );
            return;
        }

        const message = "🚨 Pourquoi souhaitez-vous signaler cet utilisateur ?";
        
        const quickReplies = [
            {
                content_type: 'text',
                title: '🤬 Langage offensant',
                payload: `REPORT_offensive_${chatInfo.partnerId}`
            },
            {
                content_type: 'text',
                title: '😈 Harcèlement',
                payload: `REPORT_harassment_${chatInfo.partnerId}`
            },
            {
                content_type: 'text',
                title: '📧 Spam',
                payload: `REPORT_spam_${chatInfo.partnerId}`
            },
            {
                content_type: 'text',
                title: '🔞 Contenu inapproprié',
                payload: `REPORT_inappropriate_${chatInfo.partnerId}`
            },
            {
                content_type: 'text',
                title: '❌ Annuler',
                payload: 'CANCEL_REPORT'
            }
        ];

        await this.fb.sendQuickReply(senderId, message, quickReplies);
    }
}

module.exports = MessageHandler;
