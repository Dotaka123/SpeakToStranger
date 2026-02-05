const fetch = require('node-fetch');

class FacebookAPI {
    constructor() {
        this.PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || 'VOTRE_TOKEN_ICI';
        this.API_URL = 'https://graph.facebook.com/v12.0/me/messages';
    }

    async sendTextMessage(recipientId, text) {
        const messageData = {
            recipient: { id: recipientId },
            message: { text: text }
        };

        return this.callSendAPI(messageData);
    }

    async sendQuickReplies(recipientId, text, quickReplies) {
        const messageData = {
            recipient: { id: recipientId },
            message: {
                text: text,
                quick_replies: quickReplies.map(qr => ({
                    content_type: 'text',
                    title: qr.title,
                    payload: qr.payload
                }))
            }
        };

        return this.callSendAPI(messageData);
    }

    async sendTypingIndicator(recipientId, isTyping) {
        const messageData = {
            recipient: { id: recipientId },
            sender_action: isTyping ? 'typing_on' : 'typing_off'
        };

        return this.callSendAPI(messageData);
    }

    async sendImage(recipientId, imageUrl) {
        const messageData = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: 'image',
                    payload: { url: imageUrl }
                }
            }
        };

        return this.callSendAPI(messageData);
    }

    async getUserProfile(userId) {
        try {
            const response = await fetch(
                `https://graph.facebook.com/${userId}?fields=first_name,last_name,profile_pic&access_token=${this.PAGE_ACCESS_TOKEN}`
            );
            
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error('Erreur récupération profil:', error);
        }
        
        return null;
    }

    async callSendAPI(messageData) {
        try {
            const response = await fetch(
                `${this.API_URL}?access_token=${this.PAGE_ACCESS_TOKEN}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(messageData)
                }
            );

            if (!response.ok) {
                const error = await response.text();
                console.error('Erreur API Facebook:', error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Erreur envoi message:', error);
            return false;
        }
    }

    async setPersistentMenu() {
        const menuData = {
            persistent_menu: [{
                locale: 'default',
                composer_input_disabled: false,
                call_to_actions: [
                    {
                        title: '🚀 Nouvelle conversation',
                        type: 'postback',
                        payload: 'START_CHAT'
                    },
                    {
                        title: '📊 Mes stats',
                        type: 'postback',
                        payload: 'VIEW_STATS'
                    },
                    {
                        title: '⚙️ Paramètres',
                        type: 'postback',
                        payload: 'SETTINGS'
                    },
                    {
                        title: '❓ Aide',
                        type: 'postback',
                        payload: 'HELP'
                    }
                ]
            }]
        };

        try {
            const response = await fetch(
                `https://graph.facebook.com/v12.0/me/messenger_profile?access_token=${this.PAGE_ACCESS_TOKEN}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(menuData)
                }
            );

            if (response.ok) {
                console.log('✅ Menu persistant configuré');
            }
        } catch (error) {
            console.error('Erreur configuration menu:', error);
        }
    }
}

module.exports = FacebookAPI;
