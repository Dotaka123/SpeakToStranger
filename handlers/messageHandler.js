// handlers/messageHandler.js
const facebookAPI = require('../services/facebookAPI');
const { User, Chat, Report } = require('../models');

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
// handlers/messageHandler.js - Version corrigée
// handlers/messageHandler.js
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
                pseudo: 'Anonyme', // ✅ Ajouter un pseudo par défaut
                createdAt: new Date(),
                lastActivity: new Date(),
                status: 'online',
                isBlocked: false
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
            
            // Mettre à jour le statut si nécessaire
            if (user.status !== 'blocked') {
                await User.findOneAndUpdate(
                    { facebookId: senderId },
                    { status: 'blocked' }
                );
            }
            
            return; // STOP - Ne pas continuer
        }

        // Mettre à jour l'activité SEULEMENT si pas bloqué
        await User.findOneAndUpdate(
            { facebookId: senderId },
            { 
                lastActivity: new Date(),
                status: 'online'
            }
        );

        // Suite du traitement pour les utilisateurs non bloqués...
        const text = message.text?.toLowerCase().trim();

        // Traiter les commandes
        if (text?.startsWith('/')) {
            await this.handleCommand(senderId, text);
            return;
        }

        // Si en conversation, transférer le message
        if (this.chatManager.isInChat(senderId)) {
            await this.chatManager.relayMessage(senderId, message);
            return;
        }

        // Sinon, afficher l'aide
        await this.showHelp(senderId);

    } catch (error) {
        console.error('Erreur traitement message:', error);
        await this.fb.sendTextMessage(senderId, 
            "❌ Une erreur s'est produite. Veuillez réessayer.\n\n" +
            "Tapez /help pour voir les commandes disponibles."
        );
    }
}

    // Gérer les commandes
    async handleCommand(senderId, command) {
        const cmd = command.toLowerCase().trim();

        switch(cmd) {
            case '/start':
            case '/menu':
                await this.showHelp(senderId);
                break;

            case '/chercher':
            case '/search':
            case '/find':
                await this.startSearch(senderId);
                break;

            case '/stop':
            case '/quit':
            case '/leave':
                await this.stopChat(senderId);
                break;

            case '/pseudo':
            case '/name':
                await this.askForPseudo(senderId);
                break;

            case '/stats':
            case '/profil':
                await this.showStats(senderId);
                break;

            case '/help':
            case '/aide':
            case '/?':
                await this.showHelp(senderId);
                break;

            case '/report':
            case '/signaler':
                await this.reportUser(senderId);
                break;

            default:
                // Si c'est une réponse à une demande de pseudo
                if (await this.checkIfWaitingForPseudo(senderId, cmd.substring(1))) {
                    return;
                }
                
                await this.fb.sendTextMessage(senderId, 
                    "❓ Commande inconnue: " + cmd + "\n\n" +
                    "Tapez /help pour voir les commandes disponibles."
                );
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
            "/stats - 📊 Voir vos statistiques\n" +
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
            "/pseudo - ✏️ Changer votre pseudo\n" +
            "/stats - 📊 Voir vos statistiques\n" +
            "/signaler - 🚨 Signaler un utilisateur\n" +
            "/help - ❓ Afficher cette aide\n\n" +
            "💡 CONSEILS :\n" +
            "• Restez respectueux\n" +
            "• Ne partagez pas d'infos personnelles\n" +
            "• Amusez-vous ! 🎉\n\n" +
            "🎯 Tapez /chercher pour commencer !";

        await this.fb.sendTextMessage(senderId, helpMessage);
    }

    // Commencer une recherche
    async startSearch(senderId) {
        // Vérifier si déjà en conversation
        if (this.chatManager.isInChat(senderId)) {
            await this.fb.sendTextMessage(senderId, 
                "💬 Vous êtes déjà en conversation !\n\n" +
                "Tapez /stop pour quitter la conversation actuelle."
            );
            return;
        }

        // Vérifier si déjà en recherche
        if (this.chatManager.isInQueue(senderId)) {
            await this.fb.sendTextMessage(senderId, 
                "🔄 Vous êtes déjà en recherche...\n\n" +
                "Patience, nous cherchons quelqu'un pour vous ! 🔍"
            );
            return;
        }

        // Ajouter à la file d'attente
        await this.chatManager.addToQueue(senderId);
    }

    // Arrêter une conversation
    async stopChat(senderId) {
        if (!this.chatManager.isInChat(senderId)) {
            // Vérifier si en file d'attente
            if (this.chatManager.isInQueue(senderId)) {
                await this.chatManager.removeFromQueue(senderId);
                await this.fb.sendTextMessage(senderId, 
                    "🔚 Recherche annulée.\n\n" +
                    "Tapez /chercher pour relancer une recherche."
                );
            } else {
                await this.fb.sendTextMessage(senderId, 
                    "❌ Vous n'êtes pas en conversation.\n\n" +
                    "Tapez /chercher pour trouver quelqu'un."
                );
            }
            return;
        }

        await this.chatManager.endChat(senderId);
    }

    // Demander le pseudo
    async askForPseudo(senderId) {
        await User.findOneAndUpdate(
            { facebookId: senderId },
            { waitingForPseudo: true }
        );
        
        await this.fb.sendTextMessage(senderId, 
            "✏️ Entrez votre nouveau pseudo :\n\n" +
            "⚠️ Choisissez un pseudo respectueux\n" +
            "(max 20 caractères)"
        );
    }

    // Vérifier si on attend un pseudo
    async checkIfWaitingForPseudo(senderId, text) {
        const user = await User.findOne({ facebookId: senderId });
        
        if (!user?.waitingForPseudo) {
            return false;
        }

        // Valider le pseudo
        const newPseudo = text.trim();
        
        if (newPseudo.length === 0) {
            await this.fb.sendTextMessage(senderId, 
                "❌ Le pseudo ne peut pas être vide.\n\n" +
                "Réessayez ou tapez /help pour annuler."
            );
            return true;
        }

        if (newPseudo.length > 20) {
            await this.fb.sendTextMessage(senderId, 
                "❌ Le pseudo est trop long (max 20 caractères).\n\n" +
                "Réessayez avec un pseudo plus court."
            );
            return true;
        }

        // Filtrer les mots inappropriés (liste basique)
        const inappropriateWords = ['admin', 'bot', 'fuck', 'shit', 'pute', 'salope'];
        if (inappropriateWords.some(word => newPseudo.toLowerCase().includes(word))) {
            await this.fb.sendTextMessage(senderId, 
                "❌ Ce pseudo n'est pas approprié.\n\n" +
                "Choisissez un autre pseudo."
            );
            return true;
        }

        // Sauvegarder le pseudo
        await User.findOneAndUpdate(
            { facebookId: senderId },
            { 
                pseudo: newPseudo,
                waitingForPseudo: false
            }
        );

        await this.fb.sendTextMessage(senderId, 
            `✅ Pseudo changé avec succès !\n\n` +
            `Vous êtes maintenant : ${newPseudo}\n\n` +
            `Tapez /chercher pour trouver quelqu'un.`
        );

        return true;
    }

    // Afficher les statistiques
    async showStats(senderId) {
        const user = await User.findOne({ facebookId: senderId });
        
        if (!user) {
            await this.fb.sendTextMessage(senderId, "❌ Erreur lors de la récupération des statistiques.");
            return;
        }

        const memberSince = user.createdAt ? 
            new Date(user.createdAt).toLocaleDateString('fr-FR') : 
            'Inconnu';

        const stats = 
            `📊 VOS STATISTIQUES\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `👤 Pseudo : ${user.pseudo || 'Non défini'}\n` +
            `💬 Conversations : ${user.totalConversations || 0}\n` +
            `📝 Messages envoyés : ${user.totalMessages || 0}\n` +
            `⭐ Note moyenne : ${user.rating ? user.rating.toFixed(1) : '5.0'}/5\n` +
            `📅 Membre depuis : ${memberSince}\n` +
            `⚠️ Avertissements : ${user.warningCount || 0}\n\n` +
            `Tapez /help pour voir les commandes.`;

        await this.fb.sendTextMessage(senderId, stats);
    }

    // Signaler un utilisateur
    async reportUser(senderId) {
        const chatInfo = this.chatManager.getChatInfo(senderId);
        
        if (!chatInfo) {
            await this.fb.sendTextMessage(senderId, 
                "❌ Vous devez être en conversation pour signaler quelqu'un.\n\n" +
                "Le signalement concerne votre partenaire actuel."
            );
            return;
        }

        // Créer le signalement
        await Report.create({
            reporterId: senderId,
            reportedUserId: chatInfo.partnerId,
            chatId: chatInfo.chatId,
            reason: 'Comportement inapproprié',
            createdAt: new Date(),
            status: 'pending'
        });

        await this.fb.sendTextMessage(senderId, 
            "✅ Signalement enregistré.\n\n" +
            "Notre équipe examinera le signalement rapidement.\n" +
            "La conversation a été terminée.\n\n" +
            "Tapez /chercher pour trouver un nouveau partenaire."
        );

        // Terminer la conversation
        await this.chatManager.endChat(senderId, 'reported');
    }

    // Gérer les postbacks (si nécessaire)
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
