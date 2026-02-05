const { User } = require('../models');

class UserManager {
    constructor() {
        this.pseudoCache = new Map();
    }

    async getOrCreateUser(facebookId) {
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
        
        let pseudo;
        let attempts = 0;
        
        do {
            const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
            const noun = nouns[Math.floor(Math.random() * nouns.length)];
            const number = Math.floor(Math.random() * 10000);
            pseudo = `${adj}${noun}${number}`;
            attempts++;
        } while (this.pseudoCache.has(pseudo) && attempts < 10);
        
        this.pseudoCache.set(pseudo, true);
        
        // Nettoyer le cache si trop grand
        if (this.pseudoCache.size > 10000) {
            const toDelete = Array.from(this.pseudoCache.keys()).slice(0, 5000);
            toDelete.forEach(key => this.pseudoCache.delete(key));
        }
        
        return pseudo;
    }

    async updateUserActivity(userId) {
        await User.findOneAndUpdate(
            { facebookId: userId },
            { 
                lastActivity: new Date(),
                status: 'online'
            }
        );
    }

    async setUserOffline(userId) {
        await User.findOneAndUpdate(
            { facebookId: userId },
            { status: 'offline' }
        );
    }

    async cleanInactiveUsers() {
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        
        await User.updateMany(
            { 
                lastActivity: { $lt: tenMinutesAgo },
                status: { $ne: 'offline' }
            },
            { status: 'offline' }
        );
    }
}

module.exports = UserManager;
