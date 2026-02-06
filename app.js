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
const MessageHandler = require('./handlers/messageHandler');
const ChatManager = require('./handlers/chatManager');
const UserManager = require('./handlers/userManager');

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

// Route des signalements
app.get('/admin/reports', auth.requireAdmin, async (req, res) => {
    try {
        const reports = await Report.find()
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        
        // Créer une page HTML simple pour les signalements
        let html = `
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <meta charset="UTF-8">
                <title>Signalements - SpeakToStranger</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; }
                    .container { max-width: 1200px; margin: 0 auto; }
                    h1 { color: #333; }
                    .back-btn { display: inline-block; margin-bottom: 20px; color: #3498db; text-decoration: none; }
                    table { width: 100%; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
                    th { background: #3498db; color: white; }
                    .status-pending { background: #f39c12; color: white; padding: 3px 8px; border-radius: 3px; }
                    .status-resolved { background: #27ae60; color: white; padding: 3px 8px; border-radius: 3px; }
                    .btn-action { padding: 5px 10px; margin: 2px; border: none; border-radius: 3px; cursor: pointer; color: white; }
                    .btn-warn { background: #f39c12; }
                    .btn-block { background: #e74c3c; }
                    .btn-dismiss { background: #95a5a6; }
                </style>
            </head>
            <body>
                <div class="container">
                    <a href="/admin" class="back-btn">← Retour au dashboard</a>
                    <h1>📋 Signalements</h1>
                    
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
                        <tbody>
        `;

        for (const report of reports) {
            const reporter = await User.findOne({ facebookId: report.reporterId }).lean();
            const reported = await User.findOne({ facebookId: report.reportedUserId }).lean();
            
            html += `
                <tr>
                    <td>${new Date(report.createdAt).toLocaleDateString('fr-FR')}</td>
                    <td>${reporter?.pseudo || 'Inconnu'}</td>
                    <td>${reported?.pseudo || 'Inconnu'}</td>
                    <td>${report.reason}</td>
                    <td><span class="status-${report.status}">${report.status}</span></td>
                    <td>
                        ${report.status === 'pending' ? `
                            <button class="btn-action btn-warn" onclick="handleReport('${report._id}', 'warn')">Avertir</button>
                            <button class="btn-action btn-block" onclick="handleReport('${report._id}', 'block')">Bloquer</button>
                            <button class="btn-action btn-dismiss" onclick="handleReport('${report._id}', 'dismiss')">Ignorer</button>
                        ` : 'Traité'}
                    </td>
                </tr>
            `;
        }

        html += `
                        </tbody>
                    </table>
                </div>
                
                <script>
                    async function handleReport(reportId, action) {
                        if (!confirm('Confirmer cette action ?')) return;
                        
                        try {
                            const response = await fetch('/admin/reports/' + reportId + '/action', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: action, reason: 'Action admin' })
                            });
                            
                            if (response.ok) {
                                alert('Action effectuée avec succès');
                                location.reload();
                            } else {
                                alert('Erreur lors du traitement');
                            }
                        } catch (error) {
                            alert('Erreur: ' + error.message);
                        }
                    }
                </script>
            </body>
            </html>
        `;

        res.send(html);
    } catch (error) {
        console.error('Erreur signalements:', error);
        res.status(500).send('Erreur serveur');
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
