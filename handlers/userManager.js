const { User } = require('../models');

class UserManager {
    constructor() {
        this.pseudoCache = new Map();
    }

    async getOrCreateUser(facebookId) {
        try {
            let user = await User.findOne({ facebookId: facebookId });
            
            if (!user) {
                const pseudo = this.generateUniquePseudo();
                user = await User.create({
                    facebookId: facebookId,
                    pseudo: pseudo,
                    status: 'online'
                });
                
                console.log(`✅ Nouvel utilisateur créé: ${pseudo}`);
            }
            
            return user;
        } catch (error) {
            console.error('Erreur création utilisateur:', error);
            // Créer un utilisateur temporaire si erreur DB
            return {
                facebookId: facebookId,
                pseudo: this.generateUniquePseudo(),
                status: 'online',
                interests: [],
                blockedUsers: [],
                totalConversations: 0,
                totalMessages: 0,
                rating: 5,
                ratingCount: 0
            };
        }
    }

    generateUniquePseudo() {
        const adjectives = [
            'Mystérieux', 'Curieux', 'Amical', 'Jovial', 'Pensif', 
            'Créatif', 'Brillant', 'Sage', 'Drôle', 'Calme',
            'Énergique', 'Rêveur', 'Aventurier', 'Philosophe', 'Artiste'
        ];
        
        const nouns = [
            'Chat', 'Renard', 'Hibou', 'Loup', 'Phoenix', 
            'Dragon', 'Licorne', 'Papillon', 'Aigle', 'Tigre',
            'Panda', 'Koala', 'Lynx', 'Léopard', 'Faucon'
        ];
        
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const number = Math.floor(Math.random() * 10000);
        
        return `${adj}${noun}${number}`;
    }

    async updateUserActivity(userId) {
        try {
            await User.findOneAndUpdate(
                { facebookId: userId },
                { 
                    lastActivity: new Date(),
                    status: 'online'
                }
            );
        } catch (error) {
            console.error('Erreur mise à jour activité:', error);
        }
    }
}

module.exports = UserManager;
