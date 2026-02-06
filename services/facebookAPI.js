// services/facebookAPI.js
const fetch = require('node-fetch');

class FacebookAPI {
    constructor() {
        this.PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
        this.VERIFY_TOKEN = process.env.VERIFY_TOKEN;
        this.API_URL = 'https://graph.facebook.com/v18.0';
    }

    // AJOUTEZ CETTE MÉTHODE ICI (après le constructor)
    async callSendAPI(messageData) {
        try {
            const response = await fetch(`${this.API_URL}/me/messages?access_token=${this.PAGE_ACCESS_TOKEN}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(messageData)
            });

            const data = await response.json();
            
            if (data.error) {
                console.error('Erreur Facebook API:', data.error);
                throw new Error(data.error.message);
            }
            
            return data;
        } catch (error) {
            console.error('Erreur envoi message:', error);
            throw error;
        }
    }

    // Envoyer une image
    async sendImageMessage(recipientId, imageUrl) {
        const messageData = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: 'image',
                    payload: {
                        url: imageUrl,
                        is_reusable: true
                    }
                }
            }
        };
        return this.callSendAPI(messageData);
    }

    // Envoyer une vidéo
    async sendVideoMessage(recipientId, videoUrl) {
        const messageData = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: 'video',
                    payload: {
                        url: videoUrl,
                        is_reusable: true
                    }
                }
            }
        };
        return this.callSendAPI(messageData);
    }

    // Envoyer un audio
    async sendAudioMessage(recipientId, audioUrl) {
        const messageData = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: 'audio',
                    payload: {
                        url: audioUrl,
                        is_reusable: true
                    }
                }
            }
        };
        return this.callSendAPI(messageData);
    }

    // Envoyer un fichier
    async sendFileMessage(recipientId, fileUrl) {
        const messageData = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: 'file',
                    payload: {
                        url: fileUrl,
                        is_reusable: true
                    }
                }
            }
        };
        return this.callSendAPI(messageData);
    }

    // Envoyer une localisation
    async sendLocationMessage(recipientId, lat, long) {
        const messageData = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: 'template',
                    payload: {
                        template_type: 'generic',
                        elements: [{
                            title: '📍 Localisation partagée',
                            subtitle: `Coordonnées: ${lat}, ${long}`,
                            image_url: `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${long}&zoom=15&size=300x300&markers=${lat},${long}`
                        }]
                    }
                }
            }
        };
        return this.callSendAPI(messageData);
    }

    // Envoyer un sticker
    async sendStickerMessage(recipientId, stickerId) {
        const messageData = {
            recipient: { id: recipientId },
            message: {
                sticker_id: stickerId
            }
        };
        return this.callSendAPI(messageData);
    }

    // Envoyer un message texte (vous pouvez garder votre version ou la simplifier)
    async sendTextMessage(recipientId, text) {
        try {
            const response = await fetch(`${this.API_URL}/me/messages?access_token=${this.PAGE_ACCESS_TOKEN}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    recipient: { id: recipientId },
                    message: { text }
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

    // ... reste de vos méthodes existantes ...

    // Envoyer un message avec quick replies
    async sendQuickReply(recipientId, text, quickReplies) {
        try {
            const response = await fetch(`${this.API_URL}/me/messages?access_token=${this.PAGE_ACCESS_TOKEN}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    recipient: { id: recipientId },
                    message: {
                        text,
                        quick_replies: quickReplies
                    }
                })
            });

            const data = await response.json();
            
            if (data.error) {
                console.error('Erreur Facebook API:', data.error);
                return { success: false, error: data.error.message };
            }
            
            return { success: true, messageId: data.message_id };
        } catch (error) {
            console.error('Erreur envoi quick reply:', error);
            return { success: false, error: error.message };
        }
    }

    // Envoyer un message d'avertissement
    async sendWarningMessage(userId, reason) {
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

        return await this.sendTextMessage(userId, warningMessage);
    }

    // Envoyer un message de blocage
    async sendBlockMessage(userId, reason) {
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

        return await this.sendTextMessage(userId, blockMessage);
    }

    // Envoyer un message personnalisé de l'admin
    async sendAdminMessage(userId, message) {
        let customMessage = '📢 MESSAGE DE L\'ADMINISTRATION\n\n';
        customMessage += message + '\n\n';
        customMessage += 'L\'équipe SpeakToStranger 🎭';
        
        return await this.sendTextMessage(userId, customMessage);
    }

    // Marquer un message comme vu
    async markSeen(recipientId) {
        try {
            await fetch(`${this.API_URL}/me/messages?access_token=${this.PAGE_ACCESS_TOKEN}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    recipient: { id: recipientId },
                    sender_action: 'mark_seen'
                })
            });
        } catch (error) {
            console.error('Erreur mark seen:', error);
        }
    }

    // Afficher l'indicateur de frappe
    async sendTypingOn(recipientId) {
        try {
            await fetch(`${this.API_URL}/me/messages?access_token=${this.PAGE_ACCESS_TOKEN}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    recipient: { id: recipientId },
                    sender_action: 'typing_on'
                })
            });
        } catch (error) {
            console.error('Erreur typing on:', error);
        }
    }

    // Masquer l'indicateur de frappe
    async sendTypingOff(recipientId) {
        try {
            await fetch(`${this.API_URL}/me/messages?access_token=${this.PAGE_ACCESS_TOKEN}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    recipient: { id: recipientId },
                    sender_action: 'typing_off'
                })
            });
        } catch (error) {
            console.error('Erreur typing off:', error);
        }
    }
}

module.exports = new FacebookAPI();
