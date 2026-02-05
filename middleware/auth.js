// Version corrigée avec gestion des cookies
const cookieParser = require('cookie-parser');

class AuthMiddleware {
    constructor() {
        // Identifiants par défaut
        this.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
        this.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
        this.JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
    }

    // Vérifier si l'utilisateur est un admin
    async requireAdmin(req, res, next) {
        try {
            // Récupérer le token depuis le cookie ou localStorage
            const token = req.cookies?.adminToken || 
                         req.headers.authorization?.replace('Bearer ', '') ||
                         req.query.token;
            
            if (!token) {
                if (req.accepts('html')) {
                    return res.redirect('/admin/login');
                }
                return res.status(401).json({ error: 'Non autorisé' });
            }

            // Pour le mode simplifié, on vérifie juste la présence du token
            req.user = { id: 'admin', isAdmin: true };
            next();
        } catch (error) {
            console.error('Erreur auth:', error);
            if (req.accepts('html')) {
                return res.redirect('/admin/login');
            }
            res.status(401).json({ error: 'Token invalide' });
        }
    }

    // Page de connexion
    showLoginPage(req, res) {
        res.send(`
            <!DOCTYPE html>
            <html lang="fr">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Connexion Admin - SpeakToStranger</title>
                <style>
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    
                    .login-container {
                        background: white;
                        padding: 2rem;
                        border-radius: 12px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                        width: 100%;
                        max-width: 400px;
                    }
                    
                    h1 {
                        text-align: center;
                        color: #2c3e50;
                        margin-bottom: 2rem;
                    }
                    
                    .form-group {
                        margin-bottom: 1.5rem;
                    }
                    
                    label {
                        display: block;
                        margin-bottom: 0.5rem;
                        color: #495057;
                        font-weight: 500;
                    }
                    
                    input {
                        width: 100%;
                        padding: 0.75rem;
                        border: 1px solid #dee2e6;
                        border-radius: 6px;
                        font-size: 1rem;
                        transition: border-color 0.3s;
                    }
                    
                    input:focus {
                        outline: none;
                        border-color: #667eea;
                        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
                    }
                    
                    button {
                        width: 100%;
                        padding: 0.75rem;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        border: none;
                        border-radius: 6px;
                        font-size: 1rem;
                        font-weight: 600;
                        cursor: pointer;
                        transition: transform 0.2s;
                    }
                    
                    button:hover {
                        transform: translateY(-2px);
                    }
                    
                    .error {
                        background: #f8d7da;
                        color: #721c24;
                        padding: 0.75rem;
                        border-radius: 6px;
                        margin-bottom: 1rem;
                        display: none;
                    }
                    
                    .success {
                        background: #d4edda;
                        color: #155724;
                        padding: 0.75rem;
                        border-radius: 6px;
                        margin-bottom: 1rem;
                        display: none;
                    }
                    
                    .logo {
                        text-align: center;
                        font-size: 3rem;
                        margin-bottom: 1rem;
                    }
                    
                    .info {
                        background: #d1ecf1;
                        color: #0c5460;
                        padding: 0.75rem;
                        border-radius: 6px;
                        margin-bottom: 1rem;
                        font-size: 0.9rem;
                    }
                </style>
            </head>
            <body>
                <div class="login-container">
                    <div class="logo">🎭</div>
                    <h1>Connexion Admin</h1>
                    
                    <div class="info">
                        📝 Par défaut: admin / admin123
                    </div>
                    
                    <div id="error" class="error"></div>
                    <div id="success" class="success"></div>
                    
                    <form id="loginForm">
                        <div class="form-group">
                            <label for="username">Nom d'utilisateur</label>
                            <input type="text" id="username" name="username" value="admin" required autofocus>
                        </div>
                        <div class="form-group">
                            <label for="password">Mot de passe</label>
                            <input type="password" id="password" name="password" value="admin123" required>
                        </div>
                        <button type="submit">Se connecter</button>
                    </form>
                </div>
                
                <script>
                    document.getElementById('loginForm').addEventListener('submit', async (e) => {
                        e.preventDefault();
                        
                        const username = document.getElementById('username').value;
                        const password = document.getElementById('password').value;
                        const errorDiv = document.getElementById('error');
                        const successDiv = document.getElementById('success');
                        
                        errorDiv.style.display = 'none';
                        successDiv.style.display = 'none';
                        
                        try {
                            const response = await fetch('/admin/login', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ username, password }),
                                credentials: 'include' // Important pour les cookies
                            });
                            
                            const data = await response.json();
                            
                            if (response.ok && data.success) {
                                successDiv.textContent = 'Connexion réussie ! Redirection...';
                                successDiv.style.display = 'block';
                                
                                // Stocker le token dans localStorage aussi
                                if (data.token) {
                                    localStorage.setItem('adminToken', data.token);
                                    document.cookie = 'adminToken=' + data.token + '; path=/';
                                }
                                
                                // Redirection
                                setTimeout(() => {
                                    window.location.href = '/admin';
                                }, 1000);
                            } else {
                                errorDiv.textContent = data.error || 'Identifiants incorrects';
                                errorDiv.style.display = 'block';
                            }
                        } catch (error) {
                            console.error('Erreur:', error);
                            errorDiv.textContent = 'Erreur de connexion: ' + error.message;
                            errorDiv.style.display = 'block';
                        }
                    });
                </script>
            </body>
            </html>
        `);
    }

    // Traiter la connexion
    async login(req, res) {
        try {
            const { username, password } = req.body;
            
            console.log('Tentative de connexion:', { username, password });
            
            // Vérifier les identifiants (version simplifiée)
            if (username !== this.ADMIN_USERNAME || password !== this.ADMIN_PASSWORD) {
                console.log('Identifiants incorrects');
                return res.status(401).json({ 
                    success: false, 
                    error: 'Identifiants incorrects' 
                });
            }
            
            // Créer un token simple
            const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
            
            // Définir le cookie
            res.cookie('adminToken', token, {
                httpOnly: false, // False pour permettre l'accès JavaScript
                secure: false, // False pour HTTP local
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000, // 24 heures
                path: '/'
            });
            
            console.log('Connexion réussie pour:', username);
            
            res.json({ 
                success: true, 
                token: token,
                message: 'Connexion réussie'
            });
        } catch (error) {
            console.error('Erreur login:', error);
            res.status(500).json({ 
                success: false, 
                error: 'Erreur serveur: ' + error.message 
            });
        }
    }

    // Déconnexion
    logout(req, res) {
        res.clearCookie('adminToken');
        res.redirect('/admin/login');
    }
}

module.exports = new AuthMiddleware();
