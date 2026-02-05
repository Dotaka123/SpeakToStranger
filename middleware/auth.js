const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Configuration
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || bcrypt.hashSync('admin123', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

class AuthMiddleware {
    // Vérifier si l'utilisateur est un admin
    async requireAdmin(req, res, next) {
        try {
            // Vérifier le token dans les cookies ou headers
            const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
            
            if (!token) {
                // Si pas de token, rediriger vers la page de connexion
                if (req.accepts('html')) {
                    return res.redirect('/admin/login');
                }
                return res.status(401).json({ error: 'Non autorisé' });
            }

            // Vérifier le token
            const decoded = jwt.verify(token, JWT_SECRET);
            
            if (!decoded.isAdmin) {
                return res.status(403).json({ error: 'Accès refusé' });
            }

            req.user = decoded;
            next();
        } catch (error) {
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
                    
                    .logo {
                        text-align: center;
                        font-size: 3rem;
                        margin-bottom: 1rem;
                    }
                </style>
            </head>
            <body>
                <div class="login-container">
                    <div class="logo">🎭</div>
                    <h1>Connexion Admin</h1>
                    <div id="error" class="error"></div>
                    <form id="loginForm">
                        <div class="form-group">
                            <label for="username">Nom d'utilisateur</label>
                            <input type="text" id="username" name="username" required autofocus>
                        </div>
                        <div class="form-group">
                            <label for="password">Mot de passe</label>
                            <input type="password" id="password" name="password" required>
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
                        
                        try {
                            const response = await fetch('/admin/login', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ username, password })
                            });
                            
                            const data = await response.json();
                            
                            if (response.ok) {
                                // Stocker le token et rediriger
                                localStorage.setItem('adminToken', data.token);
                                window.location.href = '/admin';
                            } else {
                                errorDiv.textContent = data.error || 'Identifiants incorrects';
                                errorDiv.style.display = 'block';
                            }
                        } catch (error) {
                            errorDiv.textContent = 'Erreur de connexion';
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
        const { username, password } = req.body;

        // Vérifier les identifiants
        if (username !== ADMIN_USERNAME) {
            return res.status(401).json({ error: 'Identifiants incorrects' });
        }

        const validPassword = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
        if (!validPassword) {
            return res.status(401).json({ error: 'Identifiants incorrects' });
        }

        // Créer le token
        const token = jwt.sign(
            { 
                id: 'admin',
                username: username,
                isAdmin: true 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Envoyer le token
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000 // 24 heures
        });

        res.json({ success: true, token });
    }

    // Déconnexion
    logout(req, res) {
        res.clearCookie('token');
        res.redirect('/admin/login');
    }
}

module.exports = new AuthMiddleware();
