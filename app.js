const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

// Initialisation de l'app
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Configuration de la base de données
require('./config/database');

// Import des modèles et services
const { User, Chat, Queue, Report, Stats } = require('./models');
const ChatManager = require('./handlers/chatManager');
const UserManager = require('./handlers/userManager');
const MessageHandler = require('./handlers/messageHandler');

// Création des instances dans le bon ordre
const userManager = new UserManager();
const chatManager = new ChatManager();
const messageHandler = new MessageHandler(chatManager, userManager);

// Démarrer le nettoyage automatique
chatManager.startAutoCleanup();

// Configuration
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || 'VOTRE_TOKEN_ICI';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'VOTRE_VERIFY_TOKEN';

// Initialisation des gestionnaires
const userManager = new UserManager();
const chatManager = new ChatManager();
const messageHandler = new MessageHandler(chatManager, userManager);

// Routes d'administration (avant les routes webhook)
const auth = require('./middleware/auth');

app.get('/admin/login', auth.showLoginPage);
app.post('/admin/login', auth.login.bind(auth));
app.get('/admin/logout', auth.logout);

// Dashboard admin (protégé)
app.get('/admin', auth.requireAdmin, async (req, res) => {
    try {
        const stats = {
            pendingReports: await Report.countDocuments({ status: 'pending' }),
            totalReports: await Report.countDocuments(),
            blockedUsers: await User.countDocuments({ isBlocked: true }),
            activeChats: await Chat.countDocuments({ isActive: true }),
            totalUsers: await User.countDocuments(),
            totalMessages: await Chat.aggregate([
                { $group: { _id: null, total: { $sum: '$messageCount' } } }
            ]).then(r => r[0]?.total || 0)
        };
        
        // Renvoyer du HTML simple pour le dashboard
        res.send(`
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <meta charset="UTF-8">
                <title>Dashboard Admin - SpeakToStranger</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
                    .container { max-width: 1200px; margin: 0 auto; }
                    h1 { color: #333; }
                    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
                    .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                    .stat-value { font-size: 2em; font-weight: bold; color: #3498db; }
                    .stat-label { color: #666; margin-top: 5px; }
                    .danger { color: #e74c3c; }
                    .warning { color: #f39c12; }
                    .btn { display: inline-block; padding: 10px 20px; background: #3498db; color: white; text-decoration: none; border-radius: 5px; margin: 5px; }
                    .btn:hover { background: #2980b9; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🎭 Dashboard Admin - SpeakToStranger</h1>
                    
                    <div class="stats">
                        <div class="stat-card">
                            <div class="stat-value danger">${stats.pendingReports}</div>
                            <div class="stat-label">Signalements en attente</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${stats.totalReports}</div>
                            <div class="stat-label">Total signalements</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value warning">${stats.blockedUsers}</div>
                            <div class="stat-label">Utilisateurs bloqués</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${stats.activeChats}</div>
                            <div class="stat-label">Conversations actives</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${stats.totalUsers}</div>
                            <div class="stat-label">Total utilisateurs</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-value">${stats.totalMessages}</div>
                            <div class="stat-label">Messages échangés</div>
                        </div>
                    </div>
                    
                    <div style="margin-top: 30px;">
                        <a href="/admin/reports" class="btn">📋 Voir les signalements</a>
                        <a href="/admin/users" class="btn">👥 Gérer les utilisateurs</a>
                        <a href="/admin/chats" class="btn">💬 Conversations actives</a>
                        <a href="/admin/logout" class="btn" style="background: #e74c3c;">🚪 Déconnexion</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Erreur dashboard:', error);
        res.status(500).send('Erreur serveur');
    }
});

// ========================================
// PAGE DES SIGNALEMENTS CORRIGÉE
// ========================================
app.get('/admin/reports-simple', async (req, res) => {
    try {
        let reports = [];
        let users = new Map();
        
        try {
            const { Report, User } = require('./models');
            reports = await Report.find().sort({ createdAt: -1 }).limit(100).lean();
            
            // Récupérer les infos des utilisateurs
            const userIds = [...new Set([...reports.map(r => r.reporterId), ...reports.map(r => r.reportedUserId)])];
            const userDocs = await User.find({ facebookId: { $in: userIds } }).lean();
            userDocs.forEach(u => users.set(u.facebookId, u));
        } catch (e) {
            console.log('Erreur récupération données:', e);
        }
        
        const pendingCount = reports.filter(r => r.status === 'pending').length;
        const resolvedCount = reports.filter(r => r.status === 'resolved').length;
        
        let html = `
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <title>Gestion des Signalements - SpeakToStranger</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh;
                        padding: 20px;
                    }
                    
                    .container { max-width: 1400px; margin: 0 auto; }
                    
                    .header {
                        background: white;
                        border-radius: 16px;
                        padding: 2rem;
                        margin-bottom: 2rem;
                        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                    }
                    
                    .header-top {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 1rem;
                    }
                    
                    h1 {
                        color: #2d3748;
                        font-size: 2rem;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    
                    .back-btn {
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        padding: 10px 20px;
                        border-radius: 8px;
                        text-decoration: none;
                        font-weight: 500;
                    }
                    
                    .reports-table {
                        background: white;
                        border-radius: 12px;
                        overflow: hidden;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.07);
                    }
                    
                    table {
                        width: 100%;
                        border-collapse: collapse;
                    }
                    
                    th {
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        padding: 1rem;
                        text-align: left;
                        font-weight: 600;
                    }
                    
                    td {
                        padding: 1rem;
                        border-bottom: 1px solid #e2e8f0;
                    }
                    
                    .action-buttons {
                        display: flex;
                        gap: 0.5rem;
                    }
                    
                    .action-btn {
                        padding: 6px 12px;
                        border: none;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 0.875rem;
                        font-weight: 500;
                        transition: all 0.2s;
                    }
                    
                    .btn-warn {
                        background: #feebc8;
                        color: #c05621;
                    }
                    
                    .btn-warn:hover {
                        background: #fbd38d;
                    }
                    
                    .btn-block {
                        background: #fed7d7;
                        color: #c53030;
                    }
                    
                    .btn-block:hover {
                        background: #fc8181;
                    }
                    
                    .btn-resolve {
                        background: #c6f6d5;
                        color: #22543d;
                    }
                    
                    .btn-resolve:hover {
                        background: #9ae6b4;
                    }
                    
                    /* Modal styles */
                    .modal {
                        display: none;
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background: rgba(0, 0, 0, 0.5);
                        z-index: 1000;
                        align-items: center;
                        justify-content: center;
                    }
                    
                    .modal.active {
                        display: flex;
                    }
                    
                    .modal-content {
                        background: white;
                        border-radius: 12px;
                        padding: 2rem;
                        max-width: 500px;
                        width: 90%;
                    }
                    
                    .modal-title {
                        font-size: 1.5rem;
                        color: #2d3748;
                        margin-bottom: 1.5rem;
                    }
                    
                    .form-group {
                        margin-bottom: 1rem;
                    }
                    
                    .form-label {
                        display: block;
                        margin-bottom: 0.5rem;
                        font-weight: 500;
                        color: #4a5568;
                    }
                    
                    .form-select, .form-textarea {
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid #e2e8f0;
                        border-radius: 6px;
                        font-size: 1rem;
                    }
                    
                    .modal-footer {
                        display: flex;
                        gap: 1rem;
                        justify-content: flex-end;
                        margin-top: 1.5rem;
                    }
                    
                    .btn-cancel {
                        background: #e2e8f0;
                        color: #4a5568;
                    }
                    
                    .btn-confirm {
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                    }
                    
                    .toast {
                        position: fixed;
                        top: 20px;
                        right: 20px;
                        padding: 15px 20px;
                        border-radius: 8px;
                        color: white;
                        font-weight: 500;
                        z-index: 2000;
                        display: none;
                        animation: slideIn 0.3s ease;
                    }
                    
                    .toast.success {
                        background: #48bb78;
                    }
                    
                    .toast.error {
                        background: #f56565;
                    }
                    
                    .toast.show {
                        display: block;
                    }
                    
                    @keyframes slideIn {
                        from {
                            transform: translateX(100%);
                            opacity: 0;
                        }
                        to {
                            transform: translateX(0);
                            opacity: 1;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <div class="header-top">
                            <h1>
                                <span>📋</span>
                                <span>Gestion des Signalements</span>
                            </h1>
                            <a href="/admin/dashboard-direct" class="back-btn">
                                ← Retour au Dashboard
                            </a>
                        </div>
                    </div>
                    
                    <div class="reports-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Signalé par</th>
                                    <th>Utilisateur signalé</th>
                                    <th>Raison</th>
                                    <th>Statut</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>`;
        
        for (const report of reports) {
            const reporter = users.get(report.reporterId);
            const reported = users.get(report.reportedUserId);
            const status = report.status || 'pending';
            const date = new Date(report.createdAt);
            
            // Utiliser des data attributes pour éviter les problèmes d'apostrophes
            html += `
                <tr>
                    <td>${date.toLocaleDateString('fr-FR')}</td>
                    <td>${reporter?.pseudo || 'Utilisateur'}</td>
                    <td>${reported?.pseudo || 'Utilisateur'}</td>
                    <td>${report.reason || 'Non spécifiée'}</td>
                    <td>${status}</td>
                    <td>
                        <div class="action-buttons">`;
            
            if (status === 'pending') {
                // Utiliser des data attributes au lieu de passer des paramètres dans onclick
                html += `
                    <button class="action-btn btn-warn warning-btn" 
                            data-userid="${report.reportedUserId}" 
                            data-reportid="${report._id}">
                        ⚠️ Avertir
                    </button>
                    <button class="action-btn btn-block block-btn" 
                            data-userid="${report.reportedUserId}" 
                            data-reportid="${report._id}">
                        🚫 Bloquer
                    </button>
                    <button class="action-btn btn-resolve resolve-btn" 
                            data-reportid="${report._id}">
                        ✅ Résoudre
                    </button>`;
            } else {
                html += '✅ Résolu';
            }
            
            html += `
                        </div>
                    </td>
                </tr>`;
        }
        
        html += `
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <!-- Modal d'avertissement -->
                <div id="warningModal" class="modal">
                    <div class="modal-content">
                        <h2 class="modal-title">⚠️ Envoyer un avertissement</h2>
                        <form id="warningForm">
                            <input type="hidden" id="warnUserId">
                            <input type="hidden" id="warnReportId">
                            
                            <div class="form-group">
                                <label class="form-label">Type d'avertissement</label>
                                <select class="form-select" id="warnType">
                                    <option value="general">Comportement inapproprié</option>
                                    <option value="language">Langage offensant</option>
                                    <option value="spam">Spam ou publicité</option>
                                    <option value="harassment">Harcèlement</option>
                                    <option value="custom">Personnalisé</option>
                                </select>
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label">Message personnalisé (optionnel)</label>
                                <textarea class="form-textarea" id="warnMessage" rows="3" 
                                    placeholder="Ajoutez des détails sur la raison de l'avertissement..."></textarea>
                            </div>
                            
                            <div class="modal-footer">
                                <button type="button" class="action-btn btn-cancel cancel-warn">Annuler</button>
                                <button type="submit" class="action-btn btn-confirm">Envoyer l'avertissement</button>
                            </div>
                        </form>
                    </div>
                </div>
                
                <!-- Modal de blocage -->
                <div id="blockModal" class="modal">
                    <div class="modal-content">
                        <h2 class="modal-title">🚫 Bloquer l'utilisateur</h2>
                        <form id="blockForm">
                            <input type="hidden" id="blockUserId">
                            <input type="hidden" id="blockReportId">
                            
                            <div class="form-group">
                                <label class="form-label">Raison du blocage</label>
                                <select class="form-select" id="blockReason">
                                    <option value="violation">Violation grave des conditions</option>
                                    <option value="repeated">Infractions répétées</option>
                                    <option value="harassment">Harcèlement grave</option>
                                    <option value="illegal">Contenu illégal</option>
                                    <option value="custom">Autre raison</option>
                                </select>
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label">Détails (optionnel)</label>
                                <textarea class="form-textarea" id="blockDetails" rows="3"></textarea>
                            </div>
                            
                            <div class="modal-footer">
                                <button type="button" class="action-btn btn-cancel cancel-block">Annuler</button>
                                <button type="submit" class="action-btn btn-confirm" style="background: #f56565;">Bloquer définitivement</button>
                            </div>
                        </form>
                    </div>
                </div>
                
                <!-- Toast de notification -->
                <div id="toast" class="toast"></div>
                
                <script>
                    // Attacher les événements après le chargement du DOM
                    document.addEventListener('DOMContentLoaded', function() {
                        
                        // Fonction pour ouvrir le modal d'avertissement
                        function openWarningModal(userId, reportId) {
                            document.getElementById('warnUserId').value = userId;
                            document.getElementById('warnReportId').value = reportId;
                            document.getElementById('warningModal').classList.add('active');
                        }
                        
                        // Fonction pour ouvrir le modal de blocage
                        function openBlockModal(userId, reportId) {
                            document.getElementById('blockUserId').value = userId;
                            document.getElementById('blockReportId').value = reportId;
                            document.getElementById('blockModal').classList.add('active');
                        }
                        
                        // Fermer un modal
                        function closeModal(modalId) {
                            document.getElementById(modalId).classList.remove('active');
                        }
                        
                        // Afficher une notification toast
                        function showToast(message, type = 'success') {
                            const toast = document.getElementById('toast');
                            toast.textContent = message;
                            toast.className = 'toast ' + type + ' show';
                            setTimeout(() => {
                                toast.classList.remove('show');
                            }, 3000);
                        }
                        
                        // Résoudre un signalement sans action
                        async function resolveReport(reportId) {
                            if (confirm('Marquer ce signalement comme résolu sans action ?')) {
                                try {
                                    const response = await fetch('/admin/report/' + reportId + '/resolve', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ action: 'resolved' })
                                    });
                                    
                                    if (response.ok) {
                                        showToast('✅ Signalement résolu', 'success');
                                        setTimeout(() => location.reload(), 2000);
                                    } else {
                                        showToast('❌ Erreur lors de la résolution', 'error');
                                    }
                                } catch (error) {
                                    showToast('❌ Erreur: ' + error.message, 'error');
                                }
                            }
                        }
                        
                        // Attacher les événements aux boutons d'avertissement
                        document.querySelectorAll('.warning-btn').forEach(btn => {
                            btn.addEventListener('click', function() {
                                const userId = this.getAttribute('data-userid');
                                const reportId = this.getAttribute('data-reportid');
                                openWarningModal(userId, reportId);
                            });
                        });
                        
                        // Attacher les événements aux boutons de blocage
                        document.querySelectorAll('.block-btn').forEach(btn => {
                            btn.addEventListener('click', function() {
                                const userId = this.getAttribute('data-userid');
                                const reportId = this.getAttribute('data-reportid');
                                openBlockModal(userId, reportId);
                            });
                        });
                        
                        // Attacher les événements aux boutons de résolution
                        document.querySelectorAll('.resolve-btn').forEach(btn => {
                            btn.addEventListener('click', function() {
                                const reportId = this.getAttribute('data-reportid');
                                resolveReport(reportId);
                            });
                        });
                        
                        // Boutons d'annulation
                        document.querySelectorAll('.cancel-warn').forEach(btn => {
                            btn.addEventListener('click', () => closeModal('warningModal'));
                        });
                        
                        document.querySelectorAll('.cancel-block').forEach(btn => {
                            btn.addEventListener('click', () => closeModal('blockModal'));
                        });
                        
                        // Gestionnaire du formulaire d'avertissement
                        document.getElementById('warningForm').addEventListener('submit', async (e) => {
                            e.preventDefault();
                            
                            const userId = document.getElementById('warnUserId').value;
                            const reportId = document.getElementById('warnReportId').value;
                            const warnType = document.getElementById('warnType').value;
                            const customMessage = document.getElementById('warnMessage').value;
                            
                            let reason = '';
                            switch(warnType) {
                                case 'general': reason = 'Comportement inapproprié'; break;
                                case 'language': reason = 'Langage offensant'; break;
                                case 'spam': reason = 'Spam ou publicité non sollicitée'; break;
                                case 'harassment': reason = 'Harcèlement d\\'autres utilisateurs'; break;
                                case 'custom': reason = customMessage || 'Violation des règles'; break;
                            }
                            
                            try {
                                const response = await fetch('/admin/user/' + userId + '/warn', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ reason })
                                });
                                
                                const data = await response.json();
                                
                                if (data.success) {
                                    // Résoudre le signalement
                                    await fetch('/admin/report/' + reportId + '/resolve', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ action: 'warn', userId, reason })
                                    });
                                    
                                    showToast('✅ Avertissement envoyé avec succès !', 'success');
                                    closeModal('warningModal');
                                    setTimeout(() => location.reload(), 2000);
                                } else {
                                    showToast('❌ Erreur: ' + (data.error || 'Impossible d\\'envoyer l\\'avertissement'), 'error');
                                }
                            } catch (error) {
                                showToast('❌ Erreur réseau: ' + error.message, 'error');
                            }
                        });
                        
                        // Gestionnaire du formulaire de blocage
                        document.getElementById('blockForm').addEventListener('submit', async (e) => {
                            e.preventDefault();
                            
                            if (!confirm('Êtes-vous sûr de vouloir bloquer cet utilisateur définitivement ?')) {
                                return;
                            }
                            
                            const userId = document.getElementById('blockUserId').value;
                            const reportId = document.getElementById('blockReportId').value;
                            const blockReason = document.getElementById('blockReason').value;
                            const blockDetails = document.getElementById('blockDetails').value;
                            
                            let reason = '';
                            switch(blockReason) {
                                case 'violation': reason = 'Violation grave des conditions d\\'utilisation'; break;
                                case 'repeated': reason = 'Infractions répétées malgré les avertissements'; break;
                                case 'harassment': reason = 'Harcèlement grave d\\'autres utilisateurs'; break;
                                case 'illegal': reason = 'Partage de contenu illégal'; break;
                                case 'custom': reason = blockDetails || 'Violation des règles communautaires'; break;
                            }
                            
                            try {
                                const response = await fetch('/admin/user/' + userId + '/block', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ reason })
                                });
                                
                                const data = await response.json();
                                
                                if (data.success) {
                                    // Résoudre le signalement
                                    await fetch('/admin/report/' + reportId + '/resolve', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ action: 'block', userId, reason })
                                    });
                                    
                                    showToast('✅ Utilisateur bloqué avec succès !', 'success');
                                    closeModal('blockModal');
                                    setTimeout(() => location.reload(), 2000);
                                } else {
                                    showToast('❌ Erreur: ' + (data.error || 'Impossible de bloquer l\\'utilisateur'), 'error');
                                }
                            } catch (error) {
                                showToast('❌ Erreur réseau: ' + error.message, 'error');
                            }
                        });
                        
                        // Fermer les modals en cliquant en dehors
                        document.querySelectorAll('.modal').forEach(modal => {
                            modal.addEventListener('click', (e) => {
                                if (e.target === modal) {
                                    modal.classList.remove('active');
                                }
                            });
                        });
                    });
                </script>
            </body>
            </html>`;
        
        res.send(html);
    } catch (error) {
        console.error('Erreur page signalements:', error);
        res.status(500).send(`<h1>Erreur</h1><p>${error.message}</p><a href="/admin/dashboard-direct">Retour</a>`);
    }
});

// ========================================
// FONCTIONS D'ENVOI DE MESSAGES FACEBOOK
// ========================================

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

// ========================================
// ROUTES API POUR LES ACTIONS ADMIN
// ========================================

// Route pour envoyer un avertissement à un utilisateur
app.post('/admin/user/:userId/warn', async (req, res) => {
    try {
        const { userId } = req.params;
        const { reason } = req.body;
        
        // Message d'avertissement personnalisé
        const warningMessage = `⚠️ AVERTISSEMENT ADMINISTRATEUR ⚠️

Bonjour,

Vous avez reçu un avertissement de la part de l'équipe de modération de SpeakToStranger.

${reason ? `Raison: ${reason}` : 'Votre comportement ne respecte pas nos règles communautaires.'}

Merci de respecter les règles suivantes :
• Restez respectueux envers les autres utilisateurs
• Pas de contenu inapproprié ou offensant
• Pas de harcèlement ou spam
• Pas de partage d'informations personnelles

En cas de récidive, votre compte pourrait être suspendu définitivement.

Cordialement,
L'équipe SpeakToStranger 🎭`;

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

// Route pour envoyer un message personnalisé
app.post('/admin/user/:userId/message', async (req, res) => {
    try {
        const { userId } = req.params;
        const { message } = req.body;
        
        if (!message) {
            return res.status(400).json({ success: false, error: 'Message requis' });
        }
        
        const customMessage = `📢 MESSAGE DE L'ADMINISTRATION

${message}

L'équipe SpeakToStranger 🎭`;
        
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
            await sendMessageToUser(userId, `⚠️ Vous avez reçu un avertissement suite à un signalement.

${reason || 'Merci de respecter les règles de la communauté.'}

L'équipe SpeakToStranger`);
        } else if (action === 'block' && userId) {
            await sendMessageToUser(userId, `🚫 Votre compte a été suspendu suite à des signalements répétés.

${reason || 'Violation des conditions d\'utilisation.'}

L'équipe SpeakToStranger`);
            
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

// Action sur un signalement
app.post('/admin/reports/:id/action', auth.requireAdmin, async (req, res) => {
    try {
        const { action, reason } = req.body;
        const report = await Report.findById(req.params.id);
        
        if (!report) {
            return res.status(404).json({ error: 'Signalement non trouvé' });
        }

        if (action === 'block') {
            await User.findOneAndUpdate(
                { facebookId: report.reportedUserId },
                { 
                    isBlocked: true,
                    blockReason: reason || 'Violation des règles'
                }
            );
        }

        report.status = 'resolved';
        report.action = action;
        report.reviewedAt = new Date();
        await report.save();

        res.json({ success: true });
    } catch (error) {
        console.error('Erreur action signalement:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// ========================================
// ROUTE D'ACCÈS DIRECT AU DASHBOARD
// ========================================
app.get('/admin/dashboard-direct', async (req, res) => {
    try {
        // Stats par défaut
        let stats = {
            pendingReports: 0,
            totalReports: 0,
            blockedUsers: 0,
            activeChats: 0,
            totalUsers: 0,
            totalMessages: 0
        };
        
        // Essayer de récupérer les vraies stats depuis MongoDB
        try {
            const { Report, User, Chat } = require('./models');
            
            if (Report) {
                stats.pendingReports = await Report.countDocuments({ status: 'pending' }).catch(() => 0);
                stats.totalReports = await Report.countDocuments().catch(() => 0);
            }
            if (User) {
                stats.blockedUsers = await User.countDocuments({ isBlocked: true }).catch(() => 0);
                stats.totalUsers = await User.countDocuments().catch(() => 0);
            }
            if (Chat) {
                stats.activeChats = await Chat.countDocuments({ isActive: true }).catch(() => 0);
            }
        } catch (dbError) {
            console.log('Base de données non disponible, utilisation des valeurs par défaut');
        }
        
        // Page HTML du dashboard
        res.send(`
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Dashboard Admin - SpeakToStranger</title>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                        background: #f0f2f5; 
                        min-height: 100vh;
                    }
                    
                    .header {
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        padding: 2rem 0;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                    }
                    
                    .container { 
                        max-width: 1200px; 
                        margin: 0 auto; 
                        padding: 0 20px;
                    }
                    
                    h1 { 
                        margin: 0;
                        font-size: 2rem;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    
                    .subtitle {
                        opacity: 0.9;
                        margin-top: 0.5rem;
                        font-size: 1.1rem;
                    }
                    
                    .content {
                        padding: 2rem 0;
                    }
                    
                    .stats { 
                        display: grid; 
                        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); 
                        gap: 20px; 
                        margin-bottom: 2rem;
                    }
                    
                    .stat-card { 
                        background: white; 
                        padding: 1.5rem; 
                        border-radius: 12px; 
                        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                        transition: all 0.3s ease;
                        border: 1px solid #e5e7eb;
                    }
                    
                    .stat-card:hover {
                        transform: translateY(-4px);
                        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    }
                    
                    .stat-icon {
                        font-size: 2rem;
                        margin-bottom: 0.5rem;
                    }
                    
                    .stat-value { 
                        font-size: 2.5rem; 
                        font-weight: bold; 
                        color: #1a202c;
                        margin-bottom: 0.25rem;
                    }
                    
                    .stat-label { 
                        color: #718096; 
                        font-size: 0.875rem;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        font-weight: 600;
                    }
                    
                    .danger { color: #e53e3e !important; }
                    .warning { color: #dd6b20 !important; }
                    .success { color: #38a169 !important; }
                    .info { color: #3182ce !important; }
                    
                    .actions {
                        background: white;
                        padding: 2rem;
                        border-radius: 12px;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                        border: 1px solid #e5e7eb;
                        margin-bottom: 2rem;
                    }
                    
                    .actions h2 {
                        margin-bottom: 1.5rem;
                        color: #2d3748;
                        font-size: 1.5rem;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    
                    .btn-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 1rem;
                    }
                    
                    .btn { 
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        gap: 8px;
                        padding: 12px 24px; 
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; 
                        text-decoration: none; 
                        border-radius: 8px; 
                        font-weight: 500;
                        transition: all 0.3s ease;
                        text-align: center;
                        border: none;
                        cursor: pointer;
                    }
                    
                    .btn:hover { 
                        transform: translateY(-2px);
                        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
                    }
                    
                    .btn-secondary {
                        background: linear-gradient(135deg, #4a5568 0%, #2d3748 100%);
                    }
                    
                    .btn-danger {
                        background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
                    }
                    
                    .btn-warning {
                        background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);
                    }
                    
                    .btn-success {
                        background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
                    }
                    
                    .info-box {
                        background: #edf2f7;
                        padding: 1.5rem;
                        border-radius: 8px;
                        border-left: 4px solid #667eea;
                        margin-bottom: 2rem;
                    }
                    
                    .info-box h3 {
                        color: #2d3748;
                        margin-bottom: 0.5rem;
                    }
                    
                    .info-box p {
                        color: #4a5568;
                        margin: 0.25rem 0;
                    }
                    
                    .status-badge {
                        display: inline-block;
                        padding: 4px 8px;
                        border-radius: 4px;
                        font-size: 0.75rem;
                        font-weight: 600;
                        text-transform: uppercase;
                    }
                    
                    .badge-online {
                        background: #c6f6d5;
                        color: #22543d;
                    }
                    
                    .badge-offline {
                        background: #fed7d7;
                        color: #742a2a;
                    }
                    
                    @media (max-width: 768px) {
                        .stats {
                            grid-template-columns: 1fr;
                        }
                        .btn-grid {
                            grid-template-columns: 1fr;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="container">
                        <h1>
                            <span>🎭</span>
                            <span>Dashboard Admin - SpeakToStranger</span>
                        </h1>
                        <p class="subtitle">Centre de contrôle et modération du bot Messenger</p>
                    </div>
                </div>
                
                <div class="container">
                    <div class="content">
                        <!-- Info Box -->
                        <div class="info-box">
                            <h3>🟢 Système opérationnel</h3>
                            <p>Bot en ligne depuis: ${new Date(Date.now() - process.uptime() * 1000).toLocaleString('fr-FR')}</p>
                            <p>Environnement: <span class="status-badge badge-online">${process.env.NODE_ENV || 'development'}</span></p>
                            <p>URL du webhook: <code>${req.protocol}://${req.get('host')}/webhook</code></p>
                        </div>
                        
                        <!-- Statistiques -->
                        <div class="stats">
                            <div class="stat-card">
                                <div class="stat-icon">🚨</div>
                                <div class="stat-value danger">${stats.pendingReports}</div>
                                <div class="stat-label">Signalements en attente</div>
                            </div>
                            
                            <div class="stat-card">
                                <div class="stat-icon">📊</div>
                                <div class="stat-value info">${stats.totalReports}</div>
                                <div class="stat-label">Total signalements</div>
                            </div>
                            
                            <div class="stat-card">
                                <div class="stat-icon">🚫</div>
                                <div class="stat-value warning">${stats.blockedUsers}</div>
                                <div class="stat-label">Utilisateurs bloqués</div>
                            </div>
                            
                            <div class="stat-card">
                                <div class="stat-icon">💬</div>
                                <div class="stat-value success">${stats.activeChats}</div>
                                <div class="stat-label">Conversations actives</div>
                            </div>
                            
                            <div class="stat-card">
                                <div class="stat-icon">👥</div>
                                <div class="stat-value">${stats.totalUsers}</div>
                                <div class="stat-label">Total utilisateurs</div>
                            </div>
                            
                            <div class="stat-card">
                                <div class="stat-icon">📩</div>
                                <div class="stat-value">${stats.totalMessages}</div>
                                <div class="stat-label">Messages échangés</div>
                            </div>
                        </div>
                        
                        <!-- Actions de modération -->
                        <div class="actions">
                            <h2>
                                <span>⚡</span>
                                <span>Actions de modération</span>
                            </h2>
                            <div class="btn-grid">
                                <a href="/admin/reports-simple" class="btn btn-danger">
                                    <span>📋</span>
                                    <span>Voir les signalements</span>
                                </a>
                                <a href="/admin/users-simple" class="btn btn-warning">
                                    <span>👥</span>
                                    <span>Gérer les utilisateurs</span>
                                </a>
                                <a href="/admin/chats-simple" class="btn btn-success">
                                    <span>💬</span>
                                    <span>Conversations actives</span>
                                </a>
                                <a href="/admin/stats-simple" class="btn btn-secondary">
                                    <span>📈</span>
                                    <span>Statistiques détaillées</span>
                                </a>
                            </div>
                        </div>
                        
                        <!-- Actions système -->
                        <div class="actions">
                            <h2>
                                <span>🔧</span>
                                <span>Gestion du système</span>
                            </h2>
                            <div class="btn-grid">
                                <a href="/health" class="btn btn-secondary">
                                    <span>❤️</span>
                                    <span>État du système</span>
                                </a>
                                <a href="/" class="btn btn-secondary">
                                    <span>🏠</span>
                                    <span>Page d'accueil</span>
                                </a>
                                <a href="/admin/login" class="btn btn-danger">
                                    <span>🚪</span>
                                    <span>Déconnexion</span>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Erreur dashboard:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Erreur</title>
                <style>
                    body { 
                        font-family: Arial; 
                        display: flex; 
                        justify-content: center; 
                        align-items: center; 
                        height: 100vh; 
                        background: #f5f5f5; 
                    }
                    .error-box {
                        background: white;
                        padding: 2rem;
                        border-radius: 8px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                        text-align: center;
                    }
                    h1 { color: #e53e3e; }
                    pre { 
                        background: #f5f5f5; 
                        padding: 1rem; 
                        border-radius: 4px; 
                        text-align: left;
                        max-width: 600px;
                        overflow: auto;
                    }
                    a {
                        display: inline-block;
                        margin-top: 1rem;
                        padding: 10px 20px;
                        background: #667eea;
                        color: white;
                        text-decoration: none;
                        border-radius: 4px;
                    }
                </style>
            </head>
            <body>
                <div class="error-box">
                    <h1>❌ Erreur serveur</h1>
                    <p>Une erreur s'est produite lors du chargement du dashboard</p>
                    <pre>${error.message}</pre>
                    <a href="/admin/login">Retour à la connexion</a>
                </div>
            </body>
            </html>
        `);
    }
});

// ========================================
// ROUTES SIMPLES POUR LES SIGNALEMENTS
// ========================================
app.get('/admin/reports-simple', async (req, res) => {
    try {
        let reports = [];
        try {
            const { Report } = require('./models');
            reports = await Report.find().sort({ createdAt: -1 }).limit(50).lean();
        } catch (e) {
            console.log('Erreur récupération signalements');
        }
        
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Signalements</title>
                <style>
                    body { font-family: Arial; padding: 20px; background: #f5f5f5; }
                    .container { max-width: 1200px; margin: 0 auto; }
                    .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
                    .back { color: #667eea; text-decoration: none; font-weight: 500; }
                    .back:hover { text-decoration: underline; }
                    table { width: 100%; background: white; border-radius: 8px; overflow: hidden; }
                    th { background: #667eea; color: white; padding: 12px; text-align: left; }
                    td { padding: 12px; border-bottom: 1px solid #eee; }
                    .status-pending { background: #fed7d7; color: #742a2a; padding: 4px 8px; border-radius: 4px; }
                    .status-resolved { background: #c6f6d5; color: #22543d; padding: 4px 8px; border-radius: 4px; }
                    .no-data { text-align: center; padding: 40px; color: #718096; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <a href="/admin/dashboard-direct" class="back">← Retour au dashboard</a>
                        <h1>📋 Signalements</h1>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Signalé par</th>
                                <th>Utilisateur signalé</th>
                                <th>Raison</th>
                                <th>Statut</th>
                            </tr>
                        </thead>
                        <tbody>`;
        
        if (reports.length === 0) {
            html += `<tr><td colspan="5" class="no-data">Aucun signalement pour le moment</td></tr>`;
        } else {
            for (const report of reports) {
                const status = report.status || 'pending';
                html += `
                    <tr>
                        <td>${new Date(report.createdAt).toLocaleDateString('fr-FR')}</td>
                        <td>${report.reporterId || 'N/A'}</td>
                        <td>${report.reportedUserId || 'N/A'}</td>
                        <td>${report.reason || 'Non spécifiée'}</td>
                        <td><span class="status-${status}">${status}</span></td>
                    </tr>`;
            }
        }
        
        html += `
                        </tbody>
                    </table>
                </div>
            </body>
            </html>`;
        
        res.send(html);
    } catch (error) {
        res.status(500).send(`<h1>Erreur</h1><p>${error.message}</p><a href="/admin/dashboard-direct">Retour</a>`);
    }
});

// ========================================
// ROUTE DES CONVERSATIONS ACTIVES
// ========================================
app.get('/admin/chats-simple', async (req, res) => {
    try {
        let activeChats = [];
        let queuedUsers = [];
        
        try {
            const { Chat, Queue, User } = require('./models');
            
            // Récupérer les conversations actives
            activeChats = await Chat.find({ isActive: true })
                .sort({ lastActivity: -1 })
                .limit(50)
                .lean();
            
            // Récupérer les utilisateurs en file d'attente
            queuedUsers = await Queue.find()
                .sort({ joinedAt: -1 })
                .limit(20)
                .lean();
                
        } catch (e) {
            console.log('Erreur récupération conversations:', e);
        }
        
        let html = `
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <title>Conversations Actives - SpeakToStranger</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                        background: #f0f2f5; 
                        padding: 20px;
                    }
                    
                    .container { 
                        max-width: 1400px; 
                        margin: 0 auto; 
                    }
                    
                    .header { 
                        background: white; 
                        padding: 25px; 
                        border-radius: 12px; 
                        margin-bottom: 25px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                    }
                    
                    .header h1 {
                        color: #1a202c;
                        font-size: 2rem;
                        margin-bottom: 10px;
                    }
                    
                    .back { 
                        color: #667eea; 
                        text-decoration: none; 
                        font-weight: 500;
                        display: inline-flex;
                        align-items: center;
                        gap: 5px;
                        margin-bottom: 15px;
                    }
                    
                    .back:hover { text-decoration: underline; }
                    
                    .stats-row {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 15px;
                        margin-bottom: 25px;
                    }
                    
                    .stat-mini {
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        padding: 20px;
                        border-radius: 10px;
                        text-align: center;
                    }
                    
                    .stat-mini-value {
                        font-size: 2.5rem;
                        font-weight: bold;
                        margin-bottom: 5px;
                    }
                    
                    .stat-mini-label {
                        opacity: 0.9;
                        font-size: 0.9rem;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }
                    
                    .section {
                        background: white;
                        border-radius: 12px;
                        padding: 25px;
                        margin-bottom: 25px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                    }
                    
                    .section h2 {
                        color: #2d3748;
                        margin-bottom: 20px;
                        font-size: 1.5rem;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    
                    .chat-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
                        gap: 20px;
                    }
                    
                    .chat-card {
                        background: #f8f9fa;
                        border: 1px solid #e5e7eb;
                        border-radius: 10px;
                        padding: 15px;
                        transition: all 0.3s ease;
                    }
                    
                    .chat-card:hover {
                        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                        transform: translateY(-2px);
                    }
                    
                    .chat-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: start;
                        margin-bottom: 12px;
                    }
                    
                    .chat-users {
                        font-weight: 600;
                        color: #2d3748;
                        font-size: 1.1rem;
                    }
                    
                    .chat-status {
                        padding: 4px 10px;
                        border-radius: 20px;
                        font-size: 0.75rem;
                        font-weight: 600;
                        text-transform: uppercase;
                    }
                    
                    .status-active {
                        background: #c6f6d5;
                        color: #22543d;
                    }
                    
                    .status-waiting {
                        background: #fed7d7;
                        color: #742a2a;
                    }
                    
                    .status-idle {
                        background: #feebc8;
                        color: #744210;
                    }
                    
                    .chat-info {
                        display: grid;
                        gap: 8px;
                        margin-bottom: 12px;
                    }
                    
                    .info-row {
                        display: flex;
                        justify-content: space-between;
                        font-size: 0.9rem;
                    }
                    
                    .info-label {
                        color: #718096;
                    }
                    
                    .info-value {
                        color: #2d3748;
                        font-weight: 500;
                    }
                    
                    .chat-actions {
                        display: flex;
                        gap: 8px;
                        margin-top: 12px;
                        padding-top: 12px;
                        border-top: 1px solid #e5e7eb;
                    }
                    
                    .btn-small {
                        padding: 6px 12px;
                        border: none;
                        border-radius: 6px;
                        font-size: 0.85rem;
                        cursor: pointer;
                        transition: all 0.2s;
                        font-weight: 500;
                        flex: 1;
                        text-align: center;
                    }
                    
                    .btn-view {
                        background: #4299e1;
                        color: white;
                    }
                    
                    .btn-view:hover {
                        background: #3182ce;
                    }
                    
                    .btn-warn {
                        background: #ed8936;
                        color: white;
                    }
                    
                    .btn-warn:hover {
                        background: #dd6b20;
                    }
                    
                    .btn-end {
                        background: #f56565;
                        color: white;
                    }
                    
                    .btn-end:hover {
                        background: #e53e3e;
                    }
                    
                    .queue-list {
                        display: grid;
                        gap: 15px;
                    }
                    
                    .queue-item {
                        background: #f8f9fa;
                        border: 1px solid #e5e7eb;
                        border-radius: 8px;
                        padding: 15px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    
                    .queue-user {
                        display: flex;
                        align-items: center;
                        gap: 12px;
                    }
                    
                    .user-avatar {
                        width: 40px;
                        height: 40px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        font-weight: bold;
                        font-size: 1.2rem;
                    }
                    
                    .user-info {
                        display: flex;
                        flex-direction: column;
                    }
                    
                    .user-pseudo {
                        font-weight: 600;
                        color: #2d3748;
                    }
                    
                    .user-time {
                        font-size: 0.85rem;
                        color: #718096;
                    }
                    
                    .no-data {
                        text-align: center;
                        padding: 40px;
                        color: #718096;
                        font-style: italic;
                    }
                    
                    .alert {
                        background: #fff5f5;
                        border: 1px solid #feb2b2;
                        color: #c53030;
                        padding: 15px;
                        border-radius: 8px;
                        margin-bottom: 20px;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    
                    .success-alert {
                        background: #f0fff4;
                        border-color: #9ae6b4;
                        color: #22543d;
                    }
                    
                    @media (max-width: 768px) {
                        .chat-grid {
                            grid-template-columns: 1fr;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <a href="/admin/dashboard-direct" class="back">← Retour au dashboard</a>
                        <h1>💬 Conversations Actives</h1>
                        <p style="color: #718096; margin-top: 5px;">Surveillance en temps réel des conversations</p>
                    </div>
                    
                    <!-- Statistiques rapides -->
                    <div class="stats-row">
                        <div class="stat-mini">
                            <div class="stat-mini-value">${activeChats.length}</div>
                            <div class="stat-mini-label">Conversations actives</div>
                        </div>
                        <div class="stat-mini" style="background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);">
                            <div class="stat-mini-value">${activeChats.filter(c => c.messageCount > 10).length}</div>
                            <div class="stat-mini-label">Conversations engagées</div>
                        </div>
                        <div class="stat-mini" style="background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);">
                            <div class="stat-mini-value">${queuedUsers.length}</div>
                            <div class="stat-mini-label">En file d'attente</div>
                        </div>
                        <div class="stat-mini" style="background: linear-gradient(135deg, #4299e1 0%, #3182ce 100%);">
                            <div class="stat-mini-value">${activeChats.reduce((sum, c) => sum + (c.messageCount || 0), 0)}</div>
                            <div class="stat-mini-label">Messages aujourd'hui</div>
                        </div>
                    </div>`;
        
        // Section conversations actives
        html += `
                    <div class="section">
                        <h2>
                            <span>🔥</span>
                            <span>Conversations en cours (${activeChats.length})</span>
                        </h2>`;
        
        if (activeChats.length === 0) {
            html += `<div class="no-data">Aucune conversation active pour le moment</div>`;
        } else {
            html += `<div class="chat-grid">`;
            
            for (const chat of activeChats) {
                const duration = chat.startedAt ? 
                    Math.floor((Date.now() - new Date(chat.startedAt)) / 60000) : 0;
                
                const lastActivity = chat.lastActivity ?
                    Math.floor((Date.now() - new Date(chat.lastActivity)) / 60000) : 0;
                
                let statusClass = 'status-active';
                let statusText = 'Active';
                
                if (lastActivity > 5) {
                    statusClass = 'status-idle';
                    statusText = 'Inactive';
                }
                
                html += `
                    <div class="chat-card">
                        <div class="chat-header">
                            <div class="chat-users">
                                👤 ${chat.user1?.pseudo || chat.userId1 || 'Utilisateur 1'}
                                <br>
                                👤 ${chat.user2?.pseudo || chat.userId2 || 'Utilisateur 2'}
                            </div>
                            <span class="chat-status ${statusClass}">${statusText}</span>
                        </div>
                        
                        <div class="chat-info">
                            <div class="info-row">
                                <span class="info-label">📊 Messages échangés:</span>
                                <span class="info-value">${chat.messageCount || 0}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">⏱️ Durée:</span>
                                <span class="info-value">${duration} min</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">🕐 Dernière activité:</span>
                                <span class="info-value">Il y a ${lastActivity} min</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">🏷️ Chat ID:</span>
                                <span class="info-value" style="font-size: 0.8rem;">${chat._id || 'N/A'}</span>
                            </div>
                        </div>
                        
                        <div class="chat-actions">
                            <button class="btn-small btn-view" onclick="viewChat('${chat._id}')">
                                👁️ Voir
                            </button>
                            <button class="btn-small btn-warn" onclick="warnUsers('${chat._id}')">
                                ⚠️ Avertir
                            </button>
                            <button class="btn-small btn-end" onclick="endChat('${chat._id}')">
                                ❌ Terminer
                            </button>
                        </div>
                    </div>`;
            }
            
            html += `</div>`;
        }
        
        html += `</div>`;
        
        // Section file d'attente
        html += `
                    <div class="section">
                        <h2>
                            <span>⏳</span>
                            <span>File d'attente (${queuedUsers.length})</span>
                        </h2>`;
        
        if (queuedUsers.length === 0) {
            html += `<div class="no-data">Aucun utilisateur en attente</div>`;
        } else {
            html += `<div class="queue-list">`;
            
            for (const user of queuedUsers) {
                const waitTime = user.joinedAt ?
                    Math.floor((Date.now() - new Date(user.joinedAt)) / 60000) : 0;
                
                const firstLetter = user.pseudo ? user.pseudo[0].toUpperCase() : '?';
                
                html += `
                    <div class="queue-item">
                        <div class="queue-user">
                            <div class="user-avatar">${firstLetter}</div>
                            <div class="user-info">
                                <span class="user-pseudo">${user.pseudo || user.userId || 'Utilisateur'}</span>
                                <span class="user-time">En attente depuis ${waitTime} min</span>
                            </div>
                        </div>
                        <div>
                            ${user.interests && user.interests.length > 0 ? 
                                `<span style="font-size: 0.85rem; color: #718096;">
                                    Intérêts: ${user.interests.join(', ')}
                                </span>` : 
                                `<span style="font-size: 0.85rem; color: #a0aec0;">Aucun intérêt</span>`
                            }
                        </div>
                    </div>`;
            }
            
            html += `</div>`;
        }
        
        html += `</div>`;
        
        // Scripts
        html += `
                </div>
                
                <script>
                    function viewChat(chatId) {
                        alert('Visualisation du chat ' + chatId + ' (fonctionnalité à implémenter)');
                    }
                    
                    function warnUsers(chatId) {
                        if (confirm('Envoyer un avertissement aux deux utilisateurs ?')) {
                            fetch('/admin/chat/' + chatId + '/warn', { method: 'POST' })
                                .then(() => {
                                    alert('Avertissement envoyé');
                                    location.reload();
                                })
                                .catch(err => alert('Erreur: ' + err));
                        }
                    }
                    
                    function endChat(chatId) {
                        if (confirm('Terminer cette conversation ?')) {
                            fetch('/admin/chat/' + chatId + '/end', { method: 'POST' })
                                .then(() => {
                                    alert('Conversation terminée');
                                    location.reload();
                                })
                                .catch(err => alert('Erreur: ' + err));
                        }
                    }
                    
                    // Auto-refresh toutes les 30 secondes
                    setTimeout(() => location.reload(), 30000);
                </script>
            </body>
            </html>`;
        
        res.send(html);
    } catch (error) {
        console.error('Erreur conversations:', error);
        res.status(500).send(`
            <h1>❌ Erreur</h1>
            <p>${error.message}</p>
            <a href="/admin/dashboard-direct">Retour au dashboard</a>
        `);
    }
});

// ========================================
// ROUTE DES STATISTIQUES DÉTAILLÉES
// ========================================
app.get('/admin/stats-simple', async (req, res) => {
    try {
        // Statistiques par défaut
        let stats = {
            users: { total: 0, active: 0, blocked: 0, new24h: 0 },
            chats: { total: 0, active: 0, completed: 0, avgDuration: 0, avgMessages: 0 },
            messages: { total: 0, today: 0, week: 0, month: 0 },
            reports: { total: 0, pending: 0, resolved: 0, categories: {} },
            performance: { uptime: process.uptime(), memory: process.memoryUsage() }
        };
        
        try {
            const { User, Chat, Report, Stats } = require('./models');
            const now = new Date();
            const today = new Date(now.setHours(0, 0, 0, 0));
            const week = new Date(now.setDate(now.getDate() - 7));
            const month = new Date(now.setMonth(now.getMonth() - 1));
            const day24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
            
            // Stats utilisateurs
            stats.users.total = await User.countDocuments();
            stats.users.active = await User.countDocuments({ status: 'online' });
            stats.users.blocked = await User.countDocuments({ isBlocked: true });
            stats.users.new24h = await User.countDocuments({ createdAt: { $gte: day24h } });
            
            // Stats conversations
            stats.chats.total = await Chat.countDocuments();
            stats.chats.active = await Chat.countDocuments({ isActive: true });
            stats.chats.completed = await Chat.countDocuments({ isActive: false });
            
            // Calcul des moyennes
            const chatAggregation = await Chat.aggregate([
                {
                    $group: {
                        _id: null,
                        avgMessages: { $avg: '$messageCount' },
                        totalMessages: { $sum: '$messageCount' }
                    }
                }
            ]);
            
            if (chatAggregation.length > 0) {
                stats.chats.avgMessages = Math.round(chatAggregation[0].avgMessages || 0);
                stats.messages.total = chatAggregation[0].totalMessages || 0;
            }
            
            // Stats signalements
            stats.reports.total = await Report.countDocuments();
            stats.reports.pending = await Report.countDocuments({ status: 'pending' });
            stats.reports.resolved = await Report.countDocuments({ status: 'resolved' });
            
            // Catégories de signalements
            const reportCategories = await Report.aggregate([
                { $group: { _id: '$reason', count: { $sum: 1 } } }
            ]);
            
            reportCategories.forEach(cat => {
                stats.reports.categories[cat._id || 'other'] = cat.count;
            });
            
        } catch (e) {
            console.log('Erreur récupération stats:', e);
        }
        
        // Graphiques data (JSON pour Chart.js)
        const chartData = {
            dailyUsers: Array.from({length: 7}, (_, i) => ({
                day: new Date(Date.now() - (6-i) * 24 * 60 * 60 * 1000).toLocaleDateString('fr-FR', { weekday: 'short' }),
                count: Math.floor(Math.random() * 100) + 20
            })),
            hourlyActivity: Array.from({length: 24}, (_, i) => ({
                hour: i,
                messages: Math.floor(Math.random() * 50) + 5
            }))
        };
        
        let html = `
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <title>Statistiques Détaillées - SpeakToStranger</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                        background: #f0f2f5; 
                        padding: 20px;
                    }
                    
                    .container { 
                        max-width: 1400px; 
                        margin: 0 auto; 
                    }
                    
                    .header { 
                        background: white; 
                        padding: 25px; 
                        border-radius: 12px; 
                        margin-bottom: 25px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                    }
                    
                    .header h1 {
                        color: #1a202c;
                        font-size: 2rem;
                        margin-bottom: 10px;
                    }
                    
                    .back { 
                        color: #667eea; 
                        text-decoration: none; 
                        font-weight: 500;
                        display: inline-flex;
                        align-items: center;
                        gap: 5px;
                        margin-bottom: 15px;
                    }
                    
                    .stats-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                        gap: 20px;
                        margin-bottom: 30px;
                    }
                    
                    .stat-card {
                        background: white;
                        padding: 25px;
                        border-radius: 12px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                        position: relative;
                        overflow: hidden;
                    }
                    
                    .stat-card::before {
                        content: '';
                        position: absolute;
                        top: 0;
                        left: 0;
                        right: 0;
                        height: 4px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    }
                    
                    .stat-card.success::before {
                        background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
                    }
                    
                    .stat-card.warning::before {
                        background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);
                    }
                    
                    .stat-card.danger::before {
                        background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
                    }
                    
                    .stat-icon {
                        font-size: 2.5rem;
                        margin-bottom: 15px;
                    }
                    
                    .stat-value {
                        font-size: 2.5rem;
                        font-weight: bold;
                        color: #1a202c;
                        margin-bottom: 5px;
                    }
                    
                    .stat-label {
                        color: #718096;
                        font-size: 0.9rem;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        margin-bottom: 15px;
                    }
                    
                    .stat-detail {
                        display: flex;
                        justify-content: space-between;
                        padding-top: 15px;
                        border-top: 1px solid #e5e7eb;
                        margin-top: 15px;
                    }
                    
                    .detail-item {
                        text-align: center;
                    }
                    
                    .detail-value {
                        font-size: 1.25rem;
                        font-weight: 600;
                        color: #2d3748;
                    }
                    
                    .detail-label {
                        font-size: 0.75rem;
                        color: #a0aec0;
                        text-transform: uppercase;
                        margin-top: 2px;
                    }
                    
                    .chart-section {
                        background: white;
                        padding: 25px;
                        border-radius: 12px;
                        margin-bottom: 25px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                    }
                    
                    .chart-section h2 {
                        color: #2d3748;
                        margin-bottom: 20px;
                        font-size: 1.5rem;
                    }
                    
                    .chart-container {
                        position: relative;
                        height: 300px;
                        margin-bottom: 30px;
                    }
                    
                    .performance-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 15px;
                        margin-top: 20px;
                    }
                    
                    .perf-item {
                        background: #f8f9fa;
                        padding: 15px;
                        border-radius: 8px;
                        text-align: center;
                    }
                    
                    .perf-value {
                        font-size: 1.5rem;
                        font-weight: bold;
                        color: #667eea;
                    }
                    
                    .perf-label {
                        font-size: 0.85rem;
                        color: #718096;
                        margin-top: 5px;
                    }
                    
                    .report-categories {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                        gap: 10px;
                        margin-top: 15px;
                    }
                    
                    .category-badge {
                        background: #f8f9fa;
                        padding: 10px;
                        border-radius: 8px;
                        text-align: center;
                        border: 1px solid #e5e7eb;
                    }
                    
                    .category-name {
                        font-size: 0.85rem;
                        color: #4a5568;
                        margin-bottom: 5px;
                    }
                    
                    .category-count {
                        font-size: 1.25rem;
                        font-weight: bold;
                        color: #2d3748;
                    }
                    
                    @media (max-width: 768px) {
                        .stats-grid {
                            grid-template-columns: 1fr;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <a href="/admin/dashboard-direct" class="back">← Retour au dashboard</a>
                        <h1>📈 Statistiques Détaillées</h1>
                        <p style="color: #718096; margin-top: 5px;">Analyse complète de l'activité du bot</p>
                    </div>
                    
                    <!-- Statistiques principales -->
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-icon">👥</div>
                            <div class="stat-value">${stats.users.total}</div>
                            <div class="stat-label">Utilisateurs Total</div>
                            <div class="stat-detail">
                                <div class="detail-item">
                                    <div class="detail-value" style="color: #48bb78;">${stats.users.active}</div>
                                    <div class="detail-label">En ligne</div>
                                </div>
                                <div class="detail-item">
                                    <div class="detail-value" style="color: #4299e1;">${stats.users.new24h}</div>
                                    <div class="detail-label">Nouveau 24h</div>
                                </div>
                                <div class="detail-item">
                                    <div class="detail-value" style="color: #f56565;">${stats.users.blocked}</div>
                                    <div class="detail-label">Bloqués</div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="stat-card success">
                            <div class="stat-icon">💬</div>
                            <div class="stat-value">${stats.chats.total}</div>
                            <div class="stat-label">Conversations Total</div>
                            <div class="stat-detail">
                                <div class="detail-item">
                                    <div class="detail-value">${stats.chats.active}</div>
                                    <div class="detail-label">Actives</div>
                                </div>
                                <div class="detail-item">
                                    <div class="detail-value">${stats.chats.completed}</div>
                                    <div class="detail-label">Terminées</div>
                                </div>
                                <div class="detail-item">
                                    <div class="detail-value">${stats.chats.avgMessages}</div>
                                    <div class="detail-label">Moy. msg</div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="stat-card warning">
                            <div class="stat-icon">📩</div>
                            <div class="stat-value">${stats.messages.total}</div>
                            <div class="stat-label">Messages Total</div>
                            <div class="stat-detail">
                                <div class="detail-item">
                                    <div class="detail-value">${stats.messages.today}</div>
                                    <div class="detail-label">Aujourd'hui</div>
                                </div>
                                <div class="detail-item">
                                    <div class="detail-value">${stats.messages.week}</div>
                                    <div class="detail-label">7 jours</div>
                                </div>
                                <div class="detail-item">
                                    <div class="detail-value">${stats.messages.month}</div>
                                    <div class="detail-label">30 jours</div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="stat-card danger">
                            <div class="stat-icon">🚨</div>
                            <div class="stat-value">${stats.reports.total}</div>
                            <div class="stat-label">Signalements Total</div>
                            <div class="stat-detail">
                                <div class="detail-item">
                                    <div class="detail-value" style="color: #f56565;">${stats.reports.pending}</div>
                                    <div class="detail-label">En attente</div>
                                </div>
                                <div class="detail-item">
                                    <div class="detail-value" style="color: #48bb78;">${stats.reports.resolved}</div>
                                    <div class="detail-label">Résolus</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Graphiques -->
                    <div class="chart-section">
                        <h2>📊 Activité des 7 derniers jours</h2>
                        <div class="chart-container">
                            <canvas id="dailyChart"></canvas>
                        </div>
                    </div>
                    
                    <div class="chart-section">
                        <h2>🕐 Activité par heure (24h)</h2>
                        <div class="chart-container">
                            <canvas id="hourlyChart"></canvas>
                        </div>
                    </div>
                    
                    <!-- Catégories de signalements -->
                    <div class="chart-section">
                        <h2>📋 Catégories de signalements</h2>
                        <div class="report-categories">`;
        
        // Afficher les catégories de signalements
        const categories = stats.reports.categories;
        if (Object.keys(categories).length === 0) {
            html += `<div style="grid-column: 1/-1; text-align: center; color: #718096;">Aucun signalement</div>`;
        } else {
            for (const [category, count] of Object.entries(categories)) {
                html += `
                    <div class="category-badge">
                        <div class="category-name">${category}</div>
                        <div class="category-count">${count}</div>
                    </div>`;
            }
        }
        
        html += `
                        </div>
                    </div>
                    
                    <!-- Performance système -->
                    <div class="chart-section">
                        <h2>⚡ Performance système</h2>
                        <div class="performance-grid">
                            <div class="perf-item">
                                <div class="perf-value">${Math.floor(stats.performance.uptime / 3600)}h</div>
                                <div class="perf-label">Uptime</div>
                            </div>
                            <div class="perf-item">
                                <div class="perf-value">${Math.round(stats.performance.memory.heapUsed / 1024 / 1024)}MB</div>
                                <div class="perf-label">Mémoire utilisée</div>
                            </div>
                            <div class="perf-item">
                                <div class="perf-value">${Math.round(stats.performance.memory.heapTotal / 1024 / 1024)}MB</div>
                                <div class="perf-label">Mémoire totale</div>
                            </div>
                            <div class="perf-item">
                                <div class="perf-value">${process.version}</div>
                                <div class="perf-label">Version Node.js</div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <script>
                    // Données pour les graphiques
                    const chartData = ${JSON.stringify(chartData)};
                    
                    // Configuration commune des graphiques
                    const commonOptions = {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                display: false
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                grid: {
                                    display: true,
                                    color: 'rgba(0, 0, 0, 0.05)'
                                }
                            },
                            x: {
                                grid: {
                                    display: false
                                }
                            }
                        }
                    };
                    
                    // Graphique journalier
                    new Chart(document.getElementById('dailyChart'), {
                        type: 'bar',
                        data: {
                            labels: chartData.dailyUsers.map(d => d.day),
                            datasets: [{
                                label: 'Utilisateurs actifs',
                                data: chartData.dailyUsers.map(d => d.count),
                                backgroundColor: 'rgba(102, 126, 234, 0.8)',
                                borderColor: 'rgba(102, 126, 234, 1)',
                                borderWidth: 1,
                                borderRadius: 5
                            }]
                        },
                        options: commonOptions
                    });
                    
                    // Graphique horaire
                    new Chart(document.getElementById('hourlyChart'), {
                        type: 'line',
                        data: {
                            labels: chartData.hourlyActivity.map(h => h.hour + 'h'),
                            datasets: [{
                                label: 'Messages',
                                data: chartData.hourlyActivity.map(h => h.messages),
                                backgroundColor: 'rgba(72, 187, 120, 0.2)',
                                borderColor: 'rgba(72, 187, 120, 1)',
                                borderWidth: 2,
                                tension: 0.4,
                                fill: true
                            }]
                        },
                        options: commonOptions
                    });
                </script>
            </body>
            </html>`;
        
        res.send(html);
    } catch (error) {
        console.error('Erreur statistiques:', error);
        res.status(500).send(`
            <h1>❌ Erreur</h1>
            <p>${error.message}</p>
            <a href="/admin/dashboard-direct">Retour au dashboard</a>
        `);
    }
});

// Webhook verification
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    if (mode && token === VERIFY_TOKEN) {
        console.log('✅ Webhook vérifié');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Réception des messages
app.post('/webhook', async (req, res) => {
    const body = req.body;
    
    if (body.object === 'page') {
        // Traiter de manière asynchrone
        setImmediate(async () => {
            for (const entry of body.entry) {
                for (const event of entry.messaging) {
                    try {
                        await messageHandler.handleEvent(event);
                    } catch (error) {
                        console.error('Erreur traitement événement:', error);
                    }
                }
            }
        });
        
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// ========================================
// PAGE DE GESTION DES UTILISATEURS
// ========================================
app.get('/admin/users-simple', async (req, res) => {
    try {
        let users = [];
        let stats = {
            total: 0,
            online: 0,
            blocked: 0,
            active: 0
        };
        
        try {
            const { User } = require('./models');
            users = await User.find().sort({ lastActivity: -1 }).limit(100).lean();
            
            stats.total = users.length;
            stats.online = users.filter(u => u.status === 'online').length;
            stats.blocked = users.filter(u => u.isBlocked).length;
            stats.active = users.filter(u => {
                const lastActive = new Date(u.lastActivity);
                const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
                return lastActive > hourAgo;
            }).length;
        } catch (e) {
            console.log('Erreur récupération utilisateurs:', e);
        }
        
        let html = `
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <title>Gestion des Utilisateurs - SpeakToStranger</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    
                    body { 
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh;
                        padding: 20px;
                    }
                    
                    .container { 
                        max-width: 1400px; 
                        margin: 0 auto;
                    }
                    
                    .header {
                        background: white;
                        border-radius: 16px;
                        padding: 2rem;
                        margin-bottom: 2rem;
                        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                    }
                    
                    .header-top {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 1rem;
                    }
                    
                    h1 {
                        color: #2d3748;
                        font-size: 2rem;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    
                    .back-btn {
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        padding: 10px 20px;
                        border-radius: 8px;
                        text-decoration: none;
                        font-weight: 500;
                        transition: transform 0.2s;
                    }
                    
                    .back-btn:hover {
                        transform: translateY(-2px);
                    }
                    
                    .stats-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 1rem;
                        margin-top: 1.5rem;
                    }
                    
                    .stat-card {
                        background: #f7fafc;
                        padding: 1.5rem;
                        border-radius: 12px;
                        text-align: center;
                        transition: transform 0.2s;
                    }
                    
                    .stat-card:hover {
                        transform: translateY(-2px);
                    }
                    
                    .stat-icon {
                        font-size: 2rem;
                        margin-bottom: 0.5rem;
                    }
                    
                    .stat-value {
                        font-size: 2.5rem;
                        font-weight: bold;
                        margin-bottom: 0.25rem;
                    }
                    
                    .stat-label {
                        color: #718096;
                        font-size: 0.875rem;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    }
                    
                    .search-bar {
                        background: white;
                        padding: 1.5rem;
                        border-radius: 12px;
                        margin-bottom: 1.5rem;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.07);
                    }
                    
                    .search-input {
                        width: 100%;
                        padding: 12px 20px;
                        border: 2px solid #e2e8f0;
                        border-radius: 8px;
                        font-size: 1rem;
                        transition: border-color 0.2s;
                    }
                    
                    .search-input:focus {
                        outline: none;
                        border-color: #667eea;
                    }
                    
                    .users-grid {
                        display: grid;
                        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                        gap: 1.5rem;
                    }
                    
                    .user-card {
                        background: white;
                        border-radius: 12px;
                        padding: 1.5rem;
                        box-shadow: 0 4px 6px rgba(0,0,0,0.07);
                        transition: all 0.3s;
                    }
                    
                    .user-card:hover {
                        transform: translateY(-4px);
                        box-shadow: 0 8px 12px rgba(0,0,0,0.1);
                    }
                    
                    .user-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: start;
                        margin-bottom: 1rem;
                    }
                    
                    .user-avatar {
                        width: 50px;
                        height: 50px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                        font-size: 1.5rem;
                        font-weight: bold;
                    }
                    
                    .user-name {
                        font-size: 1.25rem;
                        font-weight: 600;
                        color: #2d3748;
                        margin-bottom: 0.25rem;
                    }
                    
                    .user-id {
                        color: #a0aec0;
                        font-size: 0.75rem;
                        font-family: monospace;
                    }
                    
                    .user-stats {
                        display: grid;
                        grid-template-columns: repeat(3, 1fr);
                        gap: 0.5rem;
                        margin: 1rem 0;
                        padding: 1rem 0;
                        border-top: 1px solid #e2e8f0;
                        border-bottom: 1px solid #e2e8f0;
                    }
                    
                    .user-stat {
                        text-align: center;
                    }
                    
                    .user-stat-value {
                        font-size: 1.25rem;
                        font-weight: 600;
                        color: #4a5568;
                    }
                    
                    .user-stat-label {
                        font-size: 0.75rem;
                        color: #a0aec0;
                        text-transform: uppercase;
                    }
                    
                    .user-actions {
                        display: flex;
                        gap: 0.5rem;
                        margin-top: 1rem;
                    }
                    
                    .user-btn {
                        flex: 1;
                        padding: 8px;
                        border: none;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 0.875rem;
                        font-weight: 500;
                        transition: all 0.2s;
                    }
                    
                    .btn-message {
                        background: #edf2f7;
                        color: #4a5568;
                    }
                    
                    .btn-message:hover {
                        background: #e2e8f0;
                    }
                    
                    .btn-warn {
                        background: #feebc8;
                        color: #c05621;
                    }
                    
                    .btn-warn:hover {
                        background: #fbd38d;
                    }
                    
                    .btn-block {
                        background: #fed7d7;
                        color: #c53030;
                    }
                    
                    .btn-block:hover {
                        background: #fc8181;
                    }
                    
                    .btn-unblock {
                        background: #c6f6d5;
                        color: #22543d;
                    }
                    
                    .btn-unblock:hover {
                        background: #9ae6b4;
                    }
                    
                    .status-indicator {
                        display: inline-block;
                        width: 10px;
                        height: 10px;
                        border-radius: 50%;
                        margin-right: 5px;
                    }
                    
                    .status-online {
                        background: #48bb78;
                    }
                    
                    .status-offline {
                        background: #a0aec0;
                    }
                    
                    .status-blocked {
                        background: #f56565;
                    }
                    
                    .danger { color: #e53e3e; }
                    .warning { color: #dd6b20; }
                    .success { color: #38a169; }
                    .info { color: #3182ce; }
                    
                    .no-data {
                        text-align: center;
                        padding: 4rem;
                        color: #a0aec0;
                        background: white;
                        border-radius: 12px;
                    }
                    
                    @media (max-width: 768px) {
                        .users-grid {
                            grid-template-columns: 1fr;
                        }
                        
                        .header-top {
                            flex-direction: column;
                            gap: 1rem;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <div class="header-top">
                            <h1>
                                <span>👥</span>
                                <span>Gestion des Utilisateurs</span>
                            </h1>
                            <a href="/admin/dashboard-direct" class="back-btn">
                                ← Retour au Dashboard
                            </a>
                        </div>
                        
                        <div class="stats-grid">
                            <div class="stat-card">
                                <div class="stat-icon">👥</div>
                                <div class="stat-value info">${stats.total}</div>
                                <div class="stat-label">Total utilisateurs</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-icon">🟢</div>
                                <div class="stat-value success">${stats.online}</div>
                                <div class="stat-label">En ligne</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-icon">⚡</div>
                                <div class="stat-value warning">${stats.active}</div>
                                <div class="stat-label">Actifs (1h)</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-icon">🚫</div>
                                <div class="stat-value danger">${stats.blocked}</div>
                                <div class="stat-label">Bloqués</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="search-bar">
                        <input type="text" class="search-input" id="searchInput" placeholder="🔍 Rechercher un utilisateur par pseudo ou ID..." onkeyup="searchUsers()">
                    </div>
                    
                    <div class="users-grid" id="usersGrid">`;
        
        if (users.length === 0) {
            html += `
                <div class="no-data">
                    <div style="font-size: 4rem; margin-bottom: 1rem;">👤</div>
                    <h3>Aucun utilisateur</h3>
                    <p>Les utilisateurs apparaîtront ici une fois qu'ils auront utilisé le bot.</p>
                </div>`;
        } else {
            for (const user of users) {
                const isOnline = user.status === 'online';
                const isBlocked = user.isBlocked;
                const lastActive = user.lastActivity ? new Date(user.lastActivity) : null;
                const timeAgo = lastActive ? getTimeAgo(lastActive) : 'Jamais';
                const avatar = user.pseudo ? user.pseudo[0].toUpperCase() : '?';
                
                html += `
                    <div class="user-card" data-pseudo="${user.pseudo?.toLowerCase()}" data-id="${user.facebookId}">
                        <div class="user-header">
                            <div style="display: flex; align-items: center; gap: 1rem;">
                                <div class="user-avatar">${avatar}</div>
                                <div>
                                    <div class="user-name">
                                        <span class="status-indicator ${isBlocked ? 'status-blocked' : isOnline ? 'status-online' : 'status-offline'}"></span>
                                        ${user.pseudo || 'Utilisateur'}
                                    </div>
                                    <div class="user-id">${user.facebookId?.substring(0, 12)}...</div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="user-stats">
                            <div class="user-stat">
                                <div class="user-stat-value">${user.totalConversations || 0}</div>
                                <div class="user-stat-label">Conversations</div>
                            </div>
                            <div class="user-stat">
                                <div class="user-stat-value">${user.totalMessages || 0}</div>
                                <div class="user-stat-label">Messages</div>
                            </div>
                            <div class="user-stat">
                                <div class="user-stat-value">⭐ ${user.rating?.toFixed(1) || '5.0'}</div>
                                <div class="user-stat-label">Note</div>
                            </div>
                        </div>
                        
                        <div style="margin: 1rem 0;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <span style="color: #718096; font-size: 0.875rem;">Dernière activité:</span>
                                <span style="color: #4a5568; font-size: 0.875rem; font-weight: 500;">${timeAgo}</span>
                            </div>
                            ${user.interests && user.interests.length > 0 ? `
                                <div style="margin-top: 0.5rem;">
                                    <span style="color: #718096; font-size: 0.875rem;">Intérêts:</span>
                                    <div style="display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.25rem;">
                                        ${user.interests.map(i => `<span style="background: #edf2f7; color: #4a5568; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">${i}</span>`).join('')}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                        
                        <div class="user-actions">
                            <button class="user-btn btn-message" onclick="sendMessage('${user.facebookId}')">💬 Message</button>
                            ${isBlocked ? 
                                `<button class="user-btn btn-unblock" onclick="unblockUser('${user.facebookId}')">✅ Débloquer</button>` :
                                `<button class="user-btn btn-warn" onclick="warnUser('${user.facebookId}')">⚠️ Avertir</button>
                                 <button class="user-btn btn-block" onclick="blockUser('${user.facebookId}')">🚫 Bloquer</button>`
                            }
                        </div>
                    </div>`;
            }
        }
        
        html += `
                    </div>
                </div>
                
                <script>
                    function getTimeAgo(date) {
                        const seconds = Math.floor((new Date() - date) / 1000);
                        if (seconds < 60) return 'Il y a ' + seconds + ' secondes';
                        const minutes = Math.floor(seconds / 60);
                        if (minutes < 60) return 'Il y a ' + minutes + ' minutes';
                        const hours = Math.floor(minutes / 60);
                        if (hours < 24) return 'Il y a ' + hours + ' heures';
                        const days = Math.floor(hours / 24);
                        return 'Il y a ' + days + ' jours';
                    }
                    
                    function searchUsers() {
                        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
                        const cards = document.querySelectorAll('.user-card');
                        
                        cards.forEach(card => {
                            const pseudo = card.dataset.pseudo || '';
                            const id = card.dataset.id || '';
                            
                            if (pseudo.includes(searchTerm) || id.includes(searchTerm)) {
                                card.style.display = '';
                            } else {
                                card.style.display = 'none';
                            }
                        });
                    }
                    
                    function sendMessage(userId) {
                        alert('Envoyer un message à: ' + userId);
                    }
                    
                    function warnUser(userId) {
                        if (confirm('Envoyer un avertissement à cet utilisateur ?')) {
                            alert('Avertissement envoyé à: ' + userId);
                        }
                    }
                    
                    function blockUser(userId) {
                        if (confirm('Bloquer cet utilisateur ?')) {
                            alert('Utilisateur bloqué: ' + userId);
                            location.reload();
                        }
                    }
                    
                    function unblockUser(userId) {
                        if (confirm('Débloquer cet utilisateur ?')) {
                            alert('Utilisateur débloqué: ' + userId);
                            location.reload();
                        }
                    }
                    
                    ${users.map(user => {
                        const lastActive = user.lastActivity ? new Date(user.lastActivity) : null;
                        return lastActive ? `
                            // Fonction helper pour calculer le temps écoulé
                            function getTimeAgo(date) {
                                const seconds = Math.floor((new Date() - date) / 1000);
                                if (seconds < 60) return 'Il y a ' + seconds + ' secondes';
                                const minutes = Math.floor(seconds / 60);
                                if (minutes < 60) return 'Il y a ' + minutes + ' minutes';
                                const hours = Math.floor(minutes / 60);
                                if (hours < 24) return 'Il y a ' + hours + ' heures';
                                const days = Math.floor(hours / 24);
                                return 'Il y a ' + days + ' jours';
                            }
                        ` : '';
                    }).join('')}
                </script>
            </body>
            </html>`;
        
        res.send(html);
    } catch (error) {
        console.error('Erreur page utilisateurs:', error);
        res.status(500).send(`<h1>Erreur</h1><p>${error.message}</p><a href="/admin/dashboard-direct">Retour</a>`);
    }
});

// Fonction helper pour calculer le temps écoulé
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return `Il y a ${seconds} secondes`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Il y a ${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Il y a ${hours} heures`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `Il y a ${days} jours`;
    const months = Math.floor(days / 30);
    return `Il y a ${months} mois`;
}

// Route de santé
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Page d'accueil
app.get('/', (req, res) => {
    res.send(`
        <h1>🎭 SpeakToStranger Bot</h1>
        <p>Le bot est en ligne !</p>
        <p><a href="/admin">Accès administration</a></p>
    `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🤖 SpeakToStranger bot démarré sur le port ${PORT}`);
    console.log(`📊 Dashboard admin: http://localhost:${PORT}/admin`);
});
