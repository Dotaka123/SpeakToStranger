// handlers/messageHandler.js
const facebookAPI = require('../services/facebookAPI');
const { User, Chat, Report, Stats, Message } = require('../models');

// ========================================
// GÉNÉRATEUR DE PSEUDOS - EN DEHORS DE LA CLASSE
// ========================================
const ADJECTIVES = [
    'Brave', 'Joyeux', 'Sage', 'Brillant', 'Mystique', 'Rapide', 'Calme', 
    'Fou', 'Noble', 'Vif', 'Doux', 'Fort', 'Agile', 'Rusé', 'Jovial',
    'Zen', 'Cool', 'Super', 'Mega', 'Ultra', 'Hyper', 'Epic', 'Pro',
    'Royal', 'Cosmic', 'Astral', 'Lunar', 'Solar', 'Star', 'Dream'
];

const NOUNS = [
    'Chat', 'Panda', 'Lion', 'Tigre', 'Aigle', 'Loup', 'Renard', 
    'Dragon', 'Phoenix', 'Ninja', 'Pirate', 'Chevalier', 'Mage', 'Guerrier',
    'Voyageur', 'Explorateur', 'Artiste', 'Poète', 'Sage', 'Héros', 'Fantôme',
    'Robot', 'Alien', 'Cyborg', 'Génie', 'Wizard', 'Master', 'Boss'
];

function generateRandomPseudo() {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const number = Math.floor(Math.random() * 9999);
    return `${adjective}${noun}${number}`;
}

async function generateUniquePseudo() {
    const { User } = require('../models');
    let pseudo;
    let attempts = 0;
    const maxAttempts = 10;
    
    do {
        pseudo = generateRandomPseudo();
        const exists = await User.findOne({ pseudo });
        if (!exists) {
            return pseudo;
        }
        attempts++;
    } while (attempts < maxAttempts);
    
    return `User${Date.now()}`;
}

// ========================================
// CLASSE MESSAGE HANDLER
// ========================================
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
            
            // GÉRER LES QUICK REPLIES
            if (message.quick_reply && message.quick_reply.payload) {
                console.log(`🔘 Quick Reply reçu: ${message.quick_reply.payload}`);
                await this.handleQuickReplyPayload(senderId, message.quick_reply.payload);
                return;
            }
            
            // Vérifier/récupérer l'utilisateur
            let user = await User.findOne({ facebookId: senderId });
            
            if (!user) {
                // GÉNÉRER UN PSEUDO ALÉATOIRE UNIQUE
                const randomPseudo = await generateUniquePseudo();
                
                user = await User.create({
                    facebookId: senderId,
                    pseudo: randomPseudo,
                    createdAt: new Date(),
                    lastActivity: new Date(),
                    status: 'online',
                    isBlocked: false,
                    totalConversations: 0,
                    totalMessages: 0
                });
                
                console.log(`🆕 Nouvel utilisateur créé: ${randomPseudo} (${senderId})`);
                await this.sendWelcomeMessageWithPseudo(senderId, randomPseudo);
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
                    "Cette décision est définitive."
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

            // Si pas en conversation et pas une commande, vérifier si c'est un mot-clé
            if (text) {
                // Détection des thèmes par mots-clés
                const themeKeywords = {
                    'sport': 'THEME_SPORT',
                    'sports': 'THEME_SPORT',
                    'football': 'THEME_SPORT',
                    'musique': 'THEME_MUSIC',
                    'music': 'THEME_MUSIC',
                    'gaming': 'THEME_GAMING',
                    'game': 'THEME_GAMING',
                    'jeux': 'THEME_GAMING',
                    'jeu': 'THEME_GAMING',
                    'culture': 'THEME_CULTURE',
                    'voyage': 'THEME_VOYAGE',
                    'voyages': 'THEME_VOYAGE',
                    'travel': 'THEME_VOYAGE',
                    'tech': 'THEME_TECH',
                    'technologie': 'THEME_TECH',
                    'technology': 'THEME_TECH',
                    'art': 'THEME_ART',
                    'arts': 'THEME_ART',
                    'aleatoire': 'THEME_RANDOM',
                    'aléatoire': 'THEME_RANDOM',
                    'random': 'THEME_RANDOM',
                    'hasard': 'THEME_RANDOM'
                };

                // Détection des actions par mots-clés
                const actionKeywords = {
                    'chercher': 'QUICK_CHERCHER',
                    'cherche': 'QUICK_CHERCHER',
                    'rechercher': 'QUICK_CHERCHER',
                    'search': 'QUICK_CHERCHER',
                    'favoris': 'QUICK_FAVORIS',
                    'favori': 'QUICK_FAVORIS',
                    'favorite': 'QUICK_FAVORIS',
                    'favorites': 'QUICK_FAVORIS',
                    'historique': 'QUICK_HISTORIQUE',
                    'history': 'QUICK_HISTORIQUE',
                    'badges': 'QUICK_BADGES',
                    'badge': 'QUICK_BADGES',
                    'stats': 'QUICK_STATS',
                    'statistiques': 'QUICK_STATS',
                    'profil': 'QUICK_PROFIL',
                    'profile': 'QUICK_PROFIL',
                    'themes': 'QUICK_THEMES',
                    'theme': 'QUICK_THEMES',
                    'thèmes': 'QUICK_THEMES',
                    'thème': 'QUICK_THEMES'
                };

                // Vérifier si c'est un thème
                const themePayload = themeKeywords[text];
                if (themePayload) {
                    console.log(`🎯 Thème détecté par mot-clé: ${text} -> ${themePayload}`);
                    await this.handleQuickReplyPayload(senderId, themePayload);
                    return;
                }

                // Vérifier si c'est une action
                const actionPayload = actionKeywords[text];
                if (actionPayload) {
                    console.log(`⚡ Action détectée par mot-clé: ${text} -> ${actionPayload}`);
                    await this.handleQuickReplyPayload(senderId, actionPayload);
                    return;
                }
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

    // NOUVELLE MÉTHODE : Gérer les Quick Reply Payloads
    async handleQuickReplyPayload(senderId, payload) {
        try {
            switch(payload) {
                case 'QUICK_CHERCHER':
                    await this.showThemeSelection(senderId);
                    break;
                    
                case 'QUICK_STOP':
                    await this.handleStop(senderId);
                    break;
                    
                case 'QUICK_PROFIL':
                    await this.showProfile(senderId);
                    break;
                    
                case 'QUICK_STATS':
                    await this.showUserStats(senderId);
                    break;
                    
                case 'QUICK_INFOS':
                    await this.showBotStats(senderId);
                    break;
                    
                case 'QUICK_HELP':
                    await this.showHelp(senderId);
                    break;
                    
                case 'QUICK_SIGNALER':
                    await this.handleReport(senderId);
                    break;
                    
                case 'QUICK_PSEUDO':
                    await this.showPseudoInstructions(senderId);
                    break;
                
                // 🆕 NOUVEAUX QUICK REPLIES
                case 'QUICK_FAVORIS':
                    await this.showFavorites(senderId);
                    break;
                    
                case 'QUICK_HISTORIQUE':
                    await this.showHistory(senderId);
                    break;
                    
                case 'QUICK_BADGES':
                    await this.showBadges(senderId);
                    break;
                    
                case 'QUICK_ADD_FAV':
                    await this.addCurrentPartnerToFavorites(senderId);
                    break;
                
                // THÈMES DE DISCUSSION
                case 'THEME_SPORT':
                    await this.chatManager.addToQueue(senderId, { theme: 'sport' });
                    break;
                case 'THEME_MUSIC':
                    await this.chatManager.addToQueue(senderId, { theme: 'musique' });
                    break;
                case 'THEME_GAMING':
                    await this.chatManager.addToQueue(senderId, { theme: 'gaming' });
                    break;
                case 'THEME_CULTURE':
                    await this.chatManager.addToQueue(senderId, { theme: 'culture' });
                    break;
                case 'THEME_VOYAGE':
                    await this.chatManager.addToQueue(senderId, { theme: 'voyage' });
                    break;
                case 'THEME_TECH':
                    await this.chatManager.addToQueue(senderId, { theme: 'tech' });
                    break;
                case 'THEME_ART':
                    await this.chatManager.addToQueue(senderId, { theme: 'art' });
                    break;
                case 'THEME_RANDOM':
                    await this.chatManager.addToQueue(senderId, { theme: 'aléatoire' });
                    break;
                    
                // FEEDBACK POST-CONVERSATION
                case 'FEEDBACK_EXCELLENT':
                    await this.submitFeedback(senderId, 'excellent');
                    break;
                case 'FEEDBACK_GOOD':
                    await this.submitFeedback(senderId, 'good');
                    break;
                case 'FEEDBACK_AVERAGE':
                    await this.submitFeedback(senderId, 'average');
                    break;
                case 'FEEDBACK_BAD':
                    await this.submitFeedback(senderId, 'bad');
                    break;
                    
                default:
                    console.log(`Payload non géré: ${payload}`);
                    await this.showHelp(senderId);
                    break;
            }
        } catch (error) {
            console.error('Erreur traitement Quick Reply:', error);
        }
    }

    // Instructions pour changer de pseudo
    async showPseudoInstructions(senderId) {
        const message = 
            "✏️ CHANGER DE PSEUDO\n" +
            "━━━━━━━━━━━━━━━━━━\n\n" +
            "Pour changer votre pseudo, tapez :\n" +
            "/pseudo VotreNouveauNom\n\n" +
            "Exemples :\n" +
            "• /pseudo SuperChat123\n" +
            "• /pseudo DragonBleu\n" +
            "• /pseudo Mystique_42\n\n" +
            "Règles :\n" +
            "• 3 à 20 caractères\n" +
            "• Lettres, chiffres et _ uniquement";

        await this.fb.sendTextMessage(senderId, message);
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
                    await this.showThemeSelection(senderId);
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
                
                // 🆕 NOUVELLES COMMANDES
                case '/favoris':
                case '/favorites':
                    await this.showFavorites(senderId);
                    break;
                    
                case '/historique':
                case '/history':
                    await this.showHistory(senderId);
                    break;
                    
                case '/reconnect':
                case '/reconnecter':
                    const targetNumber = parts[1];
                    await this.requestReconnect(senderId, targetNumber);
                    break;
                    
                case '/badges':
                    await this.showBadges(senderId);
                    break;
                    
                case '/themes':
                case '/thèmes':
                    await this.showThemeSelection(senderId);
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

    // Message de bienvenue avec Quick Replies
    async sendWelcomeMessageWithPseudo(senderId, pseudo) {
        const welcomeMessage = 
            "🎭 Bienvenue sur SpeakToStranger !\n" +
            "━━━━━━━━━━━━━━━━━━\n\n" +
            `✨ Votre pseudo : ${pseudo}\n\n` +
            "💡 Tapez /help pour les commandes\n" +
            "ou utilisez les boutons ci-dessous :";

        const quickReplies = [
            {
                content_type: 'text',
                title: '🔍 Chercher',
                payload: 'QUICK_CHERCHER'
            },
            {
                content_type: 'text',
                title: '✏️ Changer pseudo',
                payload: 'QUICK_PSEUDO'
            },
            {
                content_type: 'text',
                title: '👤 Mon profil',
                payload: 'QUICK_PROFIL'
            },
            {
                content_type: 'text',
                title: '❓ Aide',
                payload: 'QUICK_HELP'
            }
        ];

        await this.fb.sendQuickReply(senderId, welcomeMessage, quickReplies);
    }

    // Message de bienvenue normal avec Quick Replies
    async sendWelcomeMessage(senderId) {
        const user = await User.findOne({ facebookId: senderId });
        const pseudo = user?.pseudo || 'Anonyme';
        
        const welcomeMessage = 
            "🎭 Bienvenue sur SpeakToStranger !\n\n" +
            `Votre pseudo actuel : ${pseudo}\n\n` +
            "Je suis votre assistant pour vous connecter avec des inconnus.\n\n" +
            "Utilisez les commandes ou les boutons :";

        const quickReplies = [
            {
                content_type: 'text',
                title: '🔍 Chercher',
                payload: 'QUICK_CHERCHER'
            },
            {
                content_type: 'text',
                title: '👤 Profil',
                payload: 'QUICK_PROFIL'
            },
            {
                content_type: 'text',
                title: '📊 Stats',
                payload: 'QUICK_STATS'
            },
            {
                content_type: 'text',
                title: '❓ Aide',
                payload: 'QUICK_HELP'
            }
        ];

        await this.fb.sendQuickReply(senderId, welcomeMessage, quickReplies);
    }

    // Afficher l'aide avec Quick Replies dynamiques
    async showHelp(senderId) {
        const user = await User.findOne({ facebookId: senderId });
        const pseudo = user?.pseudo || 'Anonyme';
        
        // Vérifier le contexte de l'utilisateur
        const isInChat = this.chatManager.isInChat(senderId);
        const isInQueue = this.chatManager.isInQueue(senderId);
        
        let helpMessage = `👋 Bonjour ${pseudo} !\n\n`;
        let quickReplies = [];
        
        if (isInChat) {
            // En conversation
            helpMessage += 
                "🔴 Vous êtes en conversation\n\n" +
                "Commandes disponibles :\n" +
                "• /stop - Quitter la conversation\n" +
                "• /signaler - Signaler l'utilisateur\n" +
                "• /profil - Voir votre profil\n\n" +
                "Ou utilisez les boutons :";
            
            quickReplies = [
                {
                    content_type: 'text',
                    title: '🛑 Quitter',
                    payload: 'QUICK_STOP'
                },
                {
                    content_type: 'text',
                    title: '🚨 Signaler',
                    payload: 'QUICK_SIGNALER'
                },
                {
                    content_type: 'text',
                    title: '👤 Profil',
                    payload: 'QUICK_PROFIL'
                }
            ];
            
        } else if (isInQueue) {
            // En file d'attente
            helpMessage += 
                "⏳ Vous êtes en recherche...\n\n" +
                "• /stop - Annuler la recherche\n" +
                "• /profil - Voir votre profil\n\n" +
                "Ou utilisez les boutons :";
            
            quickReplies = [
                {
                    content_type: 'text',
                    title: '❌ Annuler',
                    payload: 'QUICK_STOP'
                },
                {
                    content_type: 'text',
                    title: '👤 Profil',
                    payload: 'QUICK_PROFIL'
                },
                {
                    content_type: 'text',
                    title: '📊 Stats',
                    payload: 'QUICK_STATS'
                }
            ];
            
        } else {
            // Menu principal
            helpMessage += 
                "📝 COMMANDES DISPONIBLES :\n" +
                "━━━━━━━━━━━━━━━━━━\n" +
                "🔍 CONVERSATION\n" +
                "• Chercher (ou /chercher)\n" +
                "• Themes (ou /themes)\n" +
                "• /stop - Quitter\n\n" +
                "⭐ FAVORIS & HISTORIQUE\n" +
                "• Favoris (ou /favoris)\n" +
                "• Historique (ou /historique)\n" +
                "• /reconnect [N]\n\n" +
                "👤 PROFIL\n" +
                "• Profil (ou /profil)\n" +
                "• Stats (ou /stats)\n" +
                "• Badges (ou /badges)\n" +
                "• /pseudo - Changer de nom\n\n" +
                "🛡️ SÉCURITÉ\n" +
                "• /signaler\n" +
                "• /feedback\n\n" +
                "💡 Tapez le mot-clé ou utilisez les boutons :";
            
            quickReplies = [
                {
                    content_type: 'text',
                    title: '🔍 Chercher',
                    payload: 'QUICK_CHERCHER'
                },
                {
                    content_type: 'text',
                    title: '⭐ Favoris',
                    payload: 'QUICK_FAVORIS'
                },
                {
                    content_type: 'text',
                    title: '📋 Historique',
                    payload: 'QUICK_HISTORIQUE'
                },
                {
                    content_type: 'text',
                    title: '🏆 Badges',
                    payload: 'QUICK_BADGES'
                }
            ];
        }

        await this.fb.sendQuickReply(senderId, helpMessage, quickReplies);
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
                
                const message = "✅ Recherche annulée.\n\nQue voulez-vous faire ?";
                const quickReplies = [
                    {
                        content_type: 'text',
                        title: '🔍 Nouvelle recherche',
                        payload: 'QUICK_CHERCHER'
                    },
                    {
                        content_type: 'text',
                        title: '👤 Mon profil',
                        payload: 'QUICK_PROFIL'
                    },
                    {
                        content_type: 'text',
                        title: '❓ Aide',
                        payload: 'QUICK_HELP'
                    }
                ];
                
                await this.fb.sendQuickReply(senderId, message, quickReplies);
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
                await this.showPseudoInstructions(senderId);
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

            const successMessage = 
                "✅ PSEUDO CHANGÉ AVEC SUCCÈS !\n" +
                "━━━━━━━━━━━━━━━━━━\n\n" +
                `Ancien : ${oldPseudo}\n` +
                `Nouveau : ${newPseudo}\n\n` +
                "Que voulez-vous faire ?";

            const quickReplies = [
                {
                    content_type: 'text',
                    title: '👤 Voir profil',
                    payload: 'QUICK_PROFIL'
                },
                {
                    content_type: 'text',
                    title: '🔍 Chercher',
                    payload: 'QUICK_CHERCHER'
                },
                {
                    content_type: 'text',
                    title: '❓ Aide',
                    payload: 'QUICK_HELP'
                }
            ];

            await this.fb.sendQuickReply(senderId, successMessage, quickReplies);

            console.log(`✅ Pseudo changé : ${oldPseudo} → ${newPseudo}`);

        } catch (error) {
            console.error('Erreur changement pseudo:', error);
            await this.fb.sendTextMessage(senderId,
                "❌ Erreur lors du changement de pseudo.\n\nRéessayez plus tard."
            );
        }
    }

    // Afficher le profil avec Quick Replies
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
                "Que voulez-vous faire ?";

            const quickReplies = [
                {
                    content_type: 'text',
                    title: '✏️ Changer pseudo',
                    payload: 'QUICK_PSEUDO'
                },
                {
                    content_type: 'text',
                    title: '📊 Mes stats',
                    payload: 'QUICK_STATS'
                },
                {
                    content_type: 'text',
                    title: '🔍 Chercher',
                    payload: 'QUICK_CHERCHER'
                },
                {
                    content_type: 'text',
                    title: '❓ Aide',
                    payload: 'QUICK_HELP'
                }
            ];

            await this.fb.sendQuickReply(senderId, profileMessage, quickReplies);

        } catch (error) {
            console.error('Erreur affichage profil:', error);
            await this.fb.sendTextMessage(senderId,
                "❌ Erreur lors de la récupération du profil."
            );
        }
    }

    // Afficher les stats utilisateur avec Quick Replies
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

            // 🆕 Calculer la durée moyenne
            const avgDuration = user.totalConversations > 0 
                ? Math.floor((user.totalChatDuration || 0) / user.totalConversations)
                : 0;

            const formatDuration = (secs) => {
                const hours = Math.floor(secs / 3600);
                const minutes = Math.floor((secs % 3600) / 60);
                if (hours > 0) return `${hours}h ${minutes}min`;
                if (minutes > 0) return `${minutes}min`;
                return `${secs}s`;
            };

            // 🆕 Afficher les étoiles du score
            const getStars = (score) => {
                if (score >= 90) return '⭐⭐⭐⭐⭐';
                if (score >= 75) return '⭐⭐⭐⭐';
                if (score >= 60) return '⭐⭐⭐';
                if (score >= 40) return '⭐⭐';
                return '⭐';
            };

            const statsMessage = 
                "📊 VOS STATISTIQUES\n" +
                "━━━━━━━━━━━━━━━━━━\n\n" +
                `📝 Pseudo: ${user.pseudo || 'Non défini'}\n` +
                `💬 Conversations: ${user.totalConversations || 0}\n` +
                `📨 Messages totaux: ${user.totalMessages || 0}\n` +
                `📅 Messages aujourd'hui: ${todayMessages}\n` +
                `⏱️ Temps moyen: ${formatDuration(avgDuration)}\n\n` +
                `🛡️ Score de respect: ${user.respectScore || 50}/100\n` +
                `${getStars(user.respectScore || 50)}\n\n` +
                `🌟 Avis positifs: ${user.positiveRatings || 0}\n` +
                `⚠️ Avis négatifs: ${user.negativeRatings || 0}\n` +
                `🏆 Badges: ${user.badges?.length || 0}\n` +
                `⭐ Favoris: ${user.favorites?.length || 0}\n\n` +
                `📅 Membre depuis: ${new Date(user.createdAt).toLocaleDateString('fr-FR')}\n\n` +
                "Continuez comme ça ! 🎉";

            const quickReplies = [
                {
                    content_type: 'text',
                    title: '🏆 Badges',
                    payload: 'QUICK_BADGES'
                },
                {
                    content_type: 'text',
                    title: '⭐ Favoris',
                    payload: 'QUICK_FAVORIS'
                },
                {
                    content_type: 'text',
                    title: '🔍 Chercher',
                    payload: 'QUICK_CHERCHER'
                },
                {
                    content_type: 'text',
                    title: '📋 Historique',
                    payload: 'QUICK_HISTORIQUE'
                }
            ];

            await this.fb.sendQuickReply(senderId, statsMessage, quickReplies);

        } catch (error) {
            console.error('Erreur stats utilisateur:', error);
            await this.fb.sendTextMessage(senderId,
                "❌ Erreur lors de la récupération des stats."
            );
        }
    }

    // Afficher les stats du bot avec Quick Replies
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
                "Que voulez-vous faire ?";

            const quickReplies = [
                {
                    content_type: 'text',
                    title: '🔍 Chercher',
                    payload: 'QUICK_CHERCHER'
                },
                {
                    content_type: 'text',
                    title: '👤 Mon profil',
                    payload: 'QUICK_PROFIL'
                },
                {
                    content_type: 'text',
                    title: '📊 Mes stats',
                    payload: 'QUICK_STATS'
                },
                {
                    content_type: 'text',
                    title: '❓ Aide',
                    payload: 'QUICK_HELP'
                }
            ];

            await this.fb.sendQuickReply(senderId, statsMessage, quickReplies);

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
            // Vérifier si l'utilisateur est en conversation
            if (!this.chatManager.isInChat(senderId)) {
                await this.fb.sendTextMessage(senderId,
                    "❌ Vous devez être en conversation pour signaler quelqu'un.\n\n" +
                    "Vous ne pouvez signaler qu'un utilisateur avec qui vous chattez actuellement."
                );
                return;
            }

            const chatInfo = this.chatManager.getChatInfo(senderId);
            
            if (!chatInfo || !chatInfo.partnerId) {
                await this.fb.sendTextMessage(senderId,
                    "❌ Erreur : impossible de récupérer les informations de la conversation."
                );
                return;
            }

            // Récupérer les informations des utilisateurs
            const reporter = await User.findOne({ facebookId: senderId });
            const reported = await User.findOne({ facebookId: chatInfo.partnerId });
            
            const reporterPseudo = reporter?.pseudo || 'Anonyme';
            const reportedPseudo = reported?.pseudo || 'Anonyme';

            // Créer le signalement
            const reportData = {
                reporterId: senderId,
                reportedUserId: chatInfo.partnerId,
                reportedBy: senderId,
                reportedUser: chatInfo.partnerId,
                chatId: chatInfo.chatId,
                reason: 'Comportement inapproprié',
                status: 'pending',
                timestamp: new Date(),
                createdAt: new Date()
            };

            console.log('📝 Tentative de création du signalement:', reportData);

            const report = await Report.create(reportData);
            
            console.log(`✅ Signalement créé avec succès: ${report._id}`);
            console.log(`   De: ${reporterPseudo} (${senderId})`);
            console.log(`   Contre: ${reportedPseudo} (${chatInfo.partnerId})`);

            // Mettre à jour le compteur de signalements
            await User.findOneAndUpdate(
                { facebookId: chatInfo.partnerId },
                { 
                    $inc: { reportCount: 1 },
                    $push: {
                        reports: {
                            reportedBy: senderId,
                            reporterPseudo: reporterPseudo,
                            reason: 'Comportement inapproprié',
                            date: new Date()
                        }
                    }
                }
            );

            // Vérifier si l'utilisateur doit être bloqué
            const reportedUser = await User.findOne({ facebookId: chatInfo.partnerId });
            
            if (reportedUser && reportedUser.reportCount >= 3) {
                console.log(`⚠️ Utilisateur ${reportedPseudo} auto-bloqué (${reportedUser.reportCount} signalements)`);
                
                await User.findOneAndUpdate(
                    { facebookId: chatInfo.partnerId },
                    { 
                        isBlocked: true,
                        blockedAt: new Date(),
                        blockReason: `Auto-bloqué : ${reportedUser.reportCount} signalements`
                    }
                );
                
                await this.fb.sendTextMessage(chatInfo.partnerId,
                    "🚫 COMPTE SUSPENDU\n" +
                    "━━━━━━━━━━━━━━━━━━\n\n" +
                    "Votre compte a été suspendu suite à plusieurs signalements.\n\n" +
                    "Cette décision est définitive."
                );
            }

            // Terminer la conversation
            await this.chatManager.endChat(senderId, 'reported');

            // Message de confirmation avec Quick Replies
            const confirmMessage = 
                "✅ SIGNALEMENT ENREGISTRÉ\n" +
                "━━━━━━━━━━━━━━━━━━\n\n" +
                "Merci d'avoir signalé ce comportement.\n" +
                "Notre équipe va examiner cette conversation.\n\n" +
                "La conversation a été terminée pour votre sécurité.\n\n" +
                "Que voulez-vous faire ?";

            const quickReplies = [
                {
                    content_type: 'text',
                    title: '🔍 Nouvelle recherche',
                    payload: 'QUICK_CHERCHER'
                },
                {
                    content_type: 'text',
                    title: '👤 Mon profil',
                    payload: 'QUICK_PROFIL'
                },
                {
                    content_type: 'text',
                    title: '❓ Aide',
                    payload: 'QUICK_HELP'
                }
            ];

            await this.fb.sendQuickReply(senderId, confirmMessage, quickReplies);

            // Message neutre pour la personne signalée
            await this.fb.sendTextMessage(chatInfo.partnerId,
                "🔚 Conversation terminée.\n" +
                "━━━━━━━━━━━━━━━━━━\n\n" +
                "Votre partenaire a quitté la conversation.\n\n" +
                "Tapez /chercher pour trouver un nouveau partenaire."
            );

            console.log(`⚠️ SIGNALEMENT:`);
            console.log(`   • Rapporteur: ${reporterPseudo} (${senderId})`);
            console.log(`   • Signalé: ${reportedPseudo} (${chatInfo.partnerId})`);
            console.log(`   • Chat ID: ${chatInfo.chatId}`);
            console.log(`   • Nombre de signalements du signalé: ${reportedUser?.reportCount || 1}`);

        } catch (error) {
            console.error('❌ Erreur complète signalement:', error);
            console.error('Stack:', error.stack);
            
            await this.fb.sendTextMessage(senderId,
                "❌ Une erreur s'est produite lors du signalement.\n\n" +
                "La conversation va être terminée par sécurité.\n\n" +
                "Si le problème persiste, contactez le support."
            );
            
            try {
                if (this.chatManager.isInChat(senderId)) {
                    await this.chatManager.endChat(senderId, 'error');
                }
            } catch (endError) {
                console.error('Erreur lors de la fin de conversation:', endError);
            }
        }
    }

    // Gérer les feedbacks
    async handleFeedback(senderId, feedbackText) {
        try {
            if (!feedbackText || feedbackText.trim() === '') {
                await this.fb.sendTextMessage(senderId,
                    "❌ Format incorrect !\n\n" +
                    "Utilisation : /feedback Votre message\n\n" +
                    "Exemples :\n" +
                    "• /feedback J'adore ce bot !\n" +
                    "• /feedback Bug: impossible d'envoyer des photos\n" +
                    "• /feedback Suggestion: ajouter des salons thématiques"
                );
                return;
            }

            const user = await User.findOne({ facebookId: senderId });
            const userPseudo = user?.pseudo || 'Anonyme';

            let feedbackType = 'other';
            const lowerText = feedbackText.toLowerCase();
            
            if (lowerText.includes('bug') || lowerText.includes('erreur') || lowerText.includes('probleme')) {
                feedbackType = 'bug';
            } else if (lowerText.includes('suggestion') || lowerText.includes('idee') || lowerText.includes('proposer')) {
                feedbackType = 'suggestion';
            } else if (lowerText.includes('merci') || lowerText.includes('super') || lowerText.includes('génial')) {
                feedbackType = 'compliment';
            } else if (lowerText.includes('nul') || lowerText.includes('mauvais') || lowerText.includes('problème')) {
                feedbackType = 'complaint';
            }

            const { Feedback } = require('../models');
            const feedback = await Feedback.create({
                userId: senderId,
                userPseudo: userPseudo,
                message: feedbackText,
                type: feedbackType,
                status: 'pending',
                timestamp: new Date()
            });

            console.log(`📝 Nouveau feedback (${feedbackType}) de ${userPseudo}: ${feedbackText}`);

            let confirmMessage = "✅ Merci pour votre feedback !\n\n";
            
            switch(feedbackType) {
                case 'bug':
                    confirmMessage += "🐛 Nous avons bien reçu votre rapport de bug.\n" +
                                    "Notre équipe technique va l'examiner rapidement.";
                    break;
                case 'suggestion':
                    confirmMessage += "💡 Votre suggestion a été enregistrée.\n" +
                                    "Nous étudions toutes les idées pour améliorer le bot !";
                    break;
                case 'compliment':
                    confirmMessage += "❤️ Merci beaucoup pour vos encouragements !\n" +
                                    "Ça nous motive à continuer d'améliorer le service.";
                    break;
                case 'complaint':
                    confirmMessage += "😔 Nous sommes désolés que vous ayez eu une mauvaise expérience.\n" +
                                    "Nous allons examiner votre retour pour nous améliorer.";
                    break;
                default:
                    confirmMessage += "Votre message a été transmis à l'équipe.\n" +
                                    "Nous apprécions votre contribution !";
            }

            confirmMessage += "\n\n💙 L'équipe SpeakToStranger";

            await this.fb.sendTextMessage(senderId, confirmMessage);

        } catch (error) {
            console.error('Erreur feedback:', error);
            await this.fb.sendTextMessage(senderId,
                "❌ Erreur lors de l'envoi du feedback.\n\n" +
                "Veuillez réessayer plus tard."
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

    // ========================================
    // 🆕 NOUVELLES FONCTIONNALITÉS
    // ========================================

    // Afficher la sélection de thème
    async showThemeSelection(senderId) {
        const message = {
            text: "🎪 CHOISISSEZ UN THÈME DE DISCUSSION\n━━━━━━━━━━━━━━━━━━\n\n" +
                  "Sélectionnez un sujet qui vous intéresse :\n\n" +
                  "⚽ Sport\n" +
                  "🎵 Musique\n" +
                  "🎮 Gaming\n" +
                  "📚 Culture\n" +
                  "🌍 Voyage\n" +
                  "💡 Tech\n" +
                  "🎨 Art\n" +
                  "🔀 Aléatoire\n\n" +
                  "💡 Tapez simplement le nom du thème (ex: Sport)",
            quick_replies: [
                { content_type: "text", title: "⚽ Sport", payload: "THEME_SPORT" },
                { content_type: "text", title: "🎵 Musique", payload: "THEME_MUSIC" },
                { content_type: "text", title: "🎮 Gaming", payload: "THEME_GAMING" },
                { content_type: "text", title: "📚 Culture", payload: "THEME_CULTURE" },
                { content_type: "text", title: "🌍 Voyage", payload: "THEME_VOYAGE" },
                { content_type: "text", title: "💡 Tech", payload: "THEME_TECH" },
                { content_type: "text", title: "🎨 Art", payload: "THEME_ART" },
                { content_type: "text", title: "🔀 Aléatoire", payload: "THEME_RANDOM" }
            ]
        };
        
        await this.fb.sendQuickReplies(senderId, message);
    }

    // Afficher les favoris
    async showFavorites(senderId) {
        try {
            const user = await User.findOne({ facebookId: senderId });
            
            if (!user || !user.favorites || user.favorites.length === 0) {
                const message = {
                    text: "⭐ FAVORIS\n━━━━━━━━━━━━━━━━━━\n\n" +
                          "Vous n'avez pas encore de favoris.\n\n" +
                          "Ajoutez quelqu'un en fin de conversation !\n\n" +
                          "💡 Tapez: Chercher ou Historique",
                    quick_replies: [
                        { content_type: "text", title: "🔍 Chercher", payload: "QUICK_CHERCHER" },
                        { content_type: "text", title: "📋 Historique", payload: "QUICK_HISTORIQUE" }
                    ]
                };
                await this.fb.sendQuickReplies(senderId, message);
                return;
            }

            let favText = "⭐ VOS FAVORIS\n━━━━━━━━━━━━━━━━━━\n\n";
            
            user.favorites.slice(0, 10).forEach((fav, index) => {
                const date = new Date(fav.addedAt).toLocaleDateString('fr-FR');
                favText += `${index + 1}. ${fav.pseudo}\n   Ajouté le ${date}\n\n`;
            });
            
            favText += "Pour reconnecter:\n/reconnect [numéro]\n\n" +
                       "Exemple: /reconnect 1\n\n" +
                       "💡 Ou tapez: Chercher, Historique";

            const message = {
                text: favText,
                quick_replies: [
                    { content_type: "text", title: "🔍 Chercher", payload: "QUICK_CHERCHER" },
                    { content_type: "text", title: "📋 Historique", payload: "QUICK_HISTORIQUE" }
                ]
            };
            
            await this.fb.sendQuickReplies(senderId, message);
            
        } catch (error) {
            console.error('Erreur affichage favoris:', error);
            await this.fb.sendTextMessage(senderId, "❌ Erreur lors de l'affichage des favoris.");
        }
    }

    // Afficher l'historique
    async showHistory(senderId) {
        try {
            const user = await User.findOne({ facebookId: senderId });
            
            if (!user || !user.conversationHistory || user.conversationHistory.length === 0) {
                const message = {
                    text: "📋 HISTORIQUE\n━━━━━━━━━━━━━━━━━━\n\n" +
                          "Aucune conversation pour le moment.\n\n" +
                          "Commencez à discuter !\n\n" +
                          "💡 Tapez: Chercher ou Favoris",
                    quick_replies: [
                        { content_type: "text", title: "🔍 Chercher", payload: "QUICK_CHERCHER" },
                        { content_type: "text", title: "⭐ Favoris", payload: "QUICK_FAVORIS" }
                    ]
                };
                await this.fb.sendQuickReplies(senderId, message);
                return;
            }

            let historyText = "📋 DERNIÈRES CONVERSATIONS\n━━━━━━━━━━━━━━━━━━\n\n";
            
            const recentChats = user.conversationHistory.slice(-10).reverse();
            
            recentChats.forEach((chat, index) => {
                const duration = chat.duration ? this.formatDuration(chat.duration) : '?';
                const timeAgo = this.getTimeAgo(chat.endedAt);
                const isFavorite = user.favorites?.some(f => f.userId === chat.partnerId);
                
                historyText += `${index + 1}. ${chat.partnerPseudo} ${isFavorite ? '⭐' : ''}\n`;
                historyText += `   ${timeAgo} • ${duration}\n`;
                historyText += `   ${chat.messageCount || 0} messages\n\n`;
            });
            
            historyText += "Pour reconnecter:\n/reconnect [numéro]\n\n" +
                           "💡 Ou tapez: Chercher, Favoris";

            const message = {
                text: historyText,
                quick_replies: [
                    { content_type: "text", title: "🔍 Chercher", payload: "QUICK_CHERCHER" },
                    { content_type: "text", title: "⭐ Favoris", payload: "QUICK_FAVORIS" }
                ]
            };
            
            await this.fb.sendQuickReplies(senderId, message);
            
        } catch (error) {
            console.error('Erreur affichage historique:', error);
            await this.fb.sendTextMessage(senderId, "❌ Erreur lors de l'affichage de l'historique.");
        }
    }

    // Afficher les badges
    async showBadges(senderId) {
        try {
            const user = await User.findOne({ facebookId: senderId });
            
            if (!user) return;

            let badgeText = "🏆 VOS BADGES\n━━━━━━━━━━━━━━━━━━\n\n";
            
            // Calculer les badges
            const badges = [];
            
            if (user.totalConversations >= 10 && user.respectScore >= 80) {
                badges.push("🛡️ Utilisateur Vérifié");
            }
            if (user.totalConversations >= 50) {
                badges.push("💬 Grand Discuteur");
            }
            if (user.positiveRatings >= 20) {
                badges.push("⭐ Populaire");
            }
            if (user.respectScore >= 95) {
                badges.push("👑 Respect Maximum");
            }
            if (user.totalConversations >= 100) {
                badges.push("🎖️ Vétéran");
            }
            
            if (badges.length > 0) {
                badges.forEach(badge => {
                    badgeText += `${badge}\n`;
                });
            } else {
                badgeText += "Aucun badge pour le moment.\n\n";
                badgeText += "🎯 Objectifs:\n";
                badgeText += "• 🛡️ Vérifié: 10 conv. + 80% respect\n";
                badgeText += "• 💬 Grand Discuteur: 50 conversations\n";
                badgeText += "• ⭐ Populaire: 20 avis positifs\n";
            }
            
            badgeText += `\n📊 Score de respect: ${user.respectScore || 0}/100`;
            badgeText += `\n🌟 Avis positifs: ${user.positiveRatings || 0}`;
            badgeText += `\n\n💡 Tapez: Stats ou Chercher`;

            const message = {
                text: badgeText,
                quick_replies: [
                    { content_type: "text", title: "📊 Stats", payload: "QUICK_STATS" },
                    { content_type: "text", title: "🔍 Chercher", payload: "QUICK_CHERCHER" }
                ]
            };
            
            await this.fb.sendQuickReplies(senderId, message);
            
        } catch (error) {
            console.error('Erreur affichage badges:', error);
            await this.fb.sendTextMessage(senderId, "❌ Erreur lors de l'affichage des badges.");
        }
    }

    // Demander une reconnexion
    async requestReconnect(senderId, targetNumber) {
        try {
            const user = await User.findOne({ facebookId: senderId });
            
            if (!user) return;

            if (!targetNumber) {
                await this.fb.sendTextMessage(senderId, 
                    "❌ Format incorrect !\n\n" +
                    "Utilisez: /reconnect [numéro]\n" +
                    "Exemple: /reconnect 1\n\n" +
                    "Consultez /historique ou /favoris pour voir les numéros."
                );
                return;
            }

            const index = parseInt(targetNumber) - 1;
            
            // Chercher d'abord dans les favoris
            let targetUser = null;
            if (user.favorites && user.favorites[index]) {
                targetUser = user.favorites[index];
            } 
            // Sinon chercher dans l'historique
            else if (user.conversationHistory && user.conversationHistory.length > 0) {
                const recentChats = user.conversationHistory.slice(-10).reverse();
                if (recentChats[index]) {
                    targetUser = {
                        userId: recentChats[index].partnerId,
                        pseudo: recentChats[index].partnerPseudo
                    };
                }
            }

            if (!targetUser) {
                await this.fb.sendTextMessage(senderId,
                    "❌ Numéro invalide.\n\n" +
                    "Vérifiez /favoris ou /historique."
                );
                return;
            }

            // Vérifier si l'utilisateur cible existe et n'est pas bloqué
            const targetUserDoc = await User.findOne({ facebookId: targetUser.userId });
            
            if (!targetUserDoc || targetUserDoc.isBlocked) {
                await this.fb.sendTextMessage(senderId,
                    "❌ Cet utilisateur n'est plus disponible."
                );
                return;
            }

            // Ajouter la demande de reconnexion
            await User.findOneAndUpdate(
                { facebookId: senderId },
                {
                    $push: {
                        reconnectRequests: {
                            targetUserId: targetUser.userId,
                            requestedAt: new Date(),
                            status: 'pending'
                        }
                    }
                }
            );

            // Notifier l'autre utilisateur
            const message = {
                text: `💌 DEMANDE DE RECONNEXION\n━━━━━━━━━━━━━━━━━━\n\n${user.pseudo} souhaite discuter à nouveau avec vous !\n\nVoulez-vous accepter ?`,
                quick_replies: [
                    { content_type: "text", title: "✅ Accepter", payload: `RECONNECT_ACCEPT_${senderId}` },
                    { content_type: "text", title: "❌ Refuser", payload: `RECONNECT_DECLINE_${senderId}` }
                ]
            };
            
            await this.fb.sendQuickReplies(targetUser.userId, message);
            
            await this.fb.sendTextMessage(senderId,
                "💌 Demande envoyée !\n\n" +
                `${targetUser.pseudo} recevra votre demande.\n\n` +
                "Vous serez notifié de sa réponse."
            );
            
        } catch (error) {
            console.error('Erreur demande reconnexion:', error);
            await this.fb.sendTextMessage(senderId, "❌ Erreur lors de la demande.");
        }
    }

    // Ajouter le partenaire actuel aux favoris
    async addCurrentPartnerToFavorites(senderId) {
        try {
            const chatInfo = this.chatManager.activeChats.get(senderId);
            
            if (!chatInfo) {
                await this.fb.sendTextMessage(senderId,
                    "❌ Vous n'êtes pas en conversation.\n\n" +
                    "Vous pourrez ajouter quelqu'un en fin de conversation."
                );
                return;
            }

            const partnerUser = await User.findOne({ facebookId: chatInfo.partnerId });
            
            await User.findOneAndUpdate(
                { facebookId: senderId },
                {
                    $addToSet: {
                        favorites: {
                            userId: chatInfo.partnerId,
                            pseudo: partnerUser?.pseudo || chatInfo.partnerPseudo,
                            addedAt: new Date()
                        }
                    }
                }
            );

            await this.fb.sendTextMessage(senderId,
                `⭐ ${chatInfo.partnerPseudo} ajouté aux favoris !\n\n` +
                "Vous pourrez demander une reconnexion plus tard avec /favoris"
            );
            
        } catch (error) {
            console.error('Erreur ajout favoris:', error);
            await this.fb.sendTextMessage(senderId, "❌ Erreur lors de l'ajout aux favoris.");
        }
    }

    // Soumettre un feedback post-conversation
    async submitFeedback(senderId, rating) {
        try {
            const user = await User.findOne({ facebookId: senderId });
            
            if (!user || !user.conversationHistory || user.conversationHistory.length === 0) {
                await this.fb.sendTextMessage(senderId, "❌ Aucune conversation récente à évaluer.");
                return;
            }

            // Récupérer la dernière conversation
            const lastChat = user.conversationHistory[user.conversationHistory.length - 1];
            
            if (!lastChat.chatId) {
                await this.fb.sendTextMessage(senderId, "❌ Erreur: conversation introuvable.");
                return;
            }

            // Enregistrer le feedback
            await Chat.findByIdAndUpdate(lastChat.chatId, {
                $push: {
                    feedbacks: {
                        userId: senderId,
                        rating: rating,
                        submittedAt: new Date()
                    }
                }
            });

            // Mettre à jour le score de respect du partenaire
            const partnerUser = await User.findOne({ facebookId: lastChat.partnerId });
            
            if (partnerUser) {
                let scoreChange = 0;
                if (rating === 'excellent') {
                    scoreChange = 5;
                    partnerUser.positiveRatings = (partnerUser.positiveRatings || 0) + 1;
                } else if (rating === 'good') {
                    scoreChange = 2;
                    partnerUser.positiveRatings = (partnerUser.positiveRatings || 0) + 1;
                } else if (rating === 'average') {
                    scoreChange = 0;
                } else if (rating === 'bad') {
                    scoreChange = -5;
                    partnerUser.negativeRatings = (partnerUser.negativeRatings || 0) + 1;
                }

                partnerUser.respectScore = Math.max(0, Math.min(100, (partnerUser.respectScore || 50) + scoreChange));
                await partnerUser.save();

                // Vérifier si le partenaire mérite un nouveau badge
                await this.checkAndAwardBadges(partnerUser);
            }

            const feedbackEmoji = {
                'excellent': '😄',
                'good': '🙂',
                'average': '😐',
                'bad': '😕'
            };

            const message = {
                text: `${feedbackEmoji[rating]} Merci pour votre avis !\n\nVotre feedback nous aide à améliorer l'expérience pour tous.`,
                quick_replies: [
                    { content_type: "text", title: "🔍 Nouvelle conversation", payload: "QUICK_CHERCHER" },
                    { content_type: "text", title: "📊 Mes stats", payload: "QUICK_STATS" }
                ]
            };
            
            await this.fb.sendQuickReplies(senderId, message);
            
        } catch (error) {
            console.error('Erreur soumission feedback:', error);
            await this.fb.sendTextMessage(senderId, "❌ Erreur lors de l'enregistrement du feedback.");
        }
    }

    // Vérifier et attribuer des badges
    async checkAndAwardBadges(user) {
        try {
            const newBadges = [];
            
            // Badge Utilisateur Vérifié
            if (user.totalConversations >= 10 && user.respectScore >= 80) {
                const hasBadge = user.badges?.some(b => b.name === 'Vérifié');
                if (!hasBadge) {
                    newBadges.push({ name: 'Vérifié', icon: '🛡️' });
                }
            }
            
            // Badge Grand Discuteur
            if (user.totalConversations >= 50) {
                const hasBadge = user.badges?.some(b => b.name === 'Grand Discuteur');
                if (!hasBadge) {
                    newBadges.push({ name: 'Grand Discuteur', icon: '💬' });
                }
            }
            
            // Badge Populaire
            if (user.positiveRatings >= 20) {
                const hasBadge = user.badges?.some(b => b.name === 'Populaire');
                if (!hasBadge) {
                    newBadges.push({ name: 'Populaire', icon: '⭐' });
                }
            }
            
            // Ajouter les nouveaux badges
            if (newBadges.length > 0) {
                await User.findByIdAndUpdate(user._id, {
                    $push: { badges: { $each: newBadges } }
                });
                
                // Notifier l'utilisateur
                for (const badge of newBadges) {
                    await this.fb.sendTextMessage(user.facebookId,
                        `🎉 NOUVEAU BADGE DÉBLOQUÉ !\n━━━━━━━━━━━━━━━━━━\n\n${badge.icon} ${badge.name}\n\nFélicitations !`
                    );
                }
            }
            
        } catch (error) {
            console.error('Erreur vérification badges:', error);
        }
    }

    // Formater la durée
    formatDuration(seconds) {
        if (!seconds) return '0s';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        if (hours > 0) {
            return `${hours}h ${minutes}min`;
        } else if (minutes > 0) {
            return `${minutes}min ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    // Calculer le temps écoulé
    getTimeAgo(date) {
        const now = new Date();
        const diff = now - new Date(date);
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `il y a ${days}j`;
        if (hours > 0) return `il y a ${hours}h`;
        if (minutes > 0) return `il y a ${minutes}min`;
        return 'à l\'instant';
    }
}

module.exports = MessageHandler;
