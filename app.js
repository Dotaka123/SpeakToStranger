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
