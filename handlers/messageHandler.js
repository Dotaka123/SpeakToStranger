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
                    await this.chatManager.addToQueue(senderId);
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
                "• /chercher - Trouver quelqu'un\n" +
                "• /profil - Voir votre profil\n" +
                "• /stats - Vos statistiques\n" +
                "• /infos - Stats du bot\n" +
                "• /pseudo - Changer de nom\n\n" +
                "Utilisez les commandes ou les boutons :";
            
            quickReplies = [
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
                    title: '📈 Infos Bot',
                    payload: 'QUICK_INFOS'
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

            const statsMessage = 
                "📊 VOS STATISTIQUES\n" +
                "━━━━━━━━━━━━━━━━━━\n\n" +
                `📝 Pseudo : ${user.pseudo || 'Non défini'}\n` +
                `💬 Conversations : ${user.totalConversations || 0}\n` +
                `📨 Messages totaux : ${user.totalMessages || 0}\n` +
                `📅 Messages aujourd'hui : ${todayMessages}\n` +
                `⚠️ Signalements : ${user.reportCount || 0}\n` +
                `📅 Membre depuis : ${new Date(user.createdAt).toLocaleDateString('fr-FR')}\n\n` +
                "Actions rapides :";

            const quickReplies = [
                {
                    content_type: 'text',
                    title: '👤 Profil',
                    payload: 'QUICK_PROFIL'
                },
                {
                    content_type: 'text',
                    title: '🔍 Chercher',
                    payload: 'QUICK_CHERCHER'
                },
                {
                    content_type: 'text',
                    title: '📈 Stats Bot',
                    payload: 'QUICK_INFOS'
                },
                {
                    content_type: 'text',
                    title: '❓ Aide',
                    payload: 'QUICK_HELP'
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
}

module.exports = MessageHandler;
