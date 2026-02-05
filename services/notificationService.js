const { Report, User } = require('../models');
const FacebookAPI = require('./facebookAPI');

class NotificationService {
    constructor() {
        this.fb = new FacebookAPI();
        // IDs Facebook des administrateurs
        this.adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
        this.webhookUrl = process.env.ADMIN_WEBHOOK_URL; // Pour Slack/Discord
    }

    async notifyNewReport(report) {
        const reporter = await User.findOne({ facebookId: report.reporterId });
        const reported = await User.findOne({ facebookId: report.reportedUserId });
        
        const message = `🚨 NOUVEAU SIGNALEMENT\n\n` +
            `Signalé par: ${reporter?.pseudo || 'Inconnu'}\n` +
            `Utilisateur signalé: ${reported?.pseudo || 'Inconnu'}\n` +
            `Raison: ${report.reason}\n` +
            `Date: ${new Date().toLocaleString('fr-FR')}\n\n` +
            `Voir sur le dashboard: ${process.env.ADMIN_URL}/reports/${report._id}`;
        
        // Notifier les admins via Messenger
        for (const adminId of this.adminIds) {
            try {
                await this.fb.sendTextMessage(adminId, message);
            } catch (error) {
                console.error(`Erreur notification admin ${adminId}:`, error);
            }
        }
        
        // Notifier via webhook (Slack/Discord)
        if (this.webhookUrl) {
            await this.sendWebhookNotification(report);
        }
        
        // Email si configuré
        if (process.env.ADMIN_EMAIL) {
            await this.sendEmailNotification(report);
        }
    }

    async sendWebhookNotification(report) {
        const reporter = await User.findOne({ facebookId: report.reporterId });
        const reported = await User.findOne({ facebookId: report.reportedUserId });
        
        const payload = {
            text: "Nouveau signalement sur SpeakToStranger",
            attachments: [{
                color: "warning",
                fields: [
                    {
                        title: "Signalé par",
                        value: reporter?.pseudo || 'Inconnu',
                        short: true
                    },
                    {
                        title: "Utilisateur signalé",
                        value: reported?.pseudo || 'Inconnu',
                        short: true
                    },
                    {
                        title: "Raison",
                        value: report.reason,
                        short: false
                    },
                    {
                        title: "Action",
                        value: `<${process.env.ADMIN_URL}/reports/${report._id}|Voir le signalement>`,
                        short: false
                    }
                ],
                footer: "SpeakToStranger Bot",
                ts: Math.floor(Date.now() / 1000)
            }]
        };
        
        try {
            await fetch(this.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            console.error('Erreur webhook notification:', error);
        }
    }

    async sendEmailNotification(report) {
        // Si vous utilisez un service email comme SendGrid
        const sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        
        const reporter = await User.findOne({ facebookId: report.reporterId });
        const reported = await User.findOne({ facebookId: report.reportedUserId });
        
        const msg = {
            to: process.env.ADMIN_EMAIL,
            from: 'noreply@speaktostranger.com',
            subject: '🚨 Nouveau signalement - Action requise',
            html: `
                <h2>Nouveau signalement sur SpeakToStranger</h2>
                <table border="1" cellpadding="10">
                    <tr>
                        <td><strong>Signalé par:</strong></td>
                        <td>${reporter?.pseudo || 'Inconnu'}</td>
                    </tr>
                    <tr>
                        <td><strong>Utilisateur signalé:</strong></td>
                        <td>${reported?.pseudo || 'Inconnu'}</td>
                    </tr>
                    <tr>
                        <td><strong>Raison:</strong></td>
                        <td>${report.reason}</td>
                    </tr>
                    <tr>
                        <td><strong>Date:</strong></td>
                        <td>${new Date().toLocaleString('fr-FR')}</td>
                    </tr>
                </table>
                <p>
                    <a href="${process.env.ADMIN_URL}/reports/${report._id}" 
                       style="background: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                        Voir le signalement
                    </a>
                </p>
            `
        };
        
        try {
            await sgMail.send(msg);
        } catch (error) {
            console.error('Erreur envoi email:', error);
        }
    }

    async checkCriticalReports() {
        // Vérifier les mots-clés critiques nécessitant une action immédiate
        const criticalKeywords = [
            'mineur', 'enfant', 'suicide', 'violence', 'menace', 
            'harcèlement', 'drogue', 'arme'
        ];
        
        const recentReports = await Report.find({
            status: 'pending',
            createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // 5 dernières minutes
        });
        
        for (const report of recentReports) {
            const isCritical = criticalKeywords.some(keyword => 
                report.reason.toLowerCase().includes(keyword)
            );
            
            if (isCritical) {
                await this.notifyCriticalReport(report);
                
                // Action automatique immédiate
                const reported = await User.findOne({ facebookId: report.reportedUserId });
                if (reported) {
                    reported.isBlocked = true;
                    reported.blockReason = 'Suspension automatique - Signalement critique';
                    await reported.save();
                    
                    report.status = 'reviewed';
                    report.action = 'auto_block';
                    await report.save();
                }
            }
        }
    }

    async notifyCriticalReport(report) {
        const message = `🚨🚨 SIGNALEMENT CRITIQUE - ACTION IMMÉDIATE 🚨🚨\n\n` +
            `Un signalement critique a été détecté et l'utilisateur a été automatiquement suspendu.\n\n` +
            `Raison: ${report.reason}\n\n` +
            `Vérification manuelle requise: ${process.env.ADMIN_URL}/reports/${report._id}`;
        
        // Notifier tous les admins immédiatement
        for (const adminId of this.adminIds) {
            await this.fb.sendTextMessage(adminId, message);
        }
    }
}

module.exports = NotificationService;
