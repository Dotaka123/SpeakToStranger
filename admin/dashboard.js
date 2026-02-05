const express = require('express');
const router = express.Router();
const { Report, User, Chat } = require('../models');
const auth = require('../middleware/auth');

// Middleware d'authentification admin
router.use(auth.requireAdmin);

// Page principale du dashboard
router.get('/', async (req, res) => {
    const stats = {
        pendingReports: await Report.countDocuments({ status: 'pending' }),
        totalReports: await Report.countDocuments(),
        blockedUsers: await User.countDocuments({ isBlocked: true }),
        activeChats: await Chat.countDocuments({ isActive: true })
    };
    
    res.render('dashboard', { stats });
});

// Liste des signalements
router.get('/reports', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const skip = (page - 1) * limit;
    
    const reports = await Report.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
    
    // Enrichir avec les infos utilisateurs
    for (const report of reports) {
        report.reporter = await User.findOne({ facebookId: report.reporterId }).lean();
        report.reported = await User.findOne({ facebookId: report.reportedUserId }).lean();
        
        if (report.chatId) {
            report.chat = await Chat.findById(report.chatId).lean();
        }
    }
    
    const totalReports = await Report.countDocuments();
    const totalPages = Math.ceil(totalReports / limit);
    
    res.render('reports', { 
        reports, 
        currentPage: page, 
        totalPages,
        status: req.query.status 
    });
});

// Détail d'un signalement
router.get('/reports/:id', async (req, res) => {
    const report = await Report.findById(req.params.id).lean();
    
    if (!report) {
        return res.status(404).send('Signalement non trouvé');
    }
    
    // Récupérer les informations complètes
    report.reporter = await User.findOne({ facebookId: report.reporterId }).lean();
    report.reported = await User.findOne({ facebookId: report.reportedUserId }).lean();
    
    // Récupérer la conversation complète
    if (report.chatId) {
        report.chat = await Chat.findById(report.chatId).lean();
    }
    
    // Historique des signalements pour cet utilisateur
    const userReportHistory = await Report.find({ 
        reportedUserId: report.reportedUserId 
    }).sort({ createdAt: -1 }).lean();
    
    res.render('report-detail', { report, userReportHistory });
});

// Traiter un signalement
router.post('/reports/:id/action', async (req, res) => {
    const { action, duration, reason } = req.body;
    const report = await Report.findById(req.params.id);
    
    if (!report) {
        return res.status(404).json({ error: 'Signalement non trouvé' });
    }
    
    try {
        switch (action) {
            case 'warn':
                await handleWarning(report.reportedUserId, reason);
                break;
                
            case 'block':
                await handleBlock(report.reportedUserId, duration, reason);
                break;
                
            case 'dismiss':
                // Juste marquer comme résolu
                break;
                
            case 'delete_chat':
                await Chat.findByIdAndDelete(report.chatId);
                break;
        }
        
        // Mettre à jour le statut du signalement
        report.status = 'resolved';
        report.reviewedAt = new Date();
        report.action = action;
        report.actionReason = reason;
        report.reviewedBy = req.user.id;
        await report.save();
        
        res.json({ success: true, message: 'Action effectuée avec succès' });
    } catch (error) {
        console.error('Erreur traitement signalement:', error);
        res.status(500).json({ error: 'Erreur lors du traitement' });
    }
});

// Fonctions de modération
async function handleWarning(userId, reason) {
    const user = await User.findOne({ facebookId: userId });
    
    if (!user) return;
    
    // Enregistrer l'avertissement
    user.warnings = user.warnings || [];
    user.warnings.push({
        date: new Date(),
        reason: reason
    });
    
    await user.save();
    
    // Envoyer un message d'avertissement
    const FacebookAPI = require('../services/facebookAPI');
    const fb = new FacebookAPI();
    
    await fb.sendTextMessage(userId, 
        `⚠️ AVERTISSEMENT\n\n` +
        `Votre comportement a été signalé et jugé inapproprié.\n` +
        `Raison: ${reason}\n\n` +
        `Merci de respecter les règles de la communauté. ` +
        `Des violations répétées entraîneront une suspension de votre compte.`
    );
}

async function handleBlock(userId, duration, reason) {
    const user = await User.findOne({ facebookId: userId });
    
    if (!user) return;
    
    // Calculer la date de déblocage
    let unblockDate = null;
    if (duration !== 'permanent') {
        const hours = parseInt(duration);
        unblockDate = new Date(Date.now() + hours * 60 * 60 * 1000);
    }
    
    // Bloquer l'utilisateur
    user.isBlocked = true;
    user.blockReason = reason;
    user.blockedAt = new Date();
    user.unblockDate = unblockDate;
    await user.save();
    
    // Terminer sa conversation active si elle existe
    if (user.currentChat) {
        const ChatManager = require('../handlers/chatManager');
        const chatManager = new ChatManager();
        await chatManager.endChat(userId);
    }
    
    // Retirer de la file d'attente
    const Queue = require('../models').Queue;
    await Queue.deleteOne({ userId: userId });
    
    // Envoyer un message de suspension
    const FacebookAPI = require('../services/facebookAPI');
    const fb = new FacebookAPI();
    
    let blockMessage = `🚫 COMPTE SUSPENDU\n\n` +
        `Votre compte a été suspendu suite à des violations répétées.\n` +
        `Raison: ${reason}\n\n`;
    
    if (unblockDate) {
        blockMessage += `Suspension jusqu'au: ${unblockDate.toLocaleString('fr-FR')}`;
    } else {
        blockMessage += `Suspension permanente.`;
    }
    
    await fb.sendTextMessage(userId, blockMessage);
}

module.exports = router;
