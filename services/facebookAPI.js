// ========================================
// FONCTIONS D'ENVOI DE MESSAGES FACEBOOK (CORRIGÉES)
// ========================================

const fetch = require('node-fetch');

// Fonction pour envoyer un message via l'API Facebook
async function sendMessageToUser(userId, message) {
    const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
    
    try {
        const response = await fetch(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recipient: { id: userId },
                message: { text: message }
            })
        });
        
        const data = await response.json();
        
        if (data.error) {
            console.error('Erreur Facebook API:', data.error);
            return { success: false, error: data.error.message };
        }
        
        return { success: true, messageId: data.message_id };
    } catch (error) {
        console.error('Erreur envoi message:', error);
        return { success: false, error: error.message };
    }
}

// Route pour envoyer un avertissement à un utilisateur
app.post('/admin/user/:userId/warn', async (req, res) => {
    try {
        const { userId } = req.params;
        const { reason } = req.body;
        
        // Message d'avertissement personnalisé
        let warningMessage = '⚠️ AVERTISSEMENT ADMINISTRATEUR ⚠️\n\n';
        warningMessage += 'Bonjour,\n\n';
        warningMessage += 'Vous avez reçu un avertissement de la part de l\'équipe de modération de SpeakToStranger.\n\n';
        
        if (reason) {
            warningMessage += `Raison: ${reason}\n\n`;
        } else {
            warningMessage += 'Votre comportement ne respecte pas nos règles communautaires.\n\n';
        }
        
        warningMessage += 'Merci de respecter les règles suivantes :\n';
        warningMessage += '• Restez respectueux envers les autres utilisateurs\n';
        warningMessage += '• Pas de contenu inapproprié ou offensant\n';
        warningMessage += '• Pas de harcèlement ou spam\n';
        warningMessage += '• Pas de partage d\'informations personnelles\n\n';
        warningMessage += 'En cas de récidive, votre compte pourrait être suspendu définitivement.\n\n';
        warningMessage += 'Cordialement,\n';
        warningMessage += 'L\'équipe SpeakToStranger 🎭';

        // Envoyer le message via Facebook
        const result = await sendMessageToUser(userId, warningMessage);
        
        // Enregistrer l'avertissement dans la base de données
        if (result.success) {
            const { User } = require('./models');
            await User.findOneAndUpdate(
                { facebookId: userId },
                { 
                    $push: { 
                        warnings: {
                            date: new Date(),
                            reason: reason || 'Comportement inapproprié',
                            sentBy: 'admin'
                        }
                    },
                    $inc: { warningCount: 1 }
                }
            );
        }
        
        res.json(result);
    } catch (error) {
        console.error('Erreur avertissement:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route pour bloquer un utilisateur avec notification
app.post('/admin/user/:userId/block', async (req, res) => {
    try {
        const { userId } = req.params;
        const { reason } = req.body;
        
        // Message de blocage
        let blockMessage = '🚫 COMPTE SUSPENDU 🚫\n\n';
        blockMessage += 'Votre compte a été suspendu de SpeakToStranger.\n\n';
        
        if (reason) {
            blockMessage += `Raison: ${reason}\n\n`;
        } else {
            blockMessage += 'Violation grave des conditions d\'utilisation.\n\n';
        }
        
        blockMessage += 'Cette décision est définitive.\n\n';
        blockMessage += 'Si vous pensez qu\'il s\'agit d\'une erreur, contactez le support.\n\n';
        blockMessage += 'L\'équipe SpeakToStranger';

        // Envoyer le message
        await sendMessageToUser(userId, blockMessage);
        
        // Bloquer dans la base de données
        const { User } = require('./models');
        await User.findOneAndUpdate(
            { facebookId: userId },
            { 
                isBlocked: true,
                blockedAt: new Date(),
                blockReason: reason || 'Violation des conditions d\'utilisation'
            }
        );
        
        res.json({ success: true, message: 'Utilisateur bloqué et notifié' });
    } catch (error) {
        console.error('Erreur blocage:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route pour envoyer un message personnalisé
app.post('/admin/user/:userId/message', async (req, res) => {
    try {
        const { userId } = req.params;
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, error: 'Message requis' });
        }
        
        let customMessage = '📢 MESSAGE DE L\'ADMINISTRATION\n\n';
        customMessage += message + '\n\n';
        customMessage += 'L\'équipe SpeakToStranger 🎭';
        
        const result = await sendMessageToUser(userId, customMessage);
        res.json(result);
    } catch (error) {
        console.error('Erreur envoi message:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route pour résoudre un signalement avec action
app.post('/admin/report/:reportId/resolve', async (req, res) => {
    try {
        const { reportId } = req.params;
        const { action, userId, reason } = req.body;
        
        const { Report } = require('./models');
        
        // Marquer le signalement comme résolu
        await Report.findByIdAndUpdate(reportId, {
            status: 'resolved',
            resolvedAt: new Date(),
            resolvedAction: action,
            resolvedBy: 'admin'
        });
        
        // Effectuer l'action choisie
        if (action === 'warn' && userId) {
            let warnMsg = '⚠️ Vous avez reçu un avertissement suite à un signalement.\n\n';
            warnMsg += reason || 'Merci de respecter les règles de la communauté.';
            warnMsg += '\n\nL\'équipe SpeakToStranger';
            
            await sendMessageToUser(userId, warnMsg);
            
        } else if (action === 'block' && userId) {
            let blockMsg = '🚫 Votre compte a été suspendu suite à des signalements répétés.\n\n';
            blockMsg += reason || 'Violation des conditions d\'utilisation.';
            blockMsg += '\n\nL\'équipe SpeakToStranger';
            
            await sendMessageToUser(userId, blockMsg);
            
            // Bloquer l'utilisateur
            const { User } = require('./models');
            await User.findOneAndUpdate(
                { facebookId: userId },
                { isBlocked: true, blockedAt: new Date() }
            );
        }
        
        res.json({ success: true, message: 'Signalement résolu' });
    } catch (error) {
        console.error('Erreur résolution signalement:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
